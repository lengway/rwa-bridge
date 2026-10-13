import assert from "node:assert/strict";
import test from "node:test";
import { holderEntitlement, perUnitAmount, programTotal } from "../lib/markets/math";
import { SIM_HOLDERS, SIM_MINT, createSimulatedMarketsService, ts } from "../lib/markets/mock-service";
import { buildMerkleTree, merkleProof, snapshotHash, verifyProof } from "../lib/markets/snapshot";
import { formatSettlement } from "../lib/markets/format";

const usd = (n: number) => BigInt(n) * BigInt(1_000_000);
const terms = { faceValue: usd(1_000), couponBps: 1_000, frequency: 2 };

test("coupon: 10% semi-annual on $1,000 face pays $50 per unit", () => {
  assert.equal(holderEntitlement(terms, { kind: "Coupon", period: 1, couponBps: 1_000 }, BigInt(10)).amount, usd(500));
  assert.equal(perUnitAmount(terms, { kind: "Coupon", period: 1, couponBps: 1_000 }), usd(50));
});

test("partial redemption rounds units down per holder; program total keeps the residue", () => {
  const params = { kind: "PartialRedemption" as const, redeemBps: 2_500, priceBps: 10_000 };
  const rows = SIM_HOLDERS.map((h) => holderEntitlement(terms, params, h.units));
  assert.deepEqual(rows.map((r) => Number(r.redeemUnits)), [100, 62, 45, 30, 12]);
  const sum = rows.reduce((n, r) => n + r.amount, BigInt(0));
  assert.equal(sum, usd(249_000));
  assert.equal(programTotal(terms, params, BigInt(1_000)), usd(250_000));
});

test("final redemption pays principal plus the last coupon", () => {
  const e = holderEntitlement(terms, { kind: "FinalRedemption", priceBps: 10_000, includeCoupon: true, couponBps: 1_000 }, BigInt(3));
  assert.equal(e.amount, usd(3_150));
  assert.equal(e.redeemUnits, BigInt(3));
});

test("merkle proofs verify for every holder and fail for a changed balance", async () => {
  const tree = await buildMerkleTree(SIM_HOLDERS);
  assert.match(tree.root, /^[0-9a-f]{64}$/);
  for (const h of tree.holdings) assert.ok(await verifyProof(tree.root, h, merkleProof(tree, h.holder)));
  const h = tree.holdings[0];
  assert.equal(await verifyProof(tree.root, { ...h, units: h.units + BigInt(1) }, merkleProof(tree, h.holder)), false);
  const reordered = await buildMerkleTree([...SIM_HOLDERS].reverse());
  assert.equal(reordered.root, tree.root);
});

test("snapshot hash is order independent", async () => {
  const base = { version: 1 as const, instrument: "I", mint: SIM_MINT, action: SIM_MINT, recordTs: 1, slot: 2 };
  assert.equal(await snapshotHash({ ...base, holdings: SIM_HOLDERS }), await snapshotHash({ ...base, holdings: [...SIM_HOLDERS].reverse() }));
});

test("seeded ledger: every action verifies or is honestly incomplete", async () => {
  const svc = createSimulatedMarketsService();
  const actions = await svc.listActions(SIM_MINT);
  assert.deepEqual(
    actions.map((a) => [a.seq, a.kind, a.status]),
    [
      [4, "PartialRedemption", "Announced"],
      [3, "Coupon", "SnapshotPosted"],
      [2, "Vote", "Settling"],
      [1, "Coupon", "Settled"],
    ],
  );
  for (const a of actions) {
    const report = await svc.verifyAction(a.id);
    assert.ok(!report.checks.some((c) => c.status === "fail"), `${a.title}: ${JSON.stringify(report.checks.filter((c) => c.status === "fail"))}`);
  }
  const settled = await svc.verifyAction(actions[3].id);
  assert.equal(settled.verdict, "verified");
  assert.equal(settled.entitlements?.totalAmount, usd(50_000));
});

