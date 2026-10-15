import assert from "node:assert/strict";
import test from "node:test";

import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { MarketsClient, bondAta, pda, type InstrumentRef } from "../lib/markets/client";
import { DevnetLedger } from "../lib/markets/devnet-service";
import {
  accrualPeriod,
  accruedCoupon,
  announcedCouponPeriods,
  addMonthsUtc,
  allocationMemo,
  allocationWindow,
  calendarFor,
  checkAllocation,
  couponSchedule,
  currentPeriod,
  nextCoupon,
  nextCouponDate,
  parseAllocationMemo,
  periodsElapsed,
  votesFor,
  yieldToMaturity,
  type BondTerms,
  type InstrumentReading,
  type IssueState,
  type ViewContext,
} from "../lib/markets/investor";
import { readBond, readOverview } from "../lib/markets/investor-reads";
import type { CorporateAction } from "../lib/markets/service";

import { settledCouponFixture } from "./helpers/markets-fixture";

const USD = BigInt(1_000_000);
const day = 86_400;
const utc = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// The live devnet bond: $1,000 face, 12% paid quarterly, 2 years.
const PDB: BondTerms = { faceValue: BigInt(1000) * USD, couponBps: 1200, frequency: 4, issueTs: utc("2026-07-13T16:42:47Z"), maturityTs: utc("2028-07-12T16:42:47Z") };

const OPEN: IssueState = { status: "Active", maturityTs: PDB.maturityTs, lockFrom: 0, lockUntil: 0, pendingAction: false, openRedemption: false };

// ---- schedule, accrual, yield -------------------------------------------------------------------------

test("calendar months clamp to the end of shorter months, in UTC", () => {
  assert.equal(addMonthsUtc(utc("2026-01-31T10:00:00Z"), 1), utc("2026-02-28T10:00:00Z"));
  assert.equal(addMonthsUtc(utc("2027-11-30T00:00:00Z"), 3), utc("2028-02-29T00:00:00Z"));
  assert.equal(addMonthsUtc(utc("2026-07-13T16:42:47Z"), 12), utc("2027-07-13T16:42:47Z"));
});

test("coupon schedule: 8 quarterly dates, the last one at maturity", () => {
  const dates = couponSchedule(PDB);
  assert.equal(dates.length, 8);
  assert.equal(dates[0], utc("2026-10-13T16:42:47Z"));
  assert.equal(dates[3], utc("2027-07-13T16:42:47Z"));
  assert.equal(dates.at(-1), PDB.maturityTs);
  assert.ok(dates.every((d, i) => i === 0 || d > dates[i - 1]));
  assert.deepEqual(couponSchedule({ ...PDB, maturityTs: PDB.issueTs }), []);
});

test("current period and next coupon date", () => {
  const now = utc("2026-11-01T00:00:00Z");
  assert.deepEqual(currentPeriod(PDB, now), { index: 2, start: utc("2026-10-13T16:42:47Z"), end: utc("2027-01-13T16:42:47Z") });
  assert.equal(nextCouponDate(PDB, now), utc("2027-01-13T16:42:47Z"));
  assert.equal(currentPeriod(PDB, PDB.issueTs - 1), null);
  assert.equal(currentPeriod(PDB, PDB.maturityTs), null);
  assert.equal(nextCouponDate(PDB, PDB.maturityTs), null);
});

test("accrued coupon is linear within the period, on the program's per-unit coupon, rounded down", () => {
  const p = currentPeriod(PDB, utc("2026-11-01T00:00:00Z"))!;
  const perPeriod = BigInt(30) * USD; // 1000 × 12% / 4
  assert.equal(accruedCoupon(PDB, BigInt(5), p.start), BigInt(0));
  const mid = p.start + Math.floor((p.end - p.start) / 2);
  const expected = (perPeriod * BigInt(5) * BigInt(mid - p.start)) / BigInt(p.end - p.start);
  assert.equal(accruedCoupon(PDB, BigInt(5), mid), expected);
  assert.ok(expected > BigInt(74_999_000) && expected <= BigInt(75) * USD);
  assert.equal(accruedCoupon(PDB, BigInt(5), p.end - 1) < perPeriod * BigInt(5), true);
  assert.equal(accruedCoupon(PDB, BigInt(0), mid), BigInt(0));
  assert.equal(accruedCoupon(PDB, BigInt(5), PDB.maturityTs + day), BigInt(0));
});

