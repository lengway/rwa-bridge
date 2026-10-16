/**
 * KASE track showcase: the track's example bond, run through its whole life on devnet.
 *
 *   Terms   face 1,000 test USD, 10% a year, paid semi-annually, 2-year tenor (4 coupons)
 *   Holders 10 / 100 / 60 / 30 / 20 units across five demo custody wallets (220 units)
 *   Example the 10-unit holder gets 10 × 1,000 × 10% ÷ 2 = 500 per coupon and
 *           10 × 1,000 + 500 = 10,500 at maturity (principal + final coupon)
 *
 * Accelerated calendar for demonstration: one nominal year lasts 20 minutes on chain
 * (`lib/markets/calendar.ts`), so coupon k is due 10·k minutes after issue and the bond matures
 * 40 minutes after issue. Every rule the program enforces (record date, ex-date lock, snapshot,
 * funding, entitlement, burn) is the same as on a real calendar.
 *
 *   npm run markets:kase                 full lifecycle on a new instrument (≈ 45 minutes)
 *   npm run markets:kase -- --fresh      a new copy at the start of its life (issued, no actions)
 *   npm run markets:kase -- --resume <mint>   continue an interrupted run
 *
 * Lifecycle: coupon 1 → coupon 2 → bondholder vote → 20% partial early redemption at par →
 * a secondary transfer (the 10-unit holder buys back to 10) → coupon 3 → final redemption at
 * maturity with coupon 4, burning every unit → instrument Redeemed, supply 0.
 *
 * Same DevnetIssuer as the console's API routes. Reads MARKETS_ISSUER_SECRET (and MARKETS_RPC_URL)
 * from the environment or .env.local. Writes .data/markets-kase/<mint>.json. Prints no secret.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getMint, unpackAccount } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";

import { ACCELERATED_YEAR_SECONDS, couponDates } from "../lib/markets/calendar";
import { PLAIN_MARKETS_PROGRAM_ID, bondTransferInstructions, enumName, toBigInt } from "../lib/markets/client";
import { DEMO_HOLDER_LABELS, DevnetIssuer, demoHolders, parseSecretKey, programErrorMessage } from "../lib/markets/devnet-issuer";
import { DevnetLedger, type DevnetMarketsConfig } from "../lib/markets/devnet-service";
import { buildSnapshotTree } from "../lib/markets/merkle";
import { rpcRetry } from "../lib/markets/signature-feed";
import type { ActionDraft, CorporateAction, TxResult } from "../lib/markets/service";

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

loadEnvLocal();
const issuer = parseSecretKey(process.env.MARKETS_ISSUER_SECRET);
if (!issuer) throw new Error("Set MARKETS_ISSUER_SECRET (JSON array or base58) in .env.local");
const RPC = process.env.MARKETS_RPC_URL || "https://api.devnet.solana.com";
const USD = BigInt(1_000_000);
const DAY = 86_400;
const OUT = join(process.cwd(), ".data", "markets-kase");
/** Test USD of the demo issuer (SPL Token, 6 dp, issuer = mint authority; fiat leg simulated). */
const TEST_USD = new PublicKey(process.env.MARKETS_KASE_SETTLEMENT_MINT || "7GtKkJyuhtwam5H6SxDB7razMC51jUA9kz5keSURxBKh");

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const resumeMint = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : null;

const all = demoHolders(issuer);
/** [demo holder index, units]. Index 3 is the track example's 10-unit investor. */
const BOOK: [number, bigint][] = [
  [3, BigInt(10)],
  [0, BigInt(100)],
  [1, BigInt(60)],
  [2, BigInt(30)],
  [5, BigInt(20)],
];
const EXAMPLE = all[3];
const BROKER = all[2];
const holders = BOOK.map(([i, units]) => ({ key: all[i], label: DEMO_HOLDER_LABELS[i], units }));
const label = (address: string) => holders.find((h) => h.key.publicKey.toBase58() === address)?.label ?? address;

const config: DevnetMarketsConfig = {
  mode: "devnet",
  rpcUrl: RPC,
  programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
  issuer: issuer.publicKey.toBase58(),
  mints: [],
  directory: holders.map((h) => ({ address: h.key.publicKey.toBase58(), label: h.label, custody: "custodian" as const })),
  settlementSymbol: "USD",
  writable: true,
  apiBase: "",
};
const ledger = new DevnetLedger(config, null, { poll: false });
const desk = new DevnetIssuer(ledger, issuer, all);
const connection = ledger.connection;

