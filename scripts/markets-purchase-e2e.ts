/**
 * Bond purchase (delivery versus payment) end to end on devnet.
 *
 *   1. chain:  builds the exact purchase payload the server builds for a smart wallet
 *              ([bond ATA create-idempotent] + subscribe(units, units × price)), validates it with
 *              `validateSubscribeIntent`, simulates, and — because no Crossmint email signer is
 *              available to a script — signs it with a local keypair buyer instead of wrapping it.
 *              The finalized transaction is then checked with the same trace and delta verifiers
 *              the smart-wallet receipt uses (`verifyPurchaseTrace`, `verifyPurchaseDeltas`).
 *   2. issuer: optional `--coupon`: withdraw the proceeds to the issuer, announce a coupon with live
 *              timing, lock, snapshot (buyers come from the offering's UnitsSubscribed events),
 *              fund with the USDC just received, push the payment, and show the buyer's USDC.
 *   3. http:   optional `--http <baseUrl>` (dev server with this .env.local): the bonds API for a
 *              local smoke session and the purchase route, which stops at Crossmint wallet
 *              verification because a smoke wallet is not a Crossmint wallet.
 *
 * The buyer keypair must hold devnet USDC (4zMMC9…) and a little SOL.
 *
 *   npx tsx scripts/markets-purchase-e2e.ts --buyer <keypair.json> [--mint <bond mint>] [--units 2] [--coupon] [--http http://localhost:3000]
 */
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

import type { CanonicalInstruction } from "../lib/kamino-instruction-intent";
import { PLAIN_MARKETS_PROGRAM_ID, toBigInt } from "../lib/markets/client";
import { DevnetIssuer, parseSecretKey } from "../lib/markets/devnet-issuer";
import { DevnetLedger, type DevnetMarketsConfig } from "../lib/markets/devnet-service";
import { CIRCLE_DEVNET_USDC, MARKETS_SUBSCRIBE_ACTION, SPL_TOKEN_PROGRAM, subscribeAccounts, validateSubscribeIntent, type SubscribeTerms } from "../lib/markets/purchase";
import { verifyPurchaseDeltas, verifyPurchaseTrace } from "../lib/markets/purchase-receipt";
import type { ActionDraft } from "../lib/markets/service";

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
loadEnvLocal();

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const buyerPath = arg("buyer");
if (!buyerPath) throw new Error("--buyer <keypair.json> is required (a devnet keypair holding USDC)");
const buyer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(buyerPath, "utf8")) as number[]));
const mintAddress = arg("mint") ?? (process.env.MARKETS_INSTRUMENT_MINT ?? "").split(",")[0];
if (!mintAddress) throw new Error("--mint or MARKETS_INSTRUMENT_MINT is required");
const UNITS = BigInt(arg("units") ?? "2");
const RPC = process.env.MARKETS_RPC_URL || "https://api.devnet.solana.com";
const tx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
const usdc = (v: bigint) => `${(Number(v) / 1e6).toFixed(6)} USDC`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const issuerKey = parseSecretKey(process.env.MARKETS_ISSUER_SECRET);
const config: DevnetMarketsConfig = {
  mode: "devnet", rpcUrl: RPC, programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(), issuer: issuerKey?.publicKey.toBase58() ?? null,
  mints: [mintAddress], directory: [], settlementSymbol: "USD", writable: !!issuerKey, apiBase: "",
};
const ledger = new DevnetLedger(config, null, { poll: false });
const connection = ledger.connection;