test("yield to maturity: par ≈ coupon rate, discount above, premium below", () => {
  const onCoupon = couponSchedule(PDB)[0];
  const par = yieldToMaturity(PDB, PDB.faceValue, onCoupon)!;
  assert.ok(Math.abs(par - 0.12) < 0.0005, `par yield ${par}`);
  const discount = yieldToMaturity(PDB, BigInt(950) * USD, onCoupon)!;
  const premium = yieldToMaturity(PDB, BigInt(1050) * USD, onCoupon)!;
  assert.ok(discount > 0.14 && discount < 0.16, `discount ${discount}`);
  assert.ok(premium > 0.08 && premium < 0.10, `premium ${premium}`);
  // Mid-period at par the buyer gets the full next coupon early, so the yield is a little higher.
  assert.ok(yieldToMaturity(PDB, PDB.faceValue, onCoupon + 45 * day)! > par);
  assert.equal(yieldToMaturity(PDB, PDB.faceValue, PDB.maturityTs), null);
  assert.equal(yieldToMaturity(PDB, BigInt(0), onCoupon), null);
});

// ---- allocation guard -----------------------------------------------------------------------------

test("allocation window mirrors the program's issue preconditions", () => {
  const now = utc("2026-11-01T00:00:00Z");
  assert.deepEqual(allocationWindow(OPEN, now), { open: true, reason: null });
  assert.match(allocationWindow({ ...OPEN, status: "Matured" }, now).reason!, /matured/);
  assert.match(allocationWindow({ ...OPEN, status: "Redeemed" }, now).reason!, /redeemed/);
  assert.match(allocationWindow(OPEN, PDB.maturityTs).reason!, /maturity/);
  assert.match(allocationWindow({ ...OPEN, openRedemption: true }, now).reason!, /redemption/);
  assert.match(allocationWindow({ ...OPEN, lockFrom: now - 10, lockUntil: now + 10 }, now).reason!, /locked/);
  assert.equal(allocationWindow({ ...OPEN, lockFrom: now - 10, lockUntil: now }, now).open, true);
  assert.match(allocationWindow({ ...OPEN, pendingAction: true }, now).reason!, /recording the register/);
});

test("allocation check: units, window, per-investor cap", () => {
  const now = utc("2026-11-01T00:00:00Z");
  const limits = { capUnits: 20, maxPerRequest: 10 };
  const run = (units: unknown, held = 0, state = OPEN) => checkAllocation({ units, heldUnits: BigInt(held), state, now, limits });
  assert.deepEqual(run(5), { ok: true, units: BigInt(5) });
  for (const bad of [0, -1, 11, 2.5, "5", null, undefined, Number.NaN, 2 ** 60]) {
    const r = run(bad);
    assert.equal(r.ok, false, String(bad));
    if (!r.ok) assert.equal(r.code, "invalid_units");
  }
  const closed = run(5, 0, { ...OPEN, pendingAction: true });
  assert.equal(!closed.ok && closed.code, "closed");
  assert.equal(!closed.ok && closed.status, 409);
  const full = run(1, 20);
  assert.equal(!full.ok && full.code, "cap_reached");
  const over = run(6, 15);
  assert.equal(!over.ok && over.code, "over_cap");
  assert.match(!over.ok ? over.message : "", /up to 5 more units/);
  assert.match(!run(2, 19).ok ? (run(2, 19) as { message: string }).message : "", /up to 1 more unit \(/);
  assert.deepEqual(run(5, 15), { ok: true, units: BigInt(5) });
});

test("allocation memo round-trips and rejects junk", () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(parseAllocationMemo(allocationMemo(wallet, BigInt(7))), { holder: wallet, units: BigInt(7) });
  for (const junk of ["pm:alloc:1", `pm:alloc:1 ${wallet}`, `pm:alloc:1 not-a-key 3`, `pm:alloc:1 ${wallet} -3`, `pm:snap:1 ${wallet} 3`]) assert.equal(parseAllocationMemo(junk), null, junk);
});

