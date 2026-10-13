import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TERMS,
  MICRO,
  buybackEntitlements,
  couponEntitlements,
  couponPerUnitMicro,
  formatUsd,
  redemptionEntitlements,
  snapshotHash,
  sumMicro,
  totalCouponPeriods,
} from "../lib/kase/entitlements";

const usd = (n: number) => BigInt(n) * MICRO;
const h = (owner: string, units: number) => ({ owner, units: BigInt(units) });

test("semi-annual 10% coupon on $1,000 face pays $50 per bond; 10 bonds → $500 (track example)", () => {
  assert.equal(couponPerUnitMicro(DEFAULT_TERMS), usd(50));
  assert.deepEqual(couponEntitlements(DEFAULT_TERMS, [h("A", 10)]), [{ owner: "A", units: BigInt(10), amountMicro: usd(500) }]);
  assert.equal(totalCouponPeriods(DEFAULT_TERMS), 4);
});

test("coupon skips zero balances and merges duplicate owners", () => {
  const out = couponEntitlements(DEFAULT_TERMS, [h("B", 3), h("A", 0), h("B", 2)]);
  assert.deepEqual(out, [{ owner: "B", units: BigInt(5), amountMicro: usd(250) }]);
});

test("redemption pays principal plus the final coupon", () => {
  const out = redemptionEntitlements(DEFAULT_TERMS, [h("A", 10), h("B", 1)]);
  assert.equal(out[0].amountMicro, usd(10_500));
  assert.equal(out[1].amountMicro, usd(1_050));
  assert.equal(sumMicro(out), usd(11_550));
});

test("pro-rata buyback rounds tendered units down and pays at the given price", () => {
  const out = buybackEntitlements(DEFAULT_TERMS, [h("A", 10), h("B", 25), h("C", 4)], 2_000);
  assert.deepEqual(
    out.map((e) => [e.owner, Number(e.units), e.amountMicro]),
    [["A", 2, usd(2_000)], ["B", 5, usd(5_000)]],
  );
  assert.equal(buybackEntitlements(DEFAULT_TERMS, [h("A", 10)], 5_000, 10_100)[0].amountMicro, usd(5_050));
  assert.throws(() => buybackEntitlements(DEFAULT_TERMS, [h("A", 1)], 0));
});

test("snapshot hash is order-independent and changes with balances", () => {
  const base = { instrument: "M", recordDate: "2026-10-13", slot: 1 };
  const a = snapshotHash({ ...base, holdings: [h("A", 1), h("B", 2)] });
  assert.equal(a, snapshotHash({ ...base, holdings: [h("B", 2), h("A", 1)] }));
  assert.notEqual(a, snapshotHash({ ...base, holdings: [h("A", 1), h("B", 3)] }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("formats micro-units as USD", () => {
  assert.equal(formatUsd(usd(10_500)), "$10,500.00");
  assert.equal(formatUsd(BigInt(1_234_567)), "$1.23");
});
