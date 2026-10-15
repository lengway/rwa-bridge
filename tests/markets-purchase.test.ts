import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { Connection, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { BN } from "@anchor-lang/core";

import type { CanonicalInstruction } from "../lib/kamino-instruction-intent";
import { XMSWI_WALLET_WRAPPER_PROGRAM_ID, type NormalizedFinalizedRpcReceipt, type NormalizedTraceInstruction } from "../lib/kamino-smart-wallet-receipt";
import { MarketsClient, PLAIN_MARKETS_IDL, type InstrumentRef } from "../lib/markets/client";
import {
  CIRCLE_DEVNET_USDC,
  CIRCLE_DEVNET_USDC_ADDRESS,
  MARKETS_SUBSCRIBE_ACTION,
  PLAIN_MARKETS_PROGRAM,
  SPL_TOKEN_PROGRAM,
  SUBSCRIBE_DISCRIMINATOR,
  TOKEN_2022_PROGRAM,
  subscribeAccounts,
  subscribeData,
  validateSubscribeIntent,
  type SubscribeTerms,
} from "../lib/markets/purchase";
import { validateFinalizedSubscribeReceipt } from "../lib/markets/purchase-receipt";
import {
  parsePreparedSmartWalletOperation,
  continueSmartWalletChain,
  type PreparedSmartWalletOperation,
  type SmartWalletChainDependencies,
  type StoredSmartWalletOperation,
} from "../lib/kamino-smart-wallet-client";

// A Crossmint-like smart wallet: an off-curve PDA.
const wallet = PublicKey.findProgramAddressSync([Buffer.from("smart_account"), Keypair.generate().publicKey.toBuffer()], new PublicKey(XMSWI_WALLET_WRAPPER_PROGRAM_ID))[0];
const walletAddress = wallet.toBase58();
const sponsor = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey;
const PRICE = BigInt(1_000_000);
const terms: SubscribeTerms = {
  mint: mint.toBase58(),
  issuePrice: PRICE.toString(),
  allowlistEnabled: false,
  settlementMint: CIRCLE_DEVNET_USDC_ADDRESS,
  settlementTokenProgram: SPL_TOKEN_PROGRAM,
};
const accounts = subscribeAccounts(walletAddress, terms);
const client = MarketsClient.fromConnection(new Connection("http://127.0.0.1:1"));

function instrumentRef(allowlistEnabled = false): InstrumentRef {
  return {
    address: new PublicKey(accounts.instrument),
    account: { mint, settlementMint: CIRCLE_DEVNET_USDC, settlementTokenProgram: TOKEN_PROGRAM_ID, allowlistEnabled, issuer: Keypair.generate().publicKey } as unknown as InstrumentRef["account"],
  };
}

const canonical = (ix: TransactionInstruction): CanonicalInstruction => ({
  programId: ix.programId.toBase58(),
  accounts: ix.keys.map((k) => ({ address: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
  dataBase58: bs58.encode(ix.data),
});

async function payload(units = BigInt(5), maxPayment = units * PRICE, opts: { bondAta?: boolean; allowlist?: boolean } = {}) {
  const ixs: TransactionInstruction[] = [];
  if (opts.bondAta ?? true) ixs.push(createAssociatedTokenAccountIdempotentInstruction(wallet, new PublicKey(accounts.buyerBond), wallet, mint, TOKEN_2022_PROGRAM_ID));
  ixs.push(await client.subscribe(instrumentRef(opts.allowlist), wallet, units, maxPayment));
  return ixs.map(canonical);
}

const intent = (instructions: CanonicalInstruction[], units = "5", costAtomic = "5000000") => ({ action: MARKETS_SUBSCRIBE_ACTION, walletAddress, units, costAtomic, instructions });

// ---- pinned constants ---------------------------------------------------------------------------

test("pinned program id and subscribe discriminator match the synced IDL", () => {
  assert.equal(PLAIN_MARKETS_IDL.address, PLAIN_MARKETS_PROGRAM);
  const ix = PLAIN_MARKETS_IDL.instructions.find((i) => i.name === "subscribe")!;
  assert.deepEqual([...SUBSCRIBE_DISCRIMINATOR], ix.discriminator);
  assert.equal(TOKEN_2022_PROGRAM, TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(SPL_TOKEN_PROGRAM, TOKEN_PROGRAM_ID.toBase58());
});

// ---- intent ----------------------------------------------------------------------------------------

test("the Anchor-built purchase matches the independently derived intent", async () => {
  const ok = validateSubscribeIntent(intent(await payload()), terms);
  assert.equal(ok.units, "5");
  assert.equal(ok.costAtomic, "5000000");
  assert.deepEqual(ok.createdAccounts, [accounts.buyerBond]);
  // Without the ATA creation (account already exists) it is still valid.
  validateSubscribeIntent(intent(await payload(BigInt(5), BigInt(5) * PRICE, { bondAta: false })), terms);
  // Allowlisted bonds carry the wallet's allow entry instead of the program-id placeholder.
  const allowTerms = { ...terms, allowlistEnabled: true };
  validateSubscribeIntent(intent(await payload(BigInt(5), BigInt(5) * PRICE, { allowlist: true })), allowTerms);
  const plain = await payload();
  assert.throws(() => validateSubscribeIntent(intent(plain), allowTerms), /account 8/);
});

test("rejects underpayment, unit mismatch and terms that are not USDC at the on-chain price", async () => {
  const p5 = await payload();
  // max_payment below units × price
  assert.throws(() => validateSubscribeIntent(intent(p5, "5", "4999999"), terms), /cost must equal/);
  const under = await payload(BigInt(5), BigInt(4_999_999));
  assert.throws(() => validateSubscribeIntent(intent(under), terms), /max payment do not match/);
  // more units in the bytes than in the intent
  await assert.rejects(async () => validateSubscribeIntent(intent(await payload(BigInt(6), BigInt(6) * PRICE)), terms), /units or max payment/);
  // terms tampering
  assert.throws(() => validateSubscribeIntent(intent(p5), { ...terms, settlementMint: Keypair.generate().publicKey.toBase58() }), /Circle devnet USDC/);
  assert.throws(() => validateSubscribeIntent(intent(p5), { ...terms, settlementTokenProgram: TOKEN_2022_PROGRAM }), /SPL Token/);
  // a cheaper price than the on-chain terms
  await assert.rejects(async () => validateSubscribeIntent(intent(await payload(BigInt(5), BigInt(5) * PRICE), "5", "5000000"), { ...terms, issuePrice: "999999" }), /cost must equal/);
  assert.throws(() => validateSubscribeIntent(intent(p5, "1001", "1001000000"), terms), /per-purchase limit/);
});

test("rejects swapped accounts, privilege changes and foreign programs", async () => {
  const base = await payload();
  const mutate = (index: number, change: (ix: CanonicalInstruction) => void) => {
    const copy = structuredClone(base);
    change(copy[index]);
    return copy;
  };
  const thief = Keypair.generate().publicKey.toBase58();
  // proceeds vault redirected
  assert.throws(() => validateSubscribeIntent(intent(mutate(1, (ix) => { ix.accounts[6].address = thief; })), terms), /account 6/);
  // a fake settlement mint
  assert.throws(() => validateSubscribeIntent(intent(mutate(1, (ix) => { ix.accounts[7].address = thief; })), terms), /account 7/);
  // bond delivered elsewhere
  assert.throws(() => validateSubscribeIntent(intent(mutate(1, (ix) => { ix.accounts[4].address = thief; })), terms), /account 4/);
  // buyer not signing
  assert.throws(() => validateSubscribeIntent(intent(mutate(1, (ix) => { ix.accounts[0].isSigner = false; })), terms), /account 0/);
  // settlement mint made writable
  assert.throws(() => validateSubscribeIntent(intent(mutate(1, (ix) => { ix.accounts[7].isWritable = true; })), terms), /account 7/);
  // another program id
  assert.throws(() => validateSubscribeIntent(intent(mutate(1, (ix) => { ix.programId = thief; })), terms), /not allowed/);
  // extra account appended
  assert.throws(() => validateSubscribeIntent(intent(mutate(1, (ix) => { ix.accounts.push({ address: thief, isSigner: false, isWritable: true }); })), terms), /exactly 11/);
  // ATA paid by someone else, or for a foreign owner
  assert.throws(() => validateSubscribeIntent(intent(mutate(0, (ix) => { ix.accounts[0].address = sponsor; })), terms), /payer/);
  assert.throws(() => validateSubscribeIntent(intent(mutate(0, (ix) => { ix.accounts[1].address = thief; })), terms), /ATA target/);
  // a raw SPL transfer smuggled in front, or the subscribe not last, or twice the ATA
  const transfer = canonical(createTransferCheckedInstruction(new PublicKey(accounts.buyerSettlement), CIRCLE_DEVNET_USDC, new PublicKey(thief), wallet, BigInt(1), 6));
  assert.throws(() => validateSubscribeIntent(intent([transfer, ...base]), terms), /not allowed/);
  assert.throws(() => validateSubscribeIntent(intent([base[1], base[0]]), terms), /not allowed/);
  assert.throws(() => validateSubscribeIntent(intent([base[0], base[0], base[1]]), terms), /duplicate ATA/);
  // a compiled template marks the fee-payer placeholder (the buyer) writable: accepted
  validateSubscribeIntent(intent(mutate(1, (ix) => { ix.accounts[0].isWritable = true; })), terms);
});

// ---- finalized receipt -----------------------------------------------------------------------------

const signature = bs58.encode(Buffer.alloc(64, 9));
const fee = 5000;
const rent = BigInt(2_157_440);

function ins(programId: string, keys: string[], data: Uint8Array, stackHeight?: number): NormalizedTraceInstruction {
  return { programId, accounts: keys, dataBase58: bs58.encode(data), ...(stackHeight === undefined ? {} : { stackHeight }) };
}
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const direct = (ix: CanonicalInstruction) => ins(ix.programId, ix.accounts.map((a) => a.address), bs58.decode(ix.dataBase58), 2);

function ataCpis(target: string, tokenProgram: string, ataMint: string, lamports = rent) {
  const create = Buffer.alloc(52);
  create.writeUInt32LE(0, 0);
  create.writeBigUInt64LE(lamports, 4);
  create.writeBigUInt64LE(BigInt(170), 12);
  new PublicKey(tokenProgram).toBuffer().copy(create, 20);
  return [
    ins(tokenProgram, [ataMint], Uint8Array.of(21, 7, 0), 3),
    ins("11111111111111111111111111111111", [walletAddress, target], create, 3),
    ins(tokenProgram, [target], Uint8Array.of(22), 3),
    ins(tokenProgram, [target, ataMint], Buffer.concat([Buffer.from([18]), wallet.toBuffer()]), 3),
  ];
}

const pay = (amount = BigInt(5) * PRICE, to = accounts.proceedsVault) =>
  ins(SPL_TOKEN_PROGRAM, [accounts.buyerSettlement, CIRCLE_DEVNET_USDC_ADDRESS, to, walletAddress], Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([6])]), 3);
const deliver = (units = BigInt(5), to = accounts.buyerBond) => ins(TOKEN_2022_PROGRAM, [terms.mint, to, accounts.instrument], Buffer.concat([Buffer.from([7]), u64(units)]), 3);

const keys = [sponsor, walletAddress, accounts.buyerSettlement, accounts.buyerBond, accounts.proceedsVault, accounts.instrument, accounts.offering, terms.mint, CIRCLE_DEVNET_USDC_ADDRESS, PLAIN_MARKETS_PROGRAM, XMSWI_WALLET_WRAPPER_PROGRAM_ID];
const bal = (account: string, owner: string, mintAddress: string, amount: string, decimals: number) => ({ accountIndex: keys.indexOf(account), mint: mintAddress, owner, amount, decimals });

async function receiptFixture(over: { trace?: NormalizedTraceInstruction[]; post?: ReturnType<typeof bal>[]; walletLamports?: [number, number]; funding?: boolean } = {}) {
  const expected = await payload();
  const trace = over.trace ?? [direct(expected[0]), ...ataCpis(accounts.buyerBond, TOKEN_2022_PROGRAM, terms.mint), direct(expected[1]), pay(), deliver()];
  const top: NormalizedTraceInstruction[] = [ins("ComputeBudget111111111111111111111111111111", [], Buffer.concat([Buffer.from([2]), Buffer.from([0x40, 0x0d, 0x03, 0])]))];
  if (over.funding !== false) {
    const t = Buffer.alloc(12);
    t.writeUInt32LE(2, 0);
    t.writeBigUInt64LE(rent, 4);
    top.push(ins("11111111111111111111111111111111", [sponsor, walletAddress], t));
  }
  top.push(ins(XMSWI_WALLET_WRAPPER_PROGRAM_ID, [Keypair.generate().publicKey.toBase58(), walletAddress], Uint8Array.of(4)));
  const pre = keys.map(() => 50_000_000);
  const post = [...pre];
  post[0] -= fee + Number(rent);
  const [wPre, wPost] = over.walletLamports ?? [pre[1], pre[1]];
  pre[1] = wPre;
  post[1] = wPost;
  const receipt: NormalizedFinalizedRpcReceipt = {
    commitment: "finalized",
    signature,
    accountKeys: keys,
    requiredSignerAddresses: [sponsor],
    signatures: [signature],
    topLevelInstructions: top,
    meta: {
      err: null,
      fee,
      preBalances: pre,
      postBalances: post,
      preTokenBalances: [bal(accounts.buyerSettlement, walletAddress, CIRCLE_DEVNET_USDC_ADDRESS, "20000000", 6), bal(accounts.proceedsVault, accounts.offering, CIRCLE_DEVNET_USDC_ADDRESS, "0", 6)],
      postTokenBalances: over.post ?? [
        bal(accounts.buyerSettlement, walletAddress, CIRCLE_DEVNET_USDC_ADDRESS, "15000000", 6),
        bal(accounts.proceedsVault, accounts.offering, CIRCLE_DEVNET_USDC_ADDRESS, "5000000", 6),
        bal(accounts.buyerBond, walletAddress, terms.mint, "5", 0),
      ],
      innerInstructions: [{ index: top.length - 1, instructions: trace }],
    },
  };
  const verify = () => validateFinalizedSubscribeReceipt({
    intent: { walletAddress, feePayerAddress: sponsor, units: "5", costAtomic: "5000000", computeUnitLimit: 200_000, computeUnitPriceMicroLamports: "0" },
    terms,
    expectedDecodedWrapperInstructions: expected,
    receipt,
  });
  return { expected, receipt, verify };
}

test("verifies a finalized DvP purchase: USDC debited exactly the price, units credited exactly", async () => {
  const { verify } = await receiptFixture();
  assert.deepEqual(verify(), { verified: true, signature, walletAddress, feePayerAddress: sponsor, mint: terms.mint, units: "5", costAtomic: "5000000", feeLamports: "5000" });
});

test("rejects a receipt whose payment, delivery or balances differ from the intent", async () => {
  const f = await receiptFixture();
  const rebuild = async (trace: (e: CanonicalInstruction[]) => NormalizedTraceInstruction[]) => (await receiptFixture({ trace: trace(f.expected) })).verify;
  const head = (e: CanonicalInstruction[]) => [direct(e[0]), ...ataCpis(accounts.buyerBond, TOKEN_2022_PROGRAM, terms.mint), direct(e[1])];
  assert.throws(await rebuild((e) => [...head(e), pay(BigInt(4_999_999)), deliver()]), /payment leg amount/);
  assert.throws(await rebuild((e) => [...head(e), pay(undefined, sponsor), deliver()]), /payment leg source/);
  assert.throws(await rebuild((e) => [...head(e), pay(), deliver(BigInt(6))]), /delivery leg units/);
  assert.throws(await rebuild((e) => [...head(e), pay(), deliver(undefined, sponsor)]), /delivery leg mint/);
  assert.throws(await rebuild((e) => [...head(e), pay(), deliver(), pay()]), /exactly TransferChecked then MintTo/);
  assert.throws(await rebuild((e) => [...head(e), deliver()]), /exactly TransferChecked then MintTo/);
  // token balances that do not match the CPIs
  const post = (usdc: string, vault: string, bond: string) => [
    bal(accounts.buyerSettlement, walletAddress, CIRCLE_DEVNET_USDC_ADDRESS, usdc, 6),
    bal(accounts.proceedsVault, accounts.offering, CIRCLE_DEVNET_USDC_ADDRESS, vault, 6),
    bal(accounts.buyerBond, walletAddress, terms.mint, bond, 0),
  ];
  assert.throws((await receiptFixture({ post: post("14000000", "5000000", "5") })).verify, /debited exactly/);
  assert.throws((await receiptFixture({ post: post("15000000", "4000000", "5") })).verify, /proceeds vault/);
  assert.throws((await receiptFixture({ post: post("15000000", "5000000", "4") })).verify, /credited exactly/);
});

test("rejects failed transactions, foreign fee payers and lamports drained from the wallet", async () => {
  const f = await receiptFixture();
  f.receipt.meta.err = { InstructionError: [0, { Custom: 6061 }] };
  assert.throws(f.verify, /failed/);
  const g = await receiptFixture();
  g.receipt.requiredSignerAddresses = [walletAddress];
  assert.throws(g.verify, /sponsor must sign/);
  // The wallet may pay the rent of its new bond account, nothing more.
  const ok = await receiptFixture({ funding: false, walletLamports: [50_000_000, 50_000_000 - Number(rent)] });
  ok.verify();
  const drained = await receiptFixture({ funding: false, walletLamports: [50_000_000, 50_000_000 - Number(rent) - 1] });
  assert.throws(drained.verify, /lamports dropped/);
});

// ---- client parsing and journal ---------------------------------------------------------------------

const requestId = "0b8f3a52-8d55-4c1f-9f0f-6b1e2a3c4d5e";
const prepared = { actionId: requestId, providerTransactionId: "tx-1", action: "markets-subscribe", amountAtomic: "5", mint: terms.mint, network: "devnet", stage: "READY", feeMode: "project", walletAddress, simulation: { ok: true } };

test("a prepared purchase must be for the requested bond", () => {
  const ok = parsePreparedSmartWalletOperation(prepared, { walletAddress, action: "markets-subscribe", amountAtomic: "5", requestId, mint: terms.mint });
  assert.equal(ok.mint, terms.mint);
  assert.throws(() => parsePreparedSmartWalletOperation(prepared, { walletAddress, action: "markets-subscribe", amountAtomic: "5", requestId, mint: Keypair.generate().publicKey.toBase58() }), /different bond/);
  assert.throws(() => parsePreparedSmartWalletOperation({ ...prepared, mint: undefined }, { walletAddress, action: "markets-subscribe", amountAtomic: "5", requestId, mint: terms.mint }), /invalid address/);
  assert.throws(() => parsePreparedSmartWalletOperation({ ...prepared, action: "deposit" }, { walletAddress, action: "deposit", amountAtomic: "5", requestId }), /unexpected bond/);
});

test("one tap: wallet setup first, then the purchase continues with the same bond and units", async () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const calls: string[] = [];
  const approved = new Set<string>();
  let setup = true;
  const prepares: { mint?: string; amountAtomic: string }[] = [];
  const respond = (operation: StoredSmartWalletOperation, stage: "READY" | "SETUP_REQUIRED"): PreparedSmartWalletOperation => ({
    ...operation, network: "devnet", feeMode: "project", stage, simulation: { ok: true },
    ...(stage === "READY" ? { providerTransactionId: operation.actionId } : {}),
  });
  const dependencies: SmartWalletChainDependencies = {
    newId: () => ids.shift()!,
    store: () => {},
    clear: () => { calls.push("clear"); },
    prepare: async (request, w) => {
      prepares.push({ mint: request.mint, amountAtomic: request.amountAtomic });
      return respond({ ...request, actionId: request.requestId, walletAddress: w }, setup ? "SETUP_REQUIRED" : "READY");
    },
    initialize: async (id, w) => respond({ actionId: id, walletAddress: w, action: "initialize", amountAtomic: "0" }, "READY"),
    status: async (id, w, action) => {
      const done = approved.has(id);
      if (done && action === "initialize") setup = false;
      return { actionId: id, action, walletAddress: w, network: "devnet", feeMode: "project",
        stage: done ? "COMPLETED" : setup && action !== "initialize" ? "SETUP_REQUIRED" : "READY", confirmed: done, ...(done ? { signature: "s".repeat(64) } : {}) };
    },
    wait: async () => {},
  };
  const result = await continueSmartWalletChain({
    operation: null, action: "markets-subscribe", amountAtomic: "5", mint: terms.mint, walletAddress, userTap: true,
    signal: new AbortController().signal, approve: async (id) => { calls.push(`approve:${id}`); approved.add(id); },
    onOperation: () => {}, onProgress: () => {}, dependencies,
  });
  assert.equal(result?.action, "markets-subscribe");
  assert.equal(result?.stage, "COMPLETED");
  assert.deepEqual(prepares, [{ mint: terms.mint, amountAtomic: "5" }, { mint: terms.mint, amountAtomic: "5" }]);
  assert.equal(calls.filter((c) => c.startsWith("approve:")).length, 2);
});

test("subscribe data encodes units and max payment little-endian after the discriminator", () => {
  const data = subscribeData(BigInt(5), BigInt(5_000_000));
  assert.equal(data.length, 24);
  assert.equal(new BN(Buffer.from(data.slice(8, 16)), "le").toString(), "5");
  assert.equal(new BN(Buffer.from(data.slice(16, 24)), "le").toString(), "5000000");
});

// ---- investor view ---------------------------------------------------------------------------------

test("purchase terms mirror the program's subscribe preconditions in plain words", async () => {
  const { purchaseTerms } = await import("../lib/markets/investor");
  const now = 1_800_000_000;
  const offering = {
    address: "o", proceedsVault: "v", issuePrice: PRICE, startTs: now - 10, endTs: now + 1_000, capUnits: BigInt(100), perHolderCap: BigInt(10),
    soldUnits: BigInt(40), proceeds: BigInt(40) * PRICE, withdrawn: BigInt(0), closed: false, purchases: [], withdrawals: [],
  };
  const issue = { status: "Active" as const, maturityTs: now + 10_000, lockFrom: 0, lockUntil: 0, pendingAction: false, openRedemption: false };
  const instrument = { settlementSymbol: "USDC" } as Parameters<typeof purchaseTerms>[0]["instrument"];
  const run = (over: Partial<typeof offering> = {}, held = BigInt(3), state = issue, inst = instrument) =>
    purchaseTerms({ instrument: inst, issue: state, offering: { ...offering, ...over }, heldUnits: held }, now);
  assert.deepEqual(
    { open: run()!.open, max: run()!.maxForWallet, price: run()!.priceAtomic },
    { open: true, max: "7", price: "1000000" },
  );
  assert.equal(run({ soldUnits: BigInt(98) })!.maxForWallet, "2");
  assert.match(run({ closed: true })!.reason!, /closed/);
  assert.match(run({ startTs: now + 5 })!.reason!, /opens on/);
  assert.match(run({ endTs: now })!.reason!, /ended/);
  assert.match(run({ soldUnits: BigInt(100) })!.reason!, /sold out/);
  assert.match(run({}, BigInt(10))!.reason!, /maximum of 10/);
  assert.match(run({}, BigInt(3), { ...issue, pendingAction: true })!.reason!, /Purchases reopen/);
  assert.match(run({}, BigInt(3), { ...issue, lockFrom: now - 1, lockUntil: now + 1 })!.reason!, /locked/);
  // Test-USD bonds and bonds without an offering are not sold in Plain.
  assert.equal(run({}, BigInt(0), issue, { settlementSymbol: "USD" } as typeof instrument), null);
  assert.equal(purchaseTerms({ instrument, issue, offering: null, heldUnits: BigInt(0) }, now), null);
});