// ---- smart wallets (PDA owners) -------------------------------------------------------------------

test("issue and pay target the off-curve ATAs of a smart-wallet PDA", async () => {
  const client = MarketsClient.fromConnection(new Connection("http://unused"));
  const owner = PublicKey.findProgramAddressSync([Buffer.from("smart-wallet")], Keypair.generate().publicKey)[0];
  assert.equal(PublicKey.isOnCurve(owner.toBytes()), false);
  const mint = Keypair.generate().publicKey;
  const usd = Keypair.generate().publicKey;
  const issuer = Keypair.generate().publicKey;
  const instrument = { address: pda.instrument(mint), account: { mint, issuer, payingAgent: issuer, settlementMint: usd, settlementTokenProgram: TOKEN_PROGRAM_ID, allowlistEnabled: true } } as unknown as InstrumentRef;
  const issue = await client.issue(instrument, owner, BigInt(3));
  const keys = issue.keys.map((k) => k.pubkey.toBase58());
  assert.ok(keys.includes(bondAta(owner, mint).toBase58()));
  assert.ok(keys.includes(pda.allow(instrument.address, owner).toBase58()));
  const action = { address: pda.action(instrument.address, 0), account: { kind: { coupon: {} } } } as never;
  const pay = await client.pay(instrument, action, issuer, owner, BigInt(3), []);
  assert.ok(pay.keys.some((k) => k.pubkey.equals(getAssociatedTokenAddressSync(usd, owner, true, TOKEN_PROGRAM_ID))));
});

// ---- portfolio views over the chain ---------------------------------------------------------------

test("investor views over the chain: a smart-wallet holder sees its position, coupon, calendar and balance", async () => {
  const fx = await settledCouponFixture({ smartWallet: true });
  const ledger = new DevnetLedger(fx.config, null, { connection: fx.connection, poll: false });
  const wallet = fx.holders[2].toBase58();
  const limits = { capUnits: 20, maxPerRequest: 10 };

  // The register marks the allocated smart wallet as a Plain investor; others keep their labels.
  const register = await ledger.getRegister(fx.mint.toBase58());
  const entry = register.entries.find((e) => e.holder === wallet)!;
  assert.deepEqual([entry.plainInvestor, entry.custody, entry.units], [true, "smart-wallet", BigInt(20)]);
  assert.equal(register.entries.find((e) => e.holder === fx.holders[0].toBase58())?.plainInvestor, undefined);

  const overview = await readOverview(ledger, wallet, limits);
  assert.equal(overview.available, true);
  assert.equal(overview.offerings.length, 1);
  const offering = overview.offerings[0];
  assert.equal(offering.couponPerUnit, String(BigInt(30) * USD));
  assert.equal(offering.couponCount, couponSchedule({ issueTs: fx.T - 90 * day, maturityTs: fx.T + 700 * day, frequency: 4 }).length);
  assert.ok(offering.ytmBps! > 1150 && offering.ytmBps! < 1300, String(offering.ytmBps));

  assert.equal(overview.positions.length, 1);
  assert.equal(overview.positions[0].units, "20");
  assert.equal(overview.positions[0].faceValue, String(BigInt(20_000) * USD));
  assert.equal(overview.positions[0].nextCouponAmount, String(BigInt(600) * USD));

  assert.equal(overview.payments.length, 1);
  const paid = overview.payments[0];
  assert.deepEqual([paid.amount, paid.units, paid.mode, paid.verifyUrl], [String(BigInt(600) * USD), "20", "push", `/verify/${fx.action.toBase58()}`]);
  assert.match(paid.explorerUrl ?? "", /explorer\.solana\.com\/tx\/.+cluster=devnet/);
  assert.deepEqual(overview.settlement, [{ mint: fx.usd.toBase58(), symbol: "USD", decimals: 6, amount: String(BigInt(600) * USD) }]);
  // Settled coupon 1 is not in the calendar; later scheduled coupons are, with this position's amount.
  assert.ok(overview.calendar.length > 0);
  assert.ok(overview.calendar.every((c) => c.kind === "scheduled" && c.amount === String(BigInt(600) * USD)));
  assert.ok(!overview.calendar.some((c) => c.title.startsWith("Coupon 1 ")));

  const detail = (await readBond(ledger, wallet, fx.mint.toBase58(), limits))!;
  assert.equal(detail.actions.length, 1);
  assert.equal(detail.actions[0].status, "Settled");
  assert.deepEqual(detail.actions[0].mine, { units: "20", amount: String(BigInt(600) * USD), payment: paid });
  assert.ok(detail.actions[0].transitions.length >= 5);
  assert.equal(await readBond(ledger, wallet, Keypair.generate().publicKey.toBase58(), limits), null);

  // A wallet with nothing sees the offering and no position.
  const stranger = await readOverview(ledger, Keypair.generate().publicKey.toBase58(), limits);
  assert.equal(stranger.available && stranger.positions.length, 0);
  assert.equal(stranger.available && stranger.payments.length, 0);
});

