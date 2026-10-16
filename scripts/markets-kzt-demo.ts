/**
 * KZT-settled demo bond: a Kazakhstan investor receives coupons in tenge.
 *
 *   Settlement  "Test KZT": an SPL Token mint with 2 decimals controlled by the demo issuer. It is a
 *               devnet test token standing in for tenge — not KZTE, not issued by any bank or
 *               exchange, no value. Created on the first run (`--create-mint`) and recorded in
 *               lib/markets/currency.ts so every view shows ₸ amounts.
 *   Terms       face ₸500,000, 14% a year, paid semi-annually, 1-year tenor (2 coupons)
 *   Holders     4 / 6 / 8 / 2 units across four demo custody wallets (20 units = ₸10,000,000 face)
 *   Example     the 4-unit holder gets 4 × 500,000 × 14% ÷ 2 = ₸140,000 per coupon
 *
 * Accelerated calendar for demonstration (like the KASE showcase): one nominal year lasts
 * 20 minutes on chain, so coupon 1 is due 10 minutes after issue. The script runs coupon 1 to
 * Settled and leaves coupon 2 unannounced for the console.
 *
 *   npm run markets:kzt -- --create-mint      create the Test KZT mint and exit
 *   npm run markets:kzt                       issue the bond and settle coupon 1 (≈ 12 minutes)
 *   npm run markets:kzt -- --resume <mint>    continue an interrupted run
 *
 * Reads MARKETS_ISSUER_SECRET (and MARKETS_RPC_URL) from the environment, .env.local or the file
 * named by MARKETS_ENV_FILE. Writes .data/markets-kzt/<mint>.json. Prints no secret.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TOKEN_PROGRAM_ID, createMint, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import { ACCELERATED_YEAR_SECONDS, couponDates } from "../lib/markets/calendar";
import { PLAIN_MARKETS_PROGRAM_ID, toBigInt } from "../lib/markets/client";
import { TEST_KZT_MINT_ADDRESS } from "../lib/markets/currency";
import { DEMO_HOLDER_LABELS, DevnetIssuer, demoHolders, parseSecretKey } from "../lib/markets/devnet-issuer";
import { DevnetLedger, type DevnetMarketsConfig } from "../lib/markets/devnet-service";
import { formatSettlement } from "../lib/markets/format";
import { rpcRetry } from "../lib/markets/signature-feed";
import type { CorporateAction, TxResult } from "../lib/markets/service";

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

loadEnv(join(process.cwd(), ".env.local"));
if (process.env.MARKETS_ENV_FILE) loadEnv(process.env.MARKETS_ENV_FILE);
const issuer = parseSecretKey(process.env.MARKETS_ISSUER_SECRET);
if (!issuer) throw new Error("Set MARKETS_ISSUER_SECRET (JSON array or base58) in .env.local");
const RPC = process.env.MARKETS_RPC_URL || "https://api.devnet.solana.com";
const KZT = BigInt(100);
const DAY = 86_400;
const OUT = join(process.cwd(), ".data", "markets-kzt");
const FACE = BigInt(500_000) * KZT;
const COUPON_BPS = 1_400;

const args = process.argv.slice(2);
const resumeMint = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : null;

const all = demoHolders(issuer);
/** [demo holder index, units]. Index 3 is the example retail investor. */
const BOOK: [number, bigint][] = [
  [3, BigInt(4)],
  [0, BigInt(6)],
  [6, BigInt(8)],
  [5, BigInt(2)],
];
const EXAMPLE = all[3];
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
const tenge = (v: bigint) => formatSettlement(v, 2, "KZT");

const summary: Record<string, unknown> & { steps: { step: string; signature: string; url: string }[]; mint?: string } = {
  network: "devnet",
  program: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
  issuer: issuer.publicKey.toBase58(),
  calendar: `accelerated for demonstration: 1 nominal year = ${ACCELERATED_YEAR_SECONDS / 60} minutes`,
  settlementMint: TEST_KZT_MINT_ADDRESS,
  settlementNote: "Test KZT: devnet SPL token (2 decimals) standing in for tenge; no value, not KZTE",
  holders: holders.map((h) => ({ label: h.label, address: h.key.publicKey.toBase58(), units: h.units.toString() })),
  steps: [],
};