type Step = { step: string; signature: string; url: string };
type Check = { check: string; expected: string; actual: string; ok: boolean };
const summary: {
  network: "devnet";
  program: string;
  issuer: string;
  mode: "lifecycle" | "fresh";
  calendar: string;
  instrument?: string;
  mint?: string;
  settlementMint: string;
  issueTs?: number;
  maturityTs?: number;
  scheduledCoupons?: number[];
  holders: { label: string; address: string; units: string }[];
  actions: { name: string; id: string; verify: string; recordTs: number; paymentTs: number; status?: string }[];
  steps: Step[];
  checks: Check[];
  rejected: { attempt: string; error: string }[];
  final?: Record<string, string>;
} = {
  network: "devnet",
  program: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
  issuer: issuer.publicKey.toBase58(),
  mode: fresh ? "fresh" : "lifecycle",
  calendar: `accelerated for demonstration: 1 nominal year = ${ACCELERATED_YEAR_SECONDS / 60} minutes`,
  settlementMint: TEST_USD.toBase58(),
  holders: holders.map((h) => ({ label: h.label, address: h.key.publicKey.toBase58(), units: h.units.toString() })),
  actions: [],
  steps: [],
  checks: [],
  rejected: [],
};

const explorer = (kind: "tx" | "address", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save() {
  if (!summary.mint) return;
  mkdirSync(OUT, { recursive: true });
  const body = JSON.stringify(summary, null, 2);
  writeFileSync(join(OUT, `${summary.mint}.json`), body);
  writeFileSync(join(OUT, fresh ? "fresh.json" : "lifecycle.json"), body);
}

async function step<T extends TxResult>(name: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await run();
      summary.steps.push({ step: name, signature: r.signature, url: explorer("tx", r.signature) });
      console.log(`✓ ${name.padEnd(60)} ${explorer("tx", r.signature)}`);
      ledger.changed();
      save();
      return r;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 4 && /expired|blockhash|429|timed out|fetch failed|Not confirmed yet|ECONNRESET|socket/i.test(message)) {
        console.log(`  retrying ${name}: ${message}`);
        await sleep(3_000 * attempt);
        continue;
      }
      throw new Error(`${name}: ${message}`);
    }
  }
}

