/**
 * Plain Markets end to end on devnet, through the running app's HTTP routes:
 *
 *   1. finish any corporate action that blocks issuance (fund → pay everyone → settle);
 *   2. a "signed-in" investor (local smoke session for an off-curve smart-wallet address) gets
 *      an allocation from /api/bonds/[mint]/allocate;
 *   3. the issuer announces a coupon with live timing (record in ~1 min, payment ~2.5 min later),
 *      locks the register, posts the snapshot, funds and pushes every payment;
 *   4. /api/bonds shows the investor's position and the received coupon.
 *
 * Needs `npm run dev` (or start) with MARKETS_MODE=devnet, MARKETS_ISSUER_SECRET and
 * AUTH_SESSION_SECRET in .env.local. Devnet only; it signs nothing itself.
 *
 *   npx tsx scripts/markets-investor-e2e.ts [baseUrl] [units]
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { PublicKey } from "@solana/web3.js";

import { DevnetLedger } from "../lib/markets/devnet-service";
import type { InvestorOverview } from "../lib/markets/investor";
import type { ActionDraft, CorporateAction } from "../lib/markets/service";

const BASE = process.argv[2] ?? "http://localhost:3000";
const UNITS = Number(process.argv[3] ?? 5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function env(name: string) {
  if (process.env[name]) return process.env[name]!.trim();
  const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^"|"$/g, "") ?? "";
}

/** A smart-wallet-like address: a PDA, so it has no private key and is off the ed25519 curve. */
const WALLET = PublicKey.findProgramAddressSync([Buffer.from("plain-smoke-smart-wallet")], new PublicKey("SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG"))[0].toBase58();

function smokeCookie(wallet: string) {
  const secret = env("AUTH_SESSION_SECRET");
  if (!secret) throw new Error("AUTH_SESSION_SECRET is missing");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ email: "devnet-smoke@example.com", iat: now, exp: now + 3600, walletAddress: wallet, smoke: true })).toString("base64url");
  return `rwa_bridge_session=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function call<T>(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${BASE}${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID(), ...(init.cookie ? { cookie: init.cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const body = (await response.json().catch(() => null)) as T & { error?: string };
    if (response.status === 429 && attempt < 5) {
      await sleep(Number(response.headers.get("retry-after") ?? 10) * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${body?.error ?? "?"}`);
    return body;
  }
}

const op = (name: string, body: Record<string, unknown>) => call<{ signature: string; actionId?: string }>(`/api/markets/${name}`, { method: "POST", body });
const tx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