test("a tampered snapshot is caught by hash, root and payment checks", async () => {
  const svc = createSimulatedMarketsService();
  const [, , , c1] = await svc.listActions(SIM_MINT);
  const snap = (await svc.getSnapshot(c1.id))!;
  const tampered = { ...snap, holdings: snap.holdings.map((h, i) => (i === 0 ? { ...h, units: h.units + BigInt(5) } : h)) };
  const report = await svc.verifyAction(c1.id, { snapshotOverride: tampered });
  assert.equal(report.verdict, "mismatch");
  const failed = report.checks.filter((c) => c.status === "fail").map((c) => c.id);
  for (const id of ["snapshot-hash", "merkle-root", "total-units", "payments"]) assert.ok(failed.includes(id), id);
});

test("program rules: record date, payment date, double payment, full lifecycle", async () => {
  const svc = createSimulatedMarketsService();
  const [redemption, c2] = await svc.listActions(SIM_MINT);
  await assert.rejects(svc.lockRecord(redemption.id), /record date/);
  await svc.fund(c2.id);
  const holder = SIM_HOLDERS[0].holder;
  await assert.rejects(svc.pay(c2.id, holder), /payment date/);
  await svc.simulation.advanceTo(ts("2026-10-15T12:00:00Z"));
  await svc.pay(c2.id, holder);
  await assert.rejects(svc.claim(c2.id, holder), /Already paid/);
  await assert.rejects(svc.settle(c2.id), /unpaid/);
  for (const h of SIM_HOLDERS.slice(1)) await svc.claim(c2.id, h.holder);
  await svc.settle(c2.id);
  assert.equal((await svc.verifyAction(c2.id)).verdict, "verified");

  await svc.simulation.advanceTo(ts("2026-10-29T12:00:00Z"));
  await svc.lockRecord(redemption.id);
  await svc.postSnapshot(redemption.id);
  await svc.fund(redemption.id);
  await svc.simulation.advanceTo(ts("2026-11-05T12:00:00Z"));
  for (const h of SIM_HOLDERS) await svc.pay(redemption.id, h.holder);
  await svc.settle(redemption.id);
  const report = await svc.verifyAction(redemption.id);
  assert.equal(report.verdict, "verified");
  const instrument = await svc.getInstrument(SIM_MINT);
  assert.equal(instrument?.supply, BigInt(751));
  const events = await svc.listEvents(SIM_MINT);
  assert.match(events[0].detail, /\$1,000\.00 returned to the issuer/);
});

test("formats settlement amounts", () => {
  assert.equal(formatSettlement(usd(50_000)), "$50,000.00");
  assert.equal(formatSettlement(BigInt(1_234_567)), "$1.234567");
});

test("CSV export: one row per holder, plain decimals, receipts referenced", async () => {
  const { entitlementsCsv } = await import("../lib/markets/csv");
  const svc = createSimulatedMarketsService();
  const actions = await svc.listActions(SIM_MINT);
  const c1 = actions.find((a) => a.seq === 1)!;
  const instrument = (await svc.getInstrument(SIM_MINT))!;
  const csv = entitlementsCsv(instrument, c1, await svc.getEntitlements(c1.id));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^instrument,action_id,action_seq,action_type,record_date,payment_date/);
  assert.match(lines[1], /,400,20000\.000000,0,0,paid_push,/);
  assert.ok(lines.slice(1).every((l) => l.includes(",2026-04-08,2026-04-15,snapshot,")));
});

test("next step follows the lifecycle and respects dates", async () => {
  const { nextStep } = await import("../lib/markets/lifecycle");
  const svc = createSimulatedMarketsService();
  const instrument = (await svc.getInstrument(SIM_MINT))!;
  const [redemption, c2, vote, c1] = await svc.listActions(SIM_MINT);
  assert.equal(nextStep(redemption, instrument, null)?.op, "lockRecord");
  assert.equal(nextStep(redemption, instrument, null)?.opensAt, redemption.recordTs);
  assert.equal(nextStep(c2, instrument, null)?.op, "fund");
  assert.equal(nextStep(vote, instrument, null)?.op, "settle");
  assert.equal(nextStep(c1, instrument, null), null);
});
