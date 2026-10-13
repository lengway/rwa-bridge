/**
 * Plain Markets end-to-end demo: one tokenized bond through its whole servicing life on-chain.
 *
 *   coupon (claim + push payments) → bondholder vote → 25% partial redemption → final redemption
 *
 * Every step prints an explorer link. Also demonstrates the ex-date lock (a transfer attempted
 * after the record date is rejected by the transfer hook) and a double-claim attempt.
 *
 *   npx tsx scripts/markets-demo.ts                    # devnet, Solana CLI default keypair pays
 *   MARKETS_RPC=http://127.0.0.1:8899 npx tsx scripts/markets-demo.ts   # local validator
 *
 * Env: MARKETS_RPC, MARKETS_KEYPAIR (path; default = keypair_path from the Solana CLI config).
 * Writes addresses, signatures and the published snapshots to .data/markets-demo/ (gitignored).
 * No secret is ever printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AnchorProvider, Wallet } from "@anchor-lang/core";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import {
  type ActionRef,
  type AnnounceInput,
  type InstrumentRef,
  MarketsClient,
  bondTransferInstructions,
  enumName,
  marketsErrorFromCode,
  toBigInt,
} from "../lib/markets/client";
import { actionTotals, type ActionKind } from "../lib/markets/entitlements";
import { buildSnapshotTree, canonicalSnapshotJson, snapshotHash, toHex, type SnapshotTree } from "../lib/markets/merkle";
import { readRegister } from "../lib/markets/register";

const RPC = process.env.MARKETS_RPC ?? "https://api.devnet.solana.com";
const LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
const OUT_DIR = join(process.cwd(), ".data", "markets-demo");
const USD = BigInt(1_000_000);

function cliKeypairPath(): string {
  if (process.env.MARKETS_KEYPAIR) return process.env.MARKETS_KEYPAIR;
  try {
    const cfg = readFileSync(join(homedir(), ".config", "solana", "cli", "config.yml"), "utf8");
    const m = cfg.match(/^keypair_path:\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^~/, homedir());
  } catch {
    // fall through
  }
  return join(homedir(), ".config", "solana", "id.json");
}

const loadKeypair = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));

const explorer = (kind: "tx" | "address", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=${LOCAL ? `custom&customUrl=${encodeURIComponent(RPC)}` : "devnet"}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtUsd = (v: bigint) => `$${(Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

type Step = { step: string; signature: string; url: string };

class Demo {
  readonly connection = new Connection(RPC, "confirmed");
  readonly payer = loadKeypair(cliKeypairPath());
  readonly client = MarketsClient.fromProvider(
    new AnchorProvider(this.connection, new Wallet(this.payer), { commitment: "confirmed" }),
  );
  readonly steps: Step[] = [];
  readonly snapshots: Record<string, unknown> = {};

  /** Signs with whichever of [payer, ...signers] the instructions require; first signer pays fees. */
  async send(step: string, ixs: TransactionInstruction[], signers: Keypair[] = []): Promise<string> {
    const feePayer = signers[0] ?? this.payer;
    const tx = new Transaction().add(...ixs);
    tx.feePayer = feePayer.publicKey;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    const required = new Set([feePayer.publicKey.toBase58(), ...ixs.flatMap((i) => i.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58()))]);
    const pool = [feePayer, ...signers, this.payer];
    const chosen = [...required].map((k) => pool.find((p) => p.publicKey.toBase58() === k)).filter((k): k is Keypair => !!k);
    tx.sign(...chosen);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const res = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`${step} failed: ${JSON.stringify(res.value.err)}`);
    const url = explorer("tx", signature);
    this.steps.push({ step, signature, url });
    console.log(`  ✓ ${step.padEnd(46)} ${url}`);
    return signature;
  }

  /** Sends a transaction that must fail; prints the program error it failed with. */
  async expectFailure(step: string, ixs: TransactionInstruction[], signers: Keypair[], expected: string) {
    try {
      await this.send(step, ixs, signers);
    } catch (e) {
      const logs = e instanceof SendTransactionError ? (e.logs ?? []) : [];
      const msg = String((e as Error).message) + logs.join("\n");
      const code = msg.match(/custom program error: 0x([0-9a-f]+)/i);
      const name = code ? marketsErrorFromCode(parseInt(code[1], 16))?.name : undefined;
      if (name !== expected) throw new Error(`${step}: expected ${expected}, got ${name ?? msg.slice(0, 300)}`);
      console.log(`  ✗ ${step.padEnd(46)} rejected on-chain: ${name} (as intended)`);
      return;
    }
    throw new Error(`${step}: expected failure ${expected} but it succeeded`);
  }

  async chainNow(): Promise<number> {
    const slot = await this.connection.getSlot("confirmed");
    return (await this.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  }

  async waitUntil(ts: number, label: string) {
    let now = await this.chainNow();
    if (now < ts) process.stdout.write(`  … waiting ${ts - now}s for ${label}`);
    while (now < ts) {
      await sleep(Math.min(4000, (ts - now) * 1000 + 500));
      now = await this.chainNow();
      process.stdout.write(".");
    }
    if (process.stdout.isTTY) process.stdout.write("\n");
    else console.log("");
  }

  async instrument(address: PublicKey): Promise<InstrumentRef> {
    const r = await this.client.fetchInstrument(address);
    if (!r) throw new Error("instrument not found");
    return r;
  }

  async action(address: PublicKey): Promise<ActionRef> {
    const r = await this.client.fetchAction(address);
    if (!r) throw new Error("action not found");
    return r;
  }
}