async function main() {
  const mint = env("MARKETS_INSTRUMENT_MINT").split(",")[0];
  const ledger = new DevnetLedger(
    { mode: "devnet", rpcUrl: env("MARKETS_RPC_URL") || "https://api.devnet.solana.com", programId: "H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm", issuer: null, mints: [mint], directory: [], settlementSymbol: "USD", writable: false, apiBase: "" },
    null,
    { poll: false },
  );
  const fresh = () => {
    ledger.changed();
    return ledger;
  };
  const cookie = smokeCookie(WALLET);
  console.log(`investor wallet (off-curve PDA): ${WALLET}`);

  async function waitFor(ts: number, label: string) {
    for (;;) {
      const left = ts - (await ledger.clusterNow());
      if (left < 0) return;
      console.log(`  waiting ${left + 2}s for ${label}…`);
      await sleep(Math.min(left + 2, 30) * 1000);
    }
  }

  async function payEveryone(a: CorporateAction) {
    const snap = await fresh().getSnapshot(a.id);
    const paid = new Set((await ledger.listReceipts(a.id)).map((r) => r.holder));
    for (const h of snap?.holdings ?? []) {
      if (paid.has(h.holder)) continue;
      const r = await op("pay", { actionId: a.id, holder: h.holder });
      console.log(`  pay ${h.holder.slice(0, 6)}… (${h.units} units)${h.holder === WALLET ? "  ← Plain investor" : ""}  ${tx(r.signature)}`);
    }
  }

  /** Drives one action from wherever it is to Settled. */
  async function finish(a: CorporateAction) {
    console.log(`→ ${a.title}: ${a.status}`);
    if (a.status === "Announced") {
      await waitFor(a.recordTs, "the record date");
      console.log(`  lockRecord ${tx((await op("lockRecord", { actionId: a.id })).signature)}`);
      a = (await fresh().getAction(a.id))!;
    }
    if (a.status === "RecordLocked") {
      console.log(`  postSnapshot ${tx((await op("postSnapshot", { actionId: a.id })).signature)}`);
      a = (await fresh().getAction(a.id))!;
      const snap = await ledger.getSnapshot(a.id);
      console.log(`  snapshot holders: ${snap?.holdings.length}; Plain investor included: ${snap?.holdings.some((h) => h.holder === WALLET)}`);
    }
    if (a.status === "SnapshotPosted" && a.kind !== "Vote") {
      console.log(`  fund ${tx((await op("fund", { actionId: a.id })).signature)}`);
      a = (await fresh().getAction(a.id))!;
    }
    if (a.kind !== "Vote" && (a.status === "Funded" || a.status === "Settling")) {
      await waitFor(a.paymentTs, "the payment date");
      await payEveryone(a);
      a = (await fresh().getAction(a.id))!;
    }
    if (a.status !== "Settled") {
      if (a.kind === "Vote") await waitFor(a.paymentTs, "the vote close");
      console.log(`  settle ${tx((await op("settle", { actionId: a.id })).signature)}`);
    }
  }

  // 1. Anything open blocks issuance.
  for (const a of (await fresh().listActions(mint)).filter((x) => x.status !== "Settled" && x.status !== "Cancelled").reverse()) await finish(a);

  // 2. Allocation.
  const before = await call<InvestorOverview>("/api/bonds", { cookie });
  if (!before.available) throw new Error(before.reason);
  console.log(`allocation window: ${before.offerings[0].allocation.open ? "open" : before.offerings[0].allocation.reason}`);
  const alloc = await call<{ signature: string; units: string }>(`/api/bonds/${mint}/allocate`, { method: "POST", body: { units: UNITS }, cookie });
  console.log(`allocated ${alloc.units} units to the smart wallet  ${tx(alloc.signature)}`);
  const register = await fresh().getRegister(mint);
  console.log(`register marks it as a Plain investor: ${register.entries.find((e) => e.holder === WALLET)?.plainInvestor === true}`);

  // 3. A live coupon.
  const inst = (await ledger.getInstrument(mint))!;
  const ref = await ledger.instrumentRef(new PublicKey(inst.address));
  const now = await ledger.clusterNow();
  const draft: ActionDraft = {
    kind: "Coupon",
    recordTs: now + 60,
    paymentTs: now + 150,
    claimDeadlineTs: now + 150 + 7 * 86_400,
    params: { kind: "Coupon", period: ref.account.couponPeriods + 1, couponBps: inst.couponBps },
  };
  const announced = await op("announce", { mint, draft });
  console.log(`announce coupon ${draft.params.kind === "Coupon" ? draft.params.period : ""}  ${tx(announced.signature)}`);
  await finish((await fresh().getAction(announced.actionId!))!);

  // 4. What the investor sees.
  await sleep(16_000); // the server refreshes its feed at most every 15 s
  const after = await call<InvestorOverview>("/api/bonds", { cookie });
  if (!after.available) throw new Error(after.reason);
  console.log("position:", after.positions.map((p) => `${p.symbol} ${p.units} units, accrued ${p.accrued}`).join("; "));
  console.log("payments:", after.payments.map((p) => `${p.title} ${p.amount} (${p.mode}) ${p.verifyUrl}`).join("; "));
  console.log("settlement balance:", after.settlement.map((s) => `${s.amount} ${s.symbol}`).join(", "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