function check(name: string, expected: bigint | string, actual: bigint | string) {
  const ok = expected.toString() === actual.toString();
  summary.checks.push({ check: name, expected: expected.toString(), actual: actual.toString(), ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}: expected ${expected}, got ${actual}`);
  if (!ok) throw new Error(`Check failed: ${name}`);
}

/** Simulates a transaction that the program must reject and records the program's error. */
async function mustFail(attempt: string, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const { blockhash, lastValidBlockHeight } = await rpcRetry(() => connection.getLatestBlockhash("confirmed"));
  const tx = new Transaction({ feePayer: issuer!.publicKey, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  tx.sign(issuer!, ...signers);
  const sim = await rpcRetry(() => connection.simulateTransaction(tx));
  if (!sim.value.err) throw new Error(`${attempt}: expected the program to reject it, but the simulation succeeded`);
  const error = programErrorMessage(new Error(JSON.stringify(sim.value.err)), sim.value.logs);
  summary.rejected.push({ attempt, error });
  console.log(`  ✗ rejected as intended: ${attempt} → ${error}`);
  save();
}

async function waitUntil(ts: number, what: string) {
  for (;;) {
    const now = await ledger.clusterNow();
    if (now >= ts + 1) return;
    const left = ts + 1 - now;
    process.stdout.write(`  … ${left}s until ${what}        \r`);
    await sleep(Math.min(left, 10) * 1000);
  }
}

async function usdBalance(owner: PublicKey) {
  const ata = getAssociatedTokenAddressSync(TEST_USD, owner, true, TOKEN_PROGRAM_ID);
  const info = await rpcRetry(() => connection.getAccountInfo(ata, "confirmed"));
  return info ? unpackAccount(ata, info, TOKEN_PROGRAM_ID).amount : BigInt(0);
}

async function bondBalance(mint: PublicKey, owner: PublicKey) {
  const address = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
  const info = await rpcRetry(() => connection.getAccountInfo(address, "confirmed"));
  return info ? unpackAccount(address, info, TOKEN_2022_PROGRAM_ID).amount : BigInt(0);
}

async function createInstrument() {
  const balance = await connection.getBalance(issuer!.publicKey);
  console.log(`Issuer ${issuer!.publicKey.toBase58()} · ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL · ${RPC}`);
  if (balance < 0.2 * LAMPORTS_PER_SOL) throw new Error("Issuer needs at least 0.2 devnet SOL. Run: solana transfer <issuer> 1 --url devnet --allow-unfunded-recipient");

  const bond = Keypair.generate();
  // Issue a minute from now so that coupon 1's record date leaves room for the issuance.
  const issueTs = (await ledger.clusterNow()) + 60;
  const maturityTs = issueTs + 2 * ACCELERATED_YEAR_SECONDS;
  await step(`initialize_instrument ${fresh ? "KASE2YLIVE" : "KASE2Y"} (10% semi-annual, 2Y accelerated)`, async () =>
    desk.send(
      [
        await ledger.client.initializeInstrument({
          issuer: issuer!.publicKey,
          mint: bond.publicKey,
          settlementMint: TEST_USD,
          settlementTokenProgram: TOKEN_PROGRAM_ID,
          params: {
            name: fresh ? "KASE Example 10% 2Y · live" : "KASE Example 10% 2Y",
            symbol: fresh ? "KASE2YLIVE" : "KASE2Y",
            uri: "https://plain.lengway.me/issuers",
            isin: "",
            faceValue: BigInt(1_000) * USD,
            couponBps: 1_000,
            couponFrequency: 2,
            issueTs,
            maturityTs,
            allowlistEnabled: false,
            payingAgent: issuer!.publicKey,
          },
        }),
      ],
      [bond],
    ),
  );
  const mint = bond.publicKey.toBase58();
  const inst = (await rpcRetry(() => ledger.client.fetchInstrumentByMint(bond.publicKey)))!;
  Object.assign(summary, { instrument: inst.address.toBase58(), mint, issueTs, maturityTs });
  summary.scheduledCoupons = couponDates({ issueTs, maturityTs, frequency: 2 });
  save();
  for (const h of holders) {
    await step(`issue ${h.units} units to ${h.label}`, async () => desk.send([await ledger.client.issue(inst, h.key.publicKey, h.units)]));
  }
  return mint;
}

// ---- lifecycle ----------------------------------------------------------------------------------

type Plan = { name: string; draft: (t: { issueTs: number; maturityTs: number }) => ActionDraft; pull?: number; votes?: [number, number][] };

/** Coupon k is due at issue + k × period; the record date is 90 s (≈ 27 nominal days) earlier. */
function coupon(k: number): Plan {
  return {
    name: `coupon ${k}`,
    draft: ({ issueTs }) => {
      const pay = issueTs + (k * ACCELERATED_YEAR_SECONDS) / 2;
      return { kind: "Coupon", recordTs: pay - 90, paymentTs: pay, claimDeadlineTs: pay + 7 * DAY, params: { kind: "Coupon", period: k, couponBps: 1_000 } };
    },
    pull: k === 1 ? 3 : undefined,
  };
}

const PLAN: Plan[] = [
  coupon(1),
  coupon(2),
  {
    name: "bondholder vote",
    draft: ({ issueTs }) => {
      const open = issueTs + ACCELERATED_YEAR_SECONDS + 60;
      return { kind: "Vote", recordTs: open, paymentTs: open + 120, claimDeadlineTs: open + 120, params: { kind: "Vote", question: "Allow a 20% early redemption at par", options: ["For", "Against", "Abstain"] } };
    },
    votes: [
      [0, 0],
      [1, 1],
      [3, 0],
      [2, 2],
    ],
  },
  {
    name: "partial redemption 20% at par",
    draft: ({ issueTs }) => {
      const record = issueTs + ACCELERATED_YEAR_SECONDS + 240;
      return { kind: "PartialRedemption", recordTs: record, paymentTs: record + 90, claimDeadlineTs: record + 90 + 7 * DAY, params: { kind: "PartialRedemption", redeemBps: 2_000, priceBps: 10_000 } };
    },
  },
  coupon(3),
  {
    name: "final redemption at maturity + coupon 4",
    draft: ({ maturityTs }) => ({
      kind: "FinalRedemption",
      recordTs: maturityTs - 90,
      paymentTs: maturityTs,
      claimDeadlineTs: maturityTs + 7 * DAY,
      params: { kind: "FinalRedemption", priceBps: 10_000, includeCoupon: true, couponBps: 1_000 },
    }),
  },
];

/** Never schedule in the past: if the run fell behind, shift the dates forward and say so. */
async function onTime(draft: ActionDraft): Promise<ActionDraft> {
  const now = await ledger.clusterNow();
  const shift = Math.max(0, now + 30 - draft.recordTs);
  if (shift) console.log(`  (behind schedule: dates shifted by ${shift}s)`);
  return { ...draft, recordTs: draft.recordTs + shift, paymentTs: draft.paymentTs + shift, claimDeadlineTs: draft.claimDeadlineTs + shift };
}

async function actionState(id: string): Promise<CorporateAction> {
  ledger.changed();
  const a = await ledger.getAction(id);
  if (!a) throw new Error(`action ${id} not found`);
  return a;
}

async function drive(mint: string, plan: Plan, actionId: string) {
  let a = await actionState(actionId);
  const name = plan.name;
  if (a.status === "Announced") {
    if (name === "coupon 1") {
      // Ex-date lock: once the record date passes, the hook rejects transfers until payment.
      await waitUntil(a.recordTs, `${name} record date`);
      await mustFail("transfer 1 unit inside the coupon 1 ex-date lock", bondTransferInstructions({ payer: issuer!.publicKey, mint: new PublicKey(mint), from: BROKER.publicKey, to: EXAMPLE.publicKey, units: BigInt(1) }), [BROKER]);
    }
    await waitUntil(a.recordTs, `${name} record date`);
    await step(`${name}: lock_record (crank)`, () => desk.lockRecord(actionId));
    a = await actionState(actionId);
  }
  if (a.status === "RecordLocked") {
    await step(`${name}: post_snapshot (Merkle root + register memo)`, () => desk.postSnapshot(actionId));
    a = await actionState(actionId);
  }
  if (a.kind === "Vote") {
    const votes = await ledger.listVotes(actionId);
    for (const [i, choice] of plan.votes ?? []) {
      const voter = all[i].publicKey.toBase58();
      if (votes.some((v) => v.holder === voter)) continue;
      const option = a.params.kind === "Vote" ? a.params.options[choice] : String(choice);
      await step(`${name}: ${label(voter)} votes ${option}`, () => desk.vote(actionId, voter, choice));
    }
    await waitUntil(a.paymentTs, `${name} close`);
    if ((await actionState(actionId)).status !== "Settled") await step(`${name}: close and record the winner`, () => desk.settle(actionId));
    return;
  }
  if (a.status === "SnapshotPosted") {
    await step(`${name}: fund paying vault`, () => desk.fund(actionId));
    a = await actionState(actionId);
  }
  if (a.status === "Funded" || a.status === "Settling") {
    await waitUntil(a.paymentTs, `${name} payment date`);
    const paid = new Set((await ledger.listReceipts(actionId)).map((r) => r.holder));
    const snapshot = await ledger.getSnapshot(actionId);
    for (const h of snapshot?.holdings ?? []) {
      if (paid.has(h.holder)) continue;
      const exampleBefore = h.holder === EXAMPLE.publicKey.toBase58() ? await usdBalance(EXAMPLE.publicKey) : null;
      const pull = plan.pull != null && all[plan.pull].publicKey.toBase58() === h.holder;
      if (pull) await step(`${name}: ${label(h.holder)} claims (pull)`, () => desk.claim(actionId, h.holder));
      else await step(`${name}: paying agent pays ${label(h.holder)} (push)`, () => desk.pay(actionId, h.holder));
      if (exampleBefore != null) await checkExample(name, a, h.units, (await usdBalance(EXAMPLE.publicKey)) - exampleBefore);
    }
    if (name === "coupon 1") {
      await mustFail("claim coupon 1 a second time", [await claimIx(actionId, EXAMPLE)], [EXAMPLE]);
    }
    a = await actionState(actionId);
    if (a.status !== "Settled") await step(`${name}: settle`, () => desk.settle(actionId));
  }
}

async function claimIx(actionId: string, holder: Keypair) {
  const action = (await rpcRetry(() => ledger.client.fetchAction(new PublicKey(actionId))))!;
  const inst = (await rpcRetry(() => ledger.client.fetchInstrument(action.account.instrument)))!;
  const snapshot = (await ledger.getSnapshot(actionId))!;
  const tree = buildSnapshotTree(actionId, snapshot.holdings);
  const leaf = tree.holdingOf(holder.publicKey.toBase58())!;
  return ledger.client.claim(inst, action, holder.publicKey, leaf.units, tree.proof(holder.publicKey.toBase58()));
}

/** The track example, checked against the 10-unit holder's real settlement balance. */
async function checkExample(name: string, a: CorporateAction, units: bigint, received: bigint) {
  const face = BigInt(1_000) * USD;
  const couponPerUnit = (face * BigInt(1_000)) / BigInt(10_000) / BigInt(2);
  if (a.kind === "Coupon") {
    check(`${name}: 10-unit holder receives ${units} × 1,000 × 10% ÷ 2`, units * couponPerUnit, received);
  } else if (a.kind === "PartialRedemption") {
    const burned = (units * BigInt(2_000)) / BigInt(10_000);
    check(`${name}: holder of ${units} receives floor(${units} × 20%) × 1,000`, burned * face, received);
  } else if (a.kind === "FinalRedemption") {
    check(`${name}: 10-unit holder receives ${units} × (1,000 + 50)`, units * (face + couponPerUnit), received);
  }
}

async function main() {
  const mint = resumeMint ?? (await createInstrument());
  const bondMint = new PublicKey(mint);
  let inst = (await rpcRetry(() => ledger.client.fetchInstrumentByMint(bondMint)))!;
  Object.assign(summary, {
    instrument: inst.address.toBase58(),
    mint,
    issueTs: Number(toBigInt(inst.account.issueTs)),
    maturityTs: Number(toBigInt(inst.account.maturityTs)),
  });
  summary.scheduledCoupons = couponDates({ issueTs: summary.issueTs!, maturityTs: summary.maturityTs!, frequency: 2 });
  const resumed = resumeMint ? JSON.parse(readFileSync(join(OUT, `${mint}.json`), "utf8")) : null;
  if (resumed) Object.assign(summary, { steps: resumed.steps, checks: resumed.checks, rejected: resumed.rejected });
  save();
  if (fresh) {
    console.log(`\nFresh copy ready: mint ${mint}\nConsole: /issuers?mint=${mint}`);
    return;
  }

  const times = { issueTs: summary.issueTs!, maturityTs: summary.maturityTs! };
  for (let k = 0; k < PLAN.length; k++) {
    const plan = PLAN[k];
    ledger.changed();
    const existing = (await ledger.listActions(mint)).find((a) => a.seq === k + 1);
    let actionId = existing?.id;
    if (!actionId) {
      if (plan.name === "coupon 3") await buyBack(mint);
      const draft = await onTime(plan.draft(times));
      actionId = (await step(`${plan.name}: announce (terms memo + ex-date lock)`, () => desk.announce(mint, draft))).actionId;
    }
    await drive(mint, plan, actionId);
    const a = await actionState(actionId);
    const entry = { name: plan.name, id: actionId, verify: `/verify/${actionId}`, recordTs: a.recordTs, paymentTs: a.paymentTs, status: a.status };
    summary.actions = [...summary.actions.filter((x) => x.id !== actionId), entry];
    save();
  }

  // After the last burn: supply 0, instrument Redeemed, nothing can be issued again.
  inst = (await rpcRetry(() => ledger.client.fetchInstrumentByMint(bondMint)))!;
  const mintInfo = await rpcRetry(() => getMint(connection, bondMint, "confirmed", TOKEN_2022_PROGRAM_ID));
  check("instrument status after final redemption", "Redeemed", enumName(inst.account.status));
  check("bond mint supply after final redemption", "0", mintInfo.supply.toString());
  await mustFail("issue 1 unit after redemption", [await ledger.client.issue(inst, EXAMPLE.publicKey, BigInt(1))]);
  summary.final = {
    status: "Redeemed",
    supply: mintInfo.supply.toString(),
    issuedUnits: toBigInt(inst.account.issuedUnits).toString(),
    redeemedUnits: toBigInt(inst.account.redeemedUnits).toString(),
    mintAuthority: mintInfo.mintAuthority?.toBase58() ?? "none",
  };
  save();
  console.log(`\nInstrument ${explorer("address", summary.instrument!)}`);
  console.log(`Bond mint  ${mint}`);
  for (const a of summary.actions) console.log(`Verify     ${a.verify}  (${a.name})`);
  console.log(`${summary.steps.length} transactions, ${summary.rejected.length} rejected attempts. Summary: .data/markets-kase/${mint}.json`);
}

/**
 * After the partial redemption the 10-unit holder has 8. A secondary trade (broker → holder,
 * 2 units, outside any lock) restores 10, so coupon 3 and the final redemption land exactly on
 * the track's example. The snapshot picks the trade up like any transfer.
 */
async function buyBack(mint: string) {
  const held = await bondBalance(new PublicKey(mint), EXAMPLE.publicKey);
  if (held >= BigInt(10)) return;
  const units = BigInt(10) - held;
  await step(`secondary transfer: ${units} units broker → ${label(EXAMPLE.publicKey.toBase58())}`, () =>
    desk.send(bondTransferInstructions({ payer: issuer!.publicKey, mint: new PublicKey(mint), from: BROKER.publicKey, to: EXAMPLE.publicKey, units }), [BROKER]),
  );
  check("10-unit holder balance after the secondary trade", "10", (await bondBalance(new PublicKey(mint), EXAMPLE.publicKey)).toString());
}

main().catch((error) => {
  save();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
