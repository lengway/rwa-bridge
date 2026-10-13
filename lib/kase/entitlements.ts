import { createHash } from "node:crypto";

/**
 * Pure corporate-action math for the KASE side-track prototype.
 * All money is integer micro-units of the 6-decimal settlement token (1 USD = 1_000_000).
 */
export const SETTLEMENT_DECIMALS = 6;
export const MICRO = BigInt(10 ** SETTLEMENT_DECIMALS);

export type BondTerms = {
  name: string;
  symbol: string;
  faceValueUsd: number;
  /** Annual coupon rate in basis points (1000 = 10%). */
  couponRateBps: number;
  /** Coupon payments per year (2 = semi-annual). */
  couponFrequency: number;
  tenorYears: number;
};

export const DEFAULT_TERMS: BondTerms = {
  name: "Plain Test Bond 10% 2Y",
  symbol: "PTB10",
  faceValueUsd: 1000,
  couponRateBps: 1000,
  couponFrequency: 2,
  tenorYears: 2,
};

export type Holding = { owner: string; units: bigint };
export type Snapshot = {
  instrument: string;
  recordDate: string;
  slot: number;
  holdings: Holding[];
};
export type Entitlement = { owner: string; units: bigint; amountMicro: bigint };

export function faceMicro(terms: BondTerms) {
  return BigInt(Math.round(terms.faceValueUsd)) * MICRO;
}

/** Coupon per bond for one period = face × rate ÷ frequency. 1000 × 10% ÷ 2 = $50. */
export function couponPerUnitMicro(terms: BondTerms) {
  return (faceMicro(terms) * BigInt(terms.couponRateBps)) / (BigInt(10_000) * BigInt(terms.couponFrequency));
}

export function totalCouponPeriods(terms: BondTerms) {
  return terms.tenorYears * terms.couponFrequency;
}

/** Only positive balances are entitled; owners are sorted so the snapshot hash is deterministic. */
export function normalizeHoldings(holdings: Holding[]): Holding[] {
  const merged = new Map<string, bigint>();
  for (const { owner, units } of holdings) {
    if (units <= BigInt(0)) continue;
    merged.set(owner, (merged.get(owner) ?? BigInt(0)) + units);
  }
  return [...merged.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([owner, units]) => ({ owner, units }));
}

export function canonicalSnapshotJson(snapshot: Snapshot) {
  return JSON.stringify({
    instrument: snapshot.instrument,
    recordDate: snapshot.recordDate,
    slot: snapshot.slot,
    holdings: normalizeHoldings(snapshot.holdings).map((h) => [h.owner, h.units.toString()]),
  });
}

export function snapshotHash(snapshot: Snapshot) {
  return createHash("sha256").update(canonicalSnapshotJson(snapshot)).digest("hex");
}

export function couponEntitlements(terms: BondTerms, holdings: Holding[]): Entitlement[] {
  const perUnit = couponPerUnitMicro(terms);
  return normalizeHoldings(holdings).map(({ owner, units }) => ({ owner, units, amountMicro: units * perUnit }));
}

/** Maturity: principal (units × face) plus the final coupon. */
export function redemptionEntitlements(terms: BondTerms, holdings: Holding[]): Entitlement[] {
  const perUnit = faceMicro(terms) + couponPerUnitMicro(terms);
  return normalizeHoldings(holdings).map(({ owner, units }) => ({ owner, units, amountMicro: units * perUnit }));
}

/**
 * Pro-rata partial early redemption: each holder tenders floor(units × pct) bonds,
 * paid at `priceBps` of face (10_000 = par). Rounding down never over-redeems a holder.
 */
export function buybackEntitlements(
  terms: BondTerms,
  holdings: Holding[],
  percentBps: number,
  priceBps = 10_000,
): Entitlement[] {
  if (percentBps <= 0 || percentBps > 10_000) throw new Error("Buyback percent must be in (0, 100%]");
  const unitPrice = (faceMicro(terms) * BigInt(priceBps)) / BigInt(10_000);
  return normalizeHoldings(holdings)
    .map(({ owner, units }) => {
      const redeemed = (units * BigInt(percentBps)) / BigInt(10_000);
      return { owner, units: redeemed, amountMicro: redeemed * unitPrice };
    })
    .filter((e) => e.units > BigInt(0));
}

export function sumMicro(entitlements: Entitlement[]) {
  return entitlements.reduce((total, e) => total + e.amountMicro, BigInt(0));
}

export function formatUsd(micro: bigint) {
  const negative = micro < BigInt(0);
  const abs = negative ? -micro : micro;
  const whole = abs / MICRO;
  const cents = (abs % MICRO) / BigInt(10_000);
  return `${negative ? "-" : ""}$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}
