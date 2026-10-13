/**
 * Seeds a fresh Plain Markets demo instrument on devnet so /issuers looks alive:
 *
 *   1. test USD settlement mint (issuer is its mint authority) and a Token-2022 bond
 *   2. 1,000 units issued to five demo custody wallets, one transfer before the first record date
 *   3. Coupon 1: announce → lock → snapshot (memo) → fund → 4 push payments + 1 claim → settle
 *   4. Bondholder vote: announce → lock → snapshot → 3 ballots → close
 *   5. Coupon 2: announced, register locked and snapshot posted, awaiting funding (in progress)
 *
 * Uses the same DevnetIssuer as the API routes. Reads MARKETS_ISSUER_SECRET (and MARKETS_RPC_URL)
 * from the environment or .env.local. The issuer pays all fees; top it up from the Solana CLI
 * wallet if needed (`solana transfer <issuer> 1 --url devnet`). Prints no secret.
 *
 *   npm run markets:seed
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createInitializeMint2Instruction, createMintToInstruction, getAssociatedTokenAddressSync, MINT_SIZE } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";

import { PLAIN_MARKETS_PROGRAM_ID, bondTransferInstructions, toBigInt } from "../lib/markets/client";
import { DEMO_HOLDER_LABELS, DevnetIssuer, demoHolders, parseSecretKey } from "../lib/markets/devnet-issuer";
import { DevnetLedger, type DevnetMarketsConfig } from "../lib/markets/devnet-service";
import type { ActionDraft, TxResult } from "../lib/markets/service";

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
const OUT = join(process.cwd(), ".data", "markets-seed");

const config: DevnetMarketsConfig = {
  mode: "devnet",
  rpcUrl: RPC,
  programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
  issuer: issuer.publicKey.toBase58(),
  mints: [],
  directory: [],
  settlementSymbol: "USD",
  writable: true,
  apiBase: "",
};
const ledger = new DevnetLedger(config, null, { poll: false });
const holders = demoHolders(issuer).slice(0, 5);
const desk = new DevnetIssuer(ledger, issuer, demoHolders(issuer));
const connection = ledger.connection;
const steps: { step: string; signature: string }[] = [];

const explorer = (kind: "tx" | "address", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step<T extends TxResult>(label: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await run();
      steps.push({ step: label, signature: r.signature });
      console.log(`✓ ${label.padEnd(52)} ${explorer("tx", r.signature)}`);
      ledger.changed();
      return r;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 3 && /expired|blockhash|429|timed out|fetch failed/i.test(message)) {
        console.log(`  retrying ${label}: ${message}`);
        await sleep(2_000 * attempt);
        continue;
      }
      throw new Error(`${label}: ${message}`);
    }
  }
}

async function waitUntil(ts: number, what: string) {
  for (;;) {
    const now = await ledger.clusterNow();
    if (now >= ts + 1) return;
    const left = ts + 1 - now;
    process.stdout.write(`  … waiting ${left}s for ${what}\r`);
    await sleep(Math.min(left, 5) * 1000);
  }
}

async function runAction(label: string, draft: ActionDraft, mint: string) {
  const { actionId } = await step(`${label}: announce`, () => desk.announce(mint, draft));
  await waitUntil(draft.recordTs, `${label} record date`);
  await step(`${label}: lock_record (crank)`, () => desk.lockRecord(actionId));
  await step(`${label}: post_snapshot + memo`, () => desk.postSnapshot(actionId));
  return actionId;
}

async function main() {
  const balance = await connection.getBalance(issuer!.publicKey);
  console.log(`Issuer ${issuer!.publicKey.toBase58()} · ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL · ${RPC}`);
  if (balance < 0.3 * LAMPORTS_PER_SOL) throw new Error("Issuer needs at least 0.3 devnet SOL. Run: solana transfer <issuer> 1 --url devnet --allow-unfunded-recipient");

  // 1. Settlement mint (test USD, SPL Token, 6 decimals) + fees for the demo wallets.
  const usd = Keypair.generate();
  const treasury = getAssociatedTokenAddressSync(usd.publicKey, issuer!.publicKey);
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await step("create test USD settlement mint", () =>
    desk.send(
      [
        SystemProgram.createAccount({ fromPubkey: issuer!.publicKey, newAccountPubkey: usd.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
        createInitializeMint2Instruction(usd.publicKey, 6, issuer!.publicKey, null),
        createAssociatedTokenAccountIdempotentInstruction(issuer!.publicKey, treasury, issuer!.publicKey, usd.publicKey),
        createMintToInstruction(usd.publicKey, treasury, issuer!.publicKey, BigInt(500_000) * USD),
      ],
      [usd],
    ),
  );
  await step("fund 5 demo custody wallets with 0.01 SOL", () =>
    desk.send(holders.map((h) => SystemProgram.transfer({ fromPubkey: issuer!.publicKey, toPubkey: h.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }))),
  );

  // 2. The bond.
  const bond = Keypair.generate();
  const now = await ledger.clusterNow();
  const issueTs = now - 92 * DAY;
  await step("initialize_instrument PDB28 (12% quarterly)", async () =>
    desk.send(
      [
        await ledger.client.initializeInstrument({
          issuer: issuer!.publicKey,
          mint: bond.publicKey,
          settlementMint: usd.publicKey,
          settlementTokenProgram: TOKEN_PROGRAM_ID,
          params: {
            name: "Plain Demo Bond 12% 2028",
            symbol: "PDB28",
            uri: "https://plain.lengway.me/issuers",
            isin: "",
            faceValue: BigInt(1_000) * USD,
            couponBps: 1_200,
            couponFrequency: 4,
            issueTs,
            maturityTs: issueTs + 2 * 365 * DAY,
            allowlistEnabled: false,
            payingAgent: issuer!.publicKey,
          },
        }),
      ],
      [bond],
    ),
  );
  const mint = bond.publicKey.toBase58();
  const units = [400, 250, 180, 120, 50].map(BigInt);
  for (let i = 0; i < holders.length; i++) {
    const inst = await ledger.client.fetchInstrumentByMint(bond.publicKey);
    await step(`issue ${units[i]} units to ${DEMO_HOLDER_LABELS[i]}`, async () => desk.send([await ledger.client.issue(inst!, holders[i].publicKey, units[i])]));
  }
  // A secondary-market transfer before the record date: the register replay must pick it up.
  await step("transfer 20 units broker → retail (hook allows: no record date yet)", () =>
    desk.send(bondTransferInstructions({ payer: issuer!.publicKey, mint: bond.publicKey, from: holders[2].publicKey, to: holders[4].publicKey, units: BigInt(20) }), [holders[2]]),
  );

  // 3. Coupon 1 — settled.
  let t = await ledger.clusterNow();
  const c1Draft: ActionDraft = { kind: "Coupon", recordTs: t + 25, paymentTs: t + 45, claimDeadlineTs: t + 7 * DAY, params: { kind: "Coupon", period: 1, couponBps: 1_200 } };
  const c1 = await runAction("coupon 1", c1Draft, mint);
  await step("coupon 1: fund paying vault", () => desk.fund(c1));
  await waitUntil(c1Draft.paymentTs, "coupon 1 payment date");
  for (const i of [0, 2, 3, 4]) await step(`coupon 1: push payment to ${DEMO_HOLDER_LABELS[i]}`, () => desk.pay(c1, holders[i].publicKey.toBase58()));
  await step(`coupon 1: ${DEMO_HOLDER_LABELS[1]} claims (pull)`, () => desk.claim(c1, holders[1].publicKey.toBase58()));
  await step("coupon 1: settle", () => desk.settle(c1));

  // 4. Bondholder vote — closed with a majority.
  t = await ledger.clusterNow();
  const voteDraft: ActionDraft = {
    kind: "Vote",
    recordTs: t + 25,
    paymentTs: t + 75,
    claimDeadlineTs: t + 75,
    params: { kind: "Vote", question: "Extend the audited-report deadline from 120 to 150 days", options: ["For", "Against", "Abstain"] },
  };
  const vote = await runAction("vote", voteDraft, mint);
  for (const [i, choice] of [[0, 0], [1, 1], [3, 0]] as const) {
    await step(`vote: ${DEMO_HOLDER_LABELS[i]} votes ${voteDraft.params.kind === "Vote" ? voteDraft.params.options[choice] : choice}`, () => desk.vote(vote, holders[i].publicKey.toBase58(), choice));
  }
  await waitUntil(voteDraft.paymentTs, "vote close");
  await step("vote: close and record the winner", () => desk.settle(vote));

  // 5. Coupon 2 — in progress (snapshot posted, awaiting funding).
  t = await ledger.clusterNow();
  const c2Draft: ActionDraft = { kind: "Coupon", recordTs: t + 25, paymentTs: t + 120, claimDeadlineTs: t + 14 * DAY, params: { kind: "Coupon", period: 2, couponBps: 1_200 } };
  const c2 = await runAction("coupon 2", c2Draft, mint);

  const inst = await ledger.client.fetchInstrumentByMint(bond.publicKey);
  const summary = {
    network: "devnet",
    program: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
    issuer: issuer!.publicKey.toBase58(),
    instrument: inst!.address.toBase58(),
    mint,
    settlementMint: usd.publicKey.toBase58(),
    supply: (toBigInt(inst!.account.issuedUnits) - toBigInt(inst!.account.redeemedUnits)).toString(),
    holders: holders.map((h, i) => ({ label: DEMO_HOLDER_LABELS[i], address: h.publicKey.toBase58() })),
    actions: { coupon1: c1, vote, coupon2: c2 },
    steps: steps.map((s) => ({ ...s, url: explorer("tx", s.signature) })),
    createdAt: new Date().toISOString(),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "latest.json"), JSON.stringify(summary, null, 2));
  console.log(`\nInstrument ${explorer("address", summary.instrument)}`);
  console.log(`Bond mint  ${mint}  (optionally pin it: MARKETS_INSTRUMENT_MINT=${mint})`);
  console.log(`Verify     /verify/${c1}  /verify/${vote}  /verify/${c2}`);
  console.log(`${steps.length} transactions. Summary: .data/markets-seed/latest.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