// ---- calendar and votes (pure) --------------------------------------------------------------------

function reading(actions: CorporateAction[], over: Partial<InstrumentReading> = {}): InstrumentReading {
  const instrument = {
    mint: "Mint1111111111111111111111111111111111111111",
    address: "Inst1111111111111111111111111111111111111111",
    symbol: "PDB28",
    name: "Plain Demo Bond",
    settlementSymbol: "USD",
    settlementDecimals: 6,
    status: "Active",
    ...PDB,
  } as InstrumentReading["instrument"];
  return { instrument, issue: OPEN, actions, snapshots: new Map(), receipts: new Map(), votes: new Map(), heldUnits: BigInt(4), ...over };
}

const ctxAt = (now: number, wallet = "Wallet1111111111111111111111111111111111111"): ViewContext => ({
  wallet,
  now,
  limits: { capUnits: 20, maxPerRequest: 10 },
  explorerTx: (s) => `https://explorer/${s}`,
  explorerAddress: (a) => `https://explorer/${a}`,
});

test("calendar: an announced coupon replaces its scheduled date and uses the current balance before the snapshot", () => {
  const now = utc("2026-11-01T00:00:00Z");
  const coupon2 = {
    id: "Act2",
    seq: 2,
    kind: "Coupon",
    params: { kind: "Coupon", period: 2, couponBps: 1200 },
    status: "Announced",
    title: "Coupon 2 of 8",
    recordTs: now + 2 * day,
    paymentTs: now + 5 * day,
    amountPerUnit: BigInt(30) * USD,
    transitions: [],
  } as unknown as CorporateAction;
  const cal = calendarFor(reading([coupon2]), ctxAt(now));
  assert.deepEqual(cal.slice(0, 2).map((c) => [c.kind, c.ts, c.amount]), [
    ["record", now + 2 * day, null],
    ["payment", now + 5 * day, String(BigInt(120) * USD)],
  ]);
  assert.ok(!cal.some((c) => c.kind === "scheduled" && c.title.startsWith("Coupon 2 ")));
  assert.ok(cal.some((c) => c.kind === "scheduled" && c.title.startsWith("Coupon 3 ")));
  // No balance → no calendar.
  assert.deepEqual(calendarFor(reading([coupon2], { heldUnits: BigInt(0) }), ctxAt(now)), []);
});