const canonical = (ix: TransactionInstruction): CanonicalInstruction => ({
  programId: ix.programId.toBase58(),
  accounts: ix.keys.map((k) => ({ address: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
  dataBase58: bs58.encode(ix.data),
});

async function usdcOf(owner: PublicKey) {
  try {
    return (await getAccount(connection, getAssociatedTokenAddressSync(CIRCLE_DEVNET_USDC, owner, true), "confirmed")).amount;
  } catch {
    return BigInt(0);
  }
}

async function finalized(signature: string) {
  for (let i = 0; i < 90; i++) {
    const s = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "finalized") return;
    await sleep(2_000);
  }
  throw new Error("not finalized in time");
}

async function chainPurchase() {
  const mint = new PublicKey(mintAddress);
  const instrument = await ledger.client.fetchInstrumentByMint(mint);
  if (!instrument) throw new Error("unknown bond");
  const offering = await ledger.client.fetchOffering(instrument.address);
  if (!offering) throw new Error("bond has no offering");
  const terms: SubscribeTerms = {
    mint: mintAddress,
    issuePrice: toBigInt(offering.account.issuePrice).toString(),
    allowlistEnabled: instrument.account.allowlistEnabled,
    settlementMint: instrument.account.settlementMint.toBase58(),
    settlementTokenProgram: instrument.account.settlementTokenProgram.toBase58(),
  };
  const accounts = subscribeAccounts(buyer.publicKey.toBase58(), terms);
  const cost = UNITS * BigInt(terms.issuePrice);
  const usdcBefore = await usdcOf(buyer.publicKey);
  console.log(`buyer ${buyer.publicKey.toBase58()} · ${usdc(usdcBefore)} · buying ${UNITS} × ${usdc(BigInt(terms.issuePrice))} = ${usdc(cost)}`);
  if (terms.settlementTokenProgram !== SPL_TOKEN_PROGRAM) throw new Error("settlement is not SPL Token USDC");

  // Exactly what the server builds for a smart wallet.
  const bondInfo = await connection.getAccountInfo(new PublicKey(accounts.buyerBond), "confirmed");
  const ixs: TransactionInstruction[] = [];
  if (!bondInfo) ixs.push(createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, new PublicKey(accounts.buyerBond), buyer.publicKey, mint, TOKEN_2022_PROGRAM_ID));
  ixs.push(await ledger.client.subscribe(instrument, buyer.publicKey, UNITS, cost));
  const expected = ixs.map(canonical);
  const checked = validateSubscribeIntent({ action: MARKETS_SUBSCRIBE_ACTION, walletAddress: buyer.publicKey.toBase58(), units: UNITS.toString(), costAtomic: cost.toString(), instructions: expected }, terms);
  console.log(`✓ intent validated (${expected.length} instruction${expected.length > 1 ? "s" : ""}: ${expected.map((i) => (i.programId === PLAIN_MARKETS_PROGRAM_ID.toBase58() ? "subscribe" : "ATA")).join(" + ")})`);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: buyer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const versioned = new VersionedTransaction(message);
  const sim = await connection.simulateTransaction(versioned, { sigVerify: false, commitment: "confirmed" });
  if (sim.value.err) throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}\n${sim.value.logs?.join("\n")}`);
  console.log(`✓ simulation ok (${sim.value.unitsConsumed} CU)`);
  versioned.sign([buyer]);
  const signature = await connection.sendTransaction(versioned, { maxRetries: 5 });
  await finalized(signature);
  console.log(`✓ subscribe finalized  ${tx(signature)}`);

  // Same trace + delta verification as the smart-wallet receipt (payload at stack height 1 here).
  const raw = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!raw?.meta) throw new Error("finalized transaction unavailable");
  const keys = [...raw.transaction.message.staticAccountKeys, ...(raw.meta.loadedAddresses?.writable ?? []), ...(raw.meta.loadedAddresses?.readonly ?? [])].map((k) => k.toBase58());
  const trace = raw.transaction.message.compiledInstructions.flatMap((ix, index) => [
    { programId: keys[ix.programIdIndex], accounts: [...ix.accountKeyIndexes].map((i) => keys[i]), dataBase58: bs58.encode(ix.data), stackHeight: 1 },
    ...(raw.meta!.innerInstructions?.find((g) => g.index === index)?.instructions ?? []).map((c) => ({
      programId: keys[c.programIdIndex], accounts: c.accounts.map((i) => keys[i]), dataBase58: c.data, stackHeight: c.stackHeight ?? 2,
    })),
  ]);
  const intent = { walletAddress: buyer.publicKey.toBase58(), units: UNITS.toString(), costAtomic: cost.toString() };
  verifyPurchaseTrace({ trace, payloadDepth: 1, expected, intent, checked });
  const balances = (list: typeof raw.meta.preTokenBalances) => (list ?? []).map((b) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner ?? "", amount: b.uiTokenAmount.amount, decimals: b.uiTokenAmount.decimals }));
  verifyPurchaseDeltas({ accountKeys: keys, meta: { preTokenBalances: balances(raw.meta.preTokenBalances), postTokenBalances: balances(raw.meta.postTokenBalances) } }, intent, checked);
  console.log(`✓ receipt verified: USDC −${usdc(cost)} exactly, vault +${usdc(cost)}, +${UNITS} units`);

  ledger.changed();
  const state = await ledger.getOffering(mintAddress);
  const mine = state?.purchases.filter((p) => p.buyer === buyer.publicKey.toBase58()) ?? [];
  console.log(`offering: ${state?.soldUnits} sold of ${state?.capUnits}, proceeds ${usdc(state?.proceeds ?? BigInt(0))}, ${state?.purchases.length} purchases (${mine.length} by this buyer, decoded from UnitsSubscribed)`);
  return { signature, accounts };
}

async function couponRun() {
  if (!issuerKey) throw new Error("--coupon needs MARKETS_ISSUER_SECRET");
  const desk = new DevnetIssuer(ledger, issuerKey);
  const withdrawn = await desk.withdrawProceeds(mintAddress);
  console.log(`✓ issuer withdrew ${usdc(BigInt(withdrawn.amount))} of proceeds  ${tx(withdrawn.signature)}`);
  ledger.changed();
  const inst = await ledger.getInstrument(mintAddress);
  const ref = await ledger.client.fetchInstrumentByMint(new PublicKey(mintAddress));
  const period = (ref?.account.couponPeriods ?? 0) + 1;
  const now = await ledger.clusterNow();
  const draft: ActionDraft = { kind: "Coupon", recordTs: now + 40, paymentTs: now + 100, claimDeadlineTs: now + 30 * 86_400, params: { kind: "Coupon", period, couponBps: inst!.couponBps } };
  const announced = await desk.announce(mintAddress, draft);
  console.log(`✓ coupon ${period} announced  ${tx(announced.signature)}`);
  const waitFor = async (ts: number, what: string) => {
    while ((await ledger.clusterNow()) < ts + 1) {
      process.stdout.write(`  … waiting for ${what}\r`);
      await sleep(4_000);
    }
  };
  await waitFor(draft.recordTs, "record date");
  ledger.changed();
  console.log(`✓ lock_record  ${tx((await desk.lockRecord(announced.actionId)).signature)}`);
  ledger.changed();
  console.log(`✓ post_snapshot  ${tx((await desk.postSnapshot(announced.actionId)).signature)}`);
  ledger.changed();
  console.log(`✓ fund  ${tx((await desk.fund(announced.actionId)).signature)}`);
  await waitFor(draft.paymentTs, "payment date");
  ledger.changed();
  const before = await usdcOf(buyer.publicKey);
  const snapshot = await ledger.getSnapshot(announced.actionId);
  for (const h of snapshot?.holdings ?? []) {
    const paid = await desk.pay(announced.actionId, h.holder);
    console.log(`✓ pay ${h.holder.slice(0, 6)}… (${h.units} units)  ${tx(paid.signature)}`);
    ledger.changed();
  }
  console.log(`✓ settle  ${tx((await desk.settle(announced.actionId)).signature)}`);
  console.log(`buyer USDC ${usdc(before)} → ${usdc(await usdcOf(buyer.publicKey))} (coupon in real devnet USDC)`);
}

function smokeCookie(wallet: string) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET is missing");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ email: "devnet-smoke@example.com", iat: now, exp: now + 3600, walletAddress: wallet, smoke: true })).toString("base64url");
  return `rwa_bridge_session=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function httpSmoke(base: string, wallet: string) {
  const cookie = smokeCookie(wallet);
  const overview = await (await fetch(`${base}/api/bonds`, { headers: { cookie } })).json();
  const first = overview.offerings?.[0];
  console.log(`GET /api/bonds → default offering ${first?.symbol} at ${first?.purchase?.priceAtomic} per unit, open=${first?.purchase?.open}, ${first?.purchase?.soldUnits}/${first?.purchase?.capUnits} sold; position ${overview.positions?.find((p: { mint: string }) => p.mint === mintAddress)?.units ?? 0} units`);
  const response = await fetch(`${base}/api/bonds/${mintAddress}/purchase`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ amountAtomic: "1", requestId: randomUUID(), walletAddress: wallet, cluster: "devnet" }),
  });
  console.log(`POST /api/bonds/${mintAddress.slice(0, 6)}…/purchase → ${response.status} ${JSON.stringify(await response.json())}`);
  console.log("  (expected for a smoke session: Crossmint wallet verification needs a real email login)");
}

async function main() {
  const bought = await chainPurchase();
  if (process.argv.includes("--coupon")) await couponRun();
  const base = arg("http");
  if (base) await httpSmoke(base, buyer.publicKey.toBase58());
  void bought;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