async function main() {
  const d = new Demo();
  const { connection, payer, client } = d;
  console.log(`Plain Markets demo on ${RPC}`);
  console.log(`program  ${client.programId.toBase58()}  ${explorer("address", client.programId.toBase58())}`);
  console.log(`issuer   ${payer.publicKey.toBase58()} (Solana CLI keypair; also the paying agent)`);
  const programInfo = await connection.getAccountInfo(client.programId);
  if (!programInfo?.executable) throw new Error(`program ${client.programId.toBase58()} is not deployed on ${RPC}`);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`balance  ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 0.15e9) throw new Error("issuer needs at least 0.15 SOL for the demo");

  // ---- settlement token + holders ------------------------------------------------------------------
  console.log("1. Settlement token and investors");
  const usdMint = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await d.send(
    "create test USD settlement mint (6 dp)",
    [
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: usdMint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(usdMint.publicKey, 6, payer.publicKey, null),
    ],
    [payer, usdMint],
  );
  const issuerUsd = getAssociatedTokenAddressSync(usdMint.publicKey, payer.publicKey);
  await d.send("mint 1,000,000 test USD to the issuer", [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, issuerUsd, payer.publicKey, usdMint.publicKey),
    createMintToInstruction(usdMint.publicKey, issuerUsd, payer.publicKey, BigInt(1_000_000) * USD),
  ]);

  const names = ["alice", "bob", "carol"] as const;
  const holders = Object.fromEntries(names.map((n) => [n, Keypair.generate()])) as Record<(typeof names)[number], Keypair>;
  mkdirSync(join(OUT_DIR, "holders"), { recursive: true });
  for (const n of names) writeFileSync(join(OUT_DIR, "holders", `${n}.json`), JSON.stringify(Array.from(holders[n].secretKey)));
  await d.send(
    "fund investor wallets with 0.02 SOL for fees",
    names.map((n) => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: holders[n].publicKey, lamports: 20_000_000 })),
  );
  for (const n of names) console.log(`     ${n.padEnd(6)} ${holders[n].publicKey.toBase58()}`);

  // ---- instrument --------------------------------------------------------------------------------
  console.log("\n2. Issue the bond (Token-2022: transfer hook + permanent delegate + metadata)");
  const bondMint = Keypair.generate();
  const now = await d.chainNow();
  const faceValue = BigInt(1_000) * USD;
  await d.send(
    "initialize_instrument PKZ27 (12.5% semi-annual)",
    [
      await client.initializeInstrument({
        issuer: payer.publicKey,
        mint: bondMint.publicKey,
        settlementMint: usdMint.publicKey,
        settlementTokenProgram: TOKEN_PROGRAM_ID,
        params: {
          name: "Plain KZ Bond 2027",
          symbol: "PKZ27",
          uri: "",
          isin: "KZ2C00012345",
          faceValue,
          couponBps: 1250,
          couponFrequency: 2,
          issueTs: now,
          maturityTs: now + 3600,
          allowlistEnabled: false,
        },
      }),
    ],
    [payer, bondMint],
  );
  const instrumentAddr = (await client.fetchInstrumentByMint(bondMint.publicKey))!.address;
  console.log(`     mint       ${explorer("address", bondMint.publicKey.toBase58())}`);
  console.log(`     instrument ${explorer("address", instrumentAddr.toBase58())}`);
  let inst = await d.instrument(instrumentAddr);
  const units = { alice: BigInt(50), bob: BigInt(30), carol: BigInt(20) };
  for (const n of names) await d.send(`issue ${units[n]} units to ${n}`, [await client.issue(inst, holders[n].publicKey, units[n])]);
  const candidates = names.map((n) => holders[n].publicKey);

  /** announce → (wait record date) lock_record → read register → post_snapshot. */
  async function recordAndSnapshot(label: string, input: AnnounceInput): Promise<{ action: ActionRef; tree: SnapshotTree }> {
    inst = await d.instrument(instrumentAddr);
    const { ix, action } = await client.announce(inst, input);
    await d.send(`${label}: announce`, [ix]);
    await d.waitUntil(input.recordTs, "record date");
    await d.send(`${label}: lock_record (crank)`, [await client.lockRecord(inst, action, payer.publicKey)]);
    const register = await readRegister(connection, bondMint.publicKey, { candidates });
    const tree = buildSnapshotTree(action, register.holdings);
    const snapshot = {
      version: 1 as const,
      instrument: instrumentAddr.toBase58(),
      mint: bondMint.publicKey.toBase58(),
      action: action.toBase58(),
      recordTs: input.recordTs,
      slot: register.slot,
      holdings: register.holdings,
    };
    d.snapshots[action.toBase58()] = JSON.parse(canonicalSnapshotJson(snapshot));
    const totals = actionTotals(
      { faceValue, couponBps: 1250, frequency: 2 },
      { kind: input.kind as ActionKind, rateBps: input.rateBps ?? 0, redeemBps: input.redeemBps ?? 0, priceBps: input.priceBps ?? 0 },
      register.holdings,
    );
    await d.send(`${label}: post_snapshot root ${toHex(tree.root).slice(0, 12)}…`, [
      await client.postSnapshot(inst, action, {
        merkleRoot: tree.root,
        snapshotHash: snapshotHash(snapshot),
        totalUnits: register.supply,
        holderCount: register.holdings.length,
        totalRedeemUnits: totals.totalRedeemUnits,
      }),
    ]);
    const a = await d.action(action);
    if (toBigInt(a.account.totalEntitlement) !== totals.totalEntitlement) throw new Error("on-chain total differs from off-chain math");
    if (totals.totalEntitlement > BigInt(0)) console.log(`     total entitlement computed on-chain: ${fmtUsd(totals.totalEntitlement)} (matches off-chain math)`);
    return { action: a, tree };
  }

  async function fundAndPay(label: string, action: ActionRef, tree: SnapshotTree, claimers: string[], tryDoubleClaim = false) {
    inst = await d.instrument(instrumentAddr);
    await d.send(`${label}: fund ${fmtUsd(toBigInt(action.account.totalEntitlement))}`, [
      await client.fund(inst, action.address, toBigInt(action.account.totalEntitlement)),
    ]);
    await d.waitUntil(action.account.paymentTs.toNumber(), "payment date");
    for (const n of names) {
      const h = holders[n].publicKey;
      const u = tree.holdingOf(h)!.units;
      const fresh = await d.action(action.address);
      if (claimers.includes(n)) {
        await d.send(`${label}: ${n} claims (pull)`, [await client.claim(inst, fresh, h, u, tree.proof(h))], [holders[n]]);
      } else {
        await d.send(`${label}: paying agent pays ${n} (push)`, [await client.pay(inst, fresh, payer.publicKey, h, u, tree.proof(h))]);
      }
    }
    if (tryDoubleClaim) {
      const n = claimers[0] as (typeof names)[number];
      const h = holders[n].publicKey;
      await d.expectFailure(`${label}: ${n} claims again`, [await client.claim(inst, await d.action(action.address), h, tree.holdingOf(h)!.units, tree.proof(h))], [holders[n]], "AlreadyClaimed");
    }
    const fresh = await d.action(action.address);
    await d.send(`${label}: settle`, [await client.settle(inst, fresh, payer.publicKey)]);
    const settled = await d.action(action.address);
    console.log(`     paid ${fmtUsd(toBigInt(settled.account.paidAmount))} to ${settled.account.paidCount} holders, status ${enumName(settled.account.status)}`);
    return settled;
  }

  // ---- coupon ------------------------------------------------------------------------------------
  console.log("\n3. Coupon #1 — ex-date lock, pull + push payments, double-claim rejected");
  let t = await d.chainNow();
  {
    const input: AnnounceInput = { kind: "Coupon", title: "Coupon 1 of PKZ27", termsHash: sha256("PKZ27 coupon 1"), recordTs: t + 25, paymentTs: t + 45, claimDeadline: t + 600 };
    inst = await d.instrument(instrumentAddr);
    const { ix, action } = await client.announce(inst, input);
    await d.send("coupon: announce", [ix]);
    // Before the record date the register trades: carol → bob 5 units.
    await d.send("transfer 5 units carol → bob before record date", bondTransferInstructions({ payer: holders.carol.publicKey, mint: bondMint.publicKey, from: holders.carol.publicKey, to: holders.bob.publicKey, units: BigInt(5) }), [holders.carol]);
    await d.waitUntil(input.recordTs, "record date");
    await d.expectFailure(
      "transfer 1 unit bob → alice after record date",
      bondTransferInstructions({ payer: holders.bob.publicKey, mint: bondMint.publicKey, from: holders.bob.publicKey, to: holders.alice.publicKey, units: BigInt(1) }),
      [holders.bob],
      "TransferLocked",
    );
    await d.send("coupon: lock_record (crank)", [await client.lockRecord(inst, action, payer.publicKey)]);
    const register = await readRegister(connection, bondMint.publicKey, { candidates });
    const tree = buildSnapshotTree(action, register.holdings);
    const snapshot = { version: 1 as const, instrument: instrumentAddr.toBase58(), mint: bondMint.publicKey.toBase58(), action: action.toBase58(), recordTs: input.recordTs, slot: register.slot, holdings: register.holdings };
    d.snapshots[action.toBase58()] = JSON.parse(canonicalSnapshotJson(snapshot));
    await d.send(`coupon: post_snapshot root ${toHex(tree.root).slice(0, 12)}…`, [
      await client.postSnapshot(inst, action, { merkleRoot: tree.root, snapshotHash: snapshotHash(snapshot), totalUnits: register.supply, holderCount: register.holdings.length }),
    ]);
    const a = await d.action(action);
    console.log(`     register at record: ${register.holdings.map((h) => `${names.find((n) => holders[n].publicKey.toBase58() === h.holder)} ${h.units}`).join(", ")}`);
    console.log(`     $${(Number(toBigInt(a.account.amountPerUnit)) / 1e6).toFixed(2)} per unit, total ${fmtUsd(toBigInt(a.account.totalEntitlement))} (computed on-chain)`);
    await fundAndPay("coupon", a, tree, ["alice"], true);
  }

  // ---- vote --------------------------------------------------------------------------------------
  console.log("\n4. Bondholder vote — weights from the snapshot, on-chain tally");
  t = await d.chainNow();
  {
    const { action, tree } = await recordAndSnapshot("vote", {
      kind: "Vote",
      title: "Extend maturity by 6 months?",
      termsHash: sha256("Extend PKZ27 maturity by 6 months? For / Against"),
      recordTs: t + 20,
      paymentTs: t + 60,
      claimDeadline: t + 60,
      options: ["For", "Against"],
    });
    const choices = { alice: 0, bob: 1, carol: 0 };
    for (const n of names) {
      const h = holders[n].publicKey;
      await d.send(`vote: ${n} votes ${choices[n] === 0 ? "For" : "Against"} (${tree.holdingOf(h)!.units} units)`, [
        await client.castVote(inst, action.address, h, tree.holdingOf(h)!.units, tree.proof(h), choices[n]),
      ], [holders[n]]);
    }
    await d.waitUntil(action.account.paymentTs.toNumber(), "vote close");
    await d.send("vote: settle (close tally)", [await client.settle(inst, await d.action(action.address), payer.publicKey)]);
    const v = await d.action(action.address);
    console.log(`     tally For ${v.account.tally[0]} / Against ${v.account.tally[1]} → winner: ${v.account.winningOption === null ? "none (tie)" : v.account.options[v.account.winningOption]}`);
  }

  // ---- partial redemption --------------------------------------------------------------------------
  console.log("\n5. Partial redemption — 25% of every holding at par, burned on payment (DvP)");
  t = await d.chainNow();
  {
    const { action, tree } = await recordAndSnapshot("partial", {
      kind: "PartialRedemption",
      title: "Partial redemption 25% at par",
      termsHash: sha256("PKZ27 partial redemption 25%"),
      recordTs: t + 20,
      paymentTs: t + 40,
      claimDeadline: t + 600,
      redeemBps: 2500,
      priceBps: 10_000,
    });
    console.log(`     units to burn: ${toBigInt(action.account.totalRedeemUnits)} of ${toBigInt(action.account.totalUnits)}`);
    await fundAndPay("partial", action, tree, ["bob"]);
    const supply = (await connection.getTokenSupply(bondMint.publicKey)).value.amount;
    console.log(`     bond supply after partial redemption: ${supply}`);
  }

  // ---- final redemption ----------------------------------------------------------------------------
  console.log("\n6. Final redemption — principal + final coupon, every unit burned atomically");
  t = await d.chainNow();
  {
    const { action, tree } = await recordAndSnapshot("final", {
      kind: "FinalRedemption",
      title: "Final redemption at par + coupon 2",
      termsHash: sha256("PKZ27 final redemption"),
      recordTs: t + 20,
      paymentTs: t + 40,
      claimDeadline: t + 600,
      priceBps: 10_000,
      rateBps: 1250,
    });
    await fundAndPay("final", action, tree, ["carol"]);
    inst = await d.instrument(instrumentAddr);
    const supply = (await connection.getTokenSupply(bondMint.publicKey)).value.amount;
    console.log(`     bond supply ${supply}, instrument status ${enumName(inst.account.status)}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const summary = {
    rpc: RPC,
    programId: client.programId.toBase58(),
    issuer: payer.publicKey.toBase58(),
    settlementMint: usdMint.publicKey.toBase58(),
    bondMint: bondMint.publicKey.toBase58(),
    instrument: instrumentAddr.toBase58(),
    holders: Object.fromEntries(names.map((n) => [n, holders[n].publicKey.toBase58()])),
    steps: d.steps,
    snapshots: d.snapshots,
    finishedAt: new Date().toISOString(),
  };
  const file = join(OUT_DIR, `run-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  writeFileSync(join(OUT_DIR, "latest.json"), JSON.stringify(summary, null, 2));
  console.log(`\nDone: ${d.steps.length} transactions. Summary: ${file}`);
}

main().catch((e) => {
  console.error(`\nDemo failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