const explorer = (kind: "tx" | "address", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function save() {
  if (!summary.mint) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${summary.mint}.json`), JSON.stringify(summary, null, 2));
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

async function waitUntil(ts: number, what: string) {
  for (;;) {
    const now = await ledger.clusterNow();
    if (now >= ts + 1) return;
    const left = ts + 1 - now;
    process.stdout.write(`  … ${left}s until ${what}        \r`);
    await sleep(Math.min(left, 10) * 1000);
  }
}

async function kztBalance(owner: PublicKey) {
  const mint = new PublicKey(TEST_KZT_MINT_ADDRESS);
  const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
  const info = await rpcRetry(() => connection.getAccountInfo(ata, "confirmed"));
  return info ? unpackAccount(ata, info, TOKEN_PROGRAM_ID).amount : BigInt(0);
}

async function createKztMint() {
  const mint = await createMint(connection, issuer!, issuer!.publicKey, null, 2, Keypair.generate(), { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
  console.log(`Test KZT mint (SPL Token, 2 dp, authority = issuer): ${mint.toBase58()}`);
  console.log(`Record it as TEST_KZT_MINT_ADDRESS in lib/markets/currency.ts, then run: npm run markets:kzt`);
}

async function createInstrument() {
  const balance = await connection.getBalance(issuer!.publicKey);
  console.log(`Issuer ${issuer!.publicKey.toBase58()} · ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL · ${RPC}`);
  if (balance < 0.2 * LAMPORTS_PER_SOL) throw new Error("Issuer needs at least 0.2 devnet SOL.");

  const bond = Keypair.generate();
  const issueTs = (await ledger.clusterNow()) + 60;
  const maturityTs = issueTs + ACCELERATED_YEAR_SECONDS;
  await step("initialize_instrument KZT14 (14% semi-annual, 1Y accelerated, settles in Test KZT)", async () =>
    desk.send(
      [
        await ledger.client.initializeInstrument({
          issuer: issuer!.publicKey,
          mint: bond.publicKey,
          settlementMint: new PublicKey(TEST_KZT_MINT_ADDRESS),
          settlementTokenProgram: TOKEN_PROGRAM_ID,
          params: {
            name: "KZT Example 14% 1Y",
            symbol: "KZT14",
            uri: "https://plain.lengway.me/issuers",
            isin: "",
            faceValue: FACE,
            couponBps: COUPON_BPS,
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
  Object.assign(summary, { instrument: inst.address.toBase58(), mint, issueTs, maturityTs, scheduledCoupons: couponDates({ issueTs, maturityTs, frequency: 2 }) });
  save();
  for (const h of holders) {
    await step(`issue ${h.units} units to ${h.label}`, async () => desk.send([await ledger.client.issue(inst, h.key.publicKey, h.units)]));
  }
  return mint;
}

async function actionState(id: string): Promise<CorporateAction> {
  ledger.changed();
  const a = await ledger.getAction(id);
  if (!a) throw new Error(`action ${id} not found`);
  return a;
}

/** Coupon 1: record date 90 s before payment, exactly as in the KASE showcase. */
async function couponOne(mint: string) {
  ledger.changed();
  let id = (await ledger.listActions(mint)).find((a) => a.seq === 1)?.id;
  if (!id) {
    const inst = (await rpcRetry(() => ledger.client.fetchInstrumentByMint(new PublicKey(mint))))!;
    const pay = Number(toBigInt(inst.account.issueTs)) + ACCELERATED_YEAR_SECONDS / 2;
    const now = await ledger.clusterNow();
    const shift = Math.max(0, now + 30 - (pay - 90));
    const draft = { kind: "Coupon" as const, recordTs: pay - 90 + shift, paymentTs: pay + shift, claimDeadlineTs: pay + shift + 7 * DAY, params: { kind: "Coupon" as const, period: 1, couponBps: COUPON_BPS } };
    id = (await step("coupon 1: announce (terms memo + ex-date lock)", () => desk.announce(mint, draft))).actionId;
  }
  let a = await actionState(id);
  if (a.status === "Announced") {
    await waitUntil(a.recordTs, "coupon 1 record date");
    await step("coupon 1: lock_record (crank)", () => desk.lockRecord(id));
    a = await actionState(id);
  }
  if (a.status === "RecordLocked") {
    await step("coupon 1: post_snapshot (Merkle root + register memo)", () => desk.postSnapshot(id));
    a = await actionState(id);
  }
  if (a.status === "SnapshotPosted") {
    await step(`coupon 1: fund paying vault (${tenge(a.totalEntitlement ?? BigInt(0))})`, () => desk.fund(id));
    a = await actionState(id);
  }
  if (a.status === "Funded" || a.status === "Settling") {
    await waitUntil(a.paymentTs, "coupon 1 payment date");
    const paid = new Set((await ledger.listReceipts(id)).map((r) => r.holder));
    for (const h of (await ledger.getSnapshot(id))?.holdings ?? []) {
      if (paid.has(h.holder)) continue;
      const isExample = h.holder === EXAMPLE.publicKey.toBase58();
      const before = isExample ? await kztBalance(EXAMPLE.publicKey) : BigInt(0);
      if (isExample) await step(`coupon 1: ${label(h.holder)} claims (pull)`, () => desk.claim(id, h.holder));
      else await step(`coupon 1: paying agent pays ${label(h.holder)} (push)`, () => desk.pay(id, h.holder));
      if (isExample) {
        const received = (await kztBalance(EXAMPLE.publicKey)) - before;
        const expected = (h.units * FACE * BigInt(COUPON_BPS)) / BigInt(10_000) / BigInt(2);
        console.log(`  ${received === expected ? "✓" : "✗"} ${h.units}-unit holder received ${tenge(received)} (expected ${tenge(expected)})`);
        if (received !== expected) throw new Error("coupon amount check failed");
        summary.exampleCoupon = { units: h.units.toString(), received: tenge(received) };
      }
    }
    a = await actionState(id);
    if (a.status !== "Settled") await step("coupon 1: settle", () => desk.settle(id));
  }
  a = await actionState(id);
  summary.coupon1 = { id, verify: `/verify/${id}`, status: a.status, total: tenge(a.totalEntitlement ?? BigInt(0)) };
  save();
  return id;
}

async function main() {
  if (args.includes("--create-mint")) return createKztMint();
  if (TEST_KZT_MINT_ADDRESS.startsWith("__")) throw new Error("Create the Test KZT mint first: npm run markets:kzt -- --create-mint");
  const mint = resumeMint ?? (await createInstrument());
  if (resumeMint) {
    const prev = JSON.parse(readFileSync(join(OUT, `${mint}.json`), "utf8"));
    Object.assign(summary, prev);
  }
  summary.mint = mint;
  const id = await couponOne(mint);
  console.log(`\nBond mint  ${mint}   (add to MARKETS_ISSUER_INSTRUMENTS)`);
  console.log(`Instrument ${explorer("address", String(summary.instrument))}`);
  console.log(`Console    /issuers?mint=${mint}`);
  console.log(`Verify     /verify/${id}  (coupon 1, Settled; coupon 2 left unannounced)`);
}

main().catch((error) => {
  save();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
