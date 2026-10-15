import assert from "node:assert/strict";
import test from "node:test";

import { ACCELERATED_YEAR_SECONDS, couponCount, couponDates, isAccelerated, tenorYears } from "../lib/markets/calendar";
import { actionTitle, couponPeriods } from "../lib/markets/lifecycle";
import { couponSchedule, yieldToMaturity } from "../lib/markets/investor";

const utc = (iso: string) => Math.floor(Date.parse(iso) / 1000);

test("accelerated calendar: the KASE example (2 years, semi-annual) runs in 40 minutes", () => {
  const issueTs = utc("2026-10-15T12:00:00Z");
  const kase = { issueTs, maturityTs: issueTs + 2 * ACCELERATED_YEAR_SECONDS, frequency: 2 };
  assert.equal(isAccelerated(kase), true);
  assert.equal(tenorYears(kase), 2);
  assert.equal(couponCount(kase), 4);
  assert.equal(couponPeriods(kase), 4);
  assert.deepEqual(couponDates(kase), [issueTs + 600, issueTs + 1200, issueTs + 1800, issueTs + 2400]);
  assert.deepEqual(couponSchedule(kase), couponDates(kase));
  assert.equal(actionTitle(kase, { params: { kind: "Coupon", period: 3, couponBps: 1_000 } }), "Coupon 3 of 4");
  // Par bond: yield equals the coupon rate on the accelerated year too.
  const ytm = yieldToMaturity({ ...kase, faceValue: BigInt(1_000_000_000), couponBps: 1_000 }, BigInt(1_000_000_000), issueTs);
  assert.ok(ytm != null && Math.abs(ytm - 0.1) < 1e-9);
});

test("civil calendar is unchanged", () => {
  const issueTs = utc("2026-10-15T00:00:00Z");
  const civil = { issueTs, maturityTs: utc("2028-10-15T00:00:00Z"), frequency: 2 };
  assert.equal(isAccelerated(civil), false);
  assert.equal(couponCount(civil), 4);
  assert.deepEqual(couponDates(civil), [utc("2027-04-15T00:00:00Z"), utc("2027-10-15T00:00:00Z"), utc("2028-04-15T00:00:00Z"), utc("2028-10-15T00:00:00Z")]);
});