test("votes: open votes reach holders even before the snapshot; read-only weight and tally", () => {
  const now = utc("2026-11-01T00:00:00Z");
  const wallet = "Wallet1111111111111111111111111111111111111";
  const vote = (status: string, extra: Partial<CorporateAction> = {}) =>
    ({ id: `Vote${status}`, seq: 3, kind: "Vote", params: { kind: "Vote", question: "Extend the deadline?", options: ["For", "Against"] }, status, title: "Bondholder vote", recordTs: now - day, paymentTs: now + day, amountPerUnit: BigInt(0), tally: [BigInt(7), BigInt(2)], winningOption: null, transitions: [], ...extra }) as unknown as CorporateAction;
  const snap = { version: 1 as const, instrument: "i", mint: "m", action: "VoteSnapshotPosted", recordTs: now - day, slot: 1, holdings: [{ holder: wallet, units: BigInt(4) }] };
  const r = reading([vote("Announced"), vote("SnapshotPosted"), vote("Settled", { paymentTs: now - day, winningOption: 0 })], {
    snapshots: new Map([["VoteSnapshotPosted", snap]]),
  });
  const votes = votesFor(r, ctxAt(now, wallet));
  assert.deepEqual(votes.map((v) => [v.status, v.open, v.weight]), [["Announced", true, null], ["SnapshotPosted", true, "4"]]);
  assert.deepEqual(votes[1].tally, ["7", "2"]);
  // Without units, an upcoming vote does not concern this wallet.
  assert.equal(votesFor(reading([vote("Announced")], { heldUnits: BigInt(0) }), ctxAt(now, wallet)).length, 0);
});

test("coupons paid ahead of the calendar: accrual and the next date follow the first unannounced period", () => {
  const now = utc("2026-10-14T10:00:00Z");
  const dates = couponSchedule(PDB);
  const coupon = (period: number, status: string, paymentTs = now - 3600) => ({ params: { kind: "Coupon" as const, period, couponBps: 1200 }, status: status as CorporateAction["status"], paymentTs });
  // The live demo bond: coupons 1–4 already announced on accelerated timing.
  const four = [1, 2, 3, 4].map((p) => coupon(p, "Settled"));
  assert.equal(announcedCouponPeriods(four), 4);
  assert.deepEqual(accrualPeriod(PDB, now, 4), { index: 5, start: dates[3], end: dates[4] });
  assert.equal(accruedCoupon(PDB, BigInt(5), now, 4), BigInt(0));
  assert.equal(nextCouponDate(PDB, now, four), dates[4]);
  // An announced coupon that is not paid yet comes first.
  assert.equal(nextCouponDate(PDB, now, [...four, coupon(5, "Funded", now + 600)]), now + 600);
  // Cancelled coupons do not count; with nothing announced, accrual follows the calendar.
  assert.equal(announcedCouponPeriods([coupon(1, "Cancelled")]), 0);
  assert.equal(accruedCoupon(PDB, BigInt(5), now), accruedCoupon(PDB, BigInt(5), now, periodsElapsed(PDB, now)));
  assert.equal(accrualPeriod(PDB, now, 8), null);
  // Accrual never exceeds one period, even long after its end.
  assert.equal(accruedCoupon(PDB, BigInt(1), dates[2] + 10 * day, 1), BigInt(30) * USD);
});

test("next coupon says whether it is announced or only scheduled", () => {
  const now = utc("2026-10-15T10:00:00Z");
  const dates = couponSchedule(PDB);
  const settled = [1, 2, 3, 4].map((p) => ({ id: `A${p}`, params: { kind: "Coupon" as const, period: p, couponBps: 1200 }, status: "Settled" as CorporateAction["status"], paymentTs: now - day }));
  assert.deepEqual(nextCoupon(PDB, now, settled), { ts: dates[4], source: "scheduled", period: 5, actionId: null });
  const announced = { id: "A5", params: { kind: "Coupon" as const, period: 5, couponBps: 1200 }, status: "Funded" as CorporateAction["status"], paymentTs: now + 300 };
  assert.deepEqual(nextCoupon(PDB, now, [...settled, announced]), { ts: now + 300, source: "announced", period: 5, actionId: "A5" });
  assert.equal(nextCoupon(PDB, PDB.maturityTs + 1), null);
});
