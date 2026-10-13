/**
 * Entitlement math for Plain Markets corporate actions — mirror of the program's `math.rs`.
 *
 * All amounts are integers in settlement base units; bond units have 0 decimals. Every helper
 * fails on u64 overflow exactly where the program would.
 *
 * Rounding: per-denomination. The amount for one bond unit is rounded down first and then
 * multiplied by units, so every unit receives the same amount and the total owed is
 * `totalUnits * amountPerUnit` — the value the program computes on-chain at snapshot time.
 * Partial redemptions burn floor(units * redeemBps / 10_000) per holder.
 */

export type ActionKind = "Coupon" | "PartialRedemption" | "FinalRedemption" | "Vote";

export type InstrumentTerms = {
  /** Par value of one unit in settlement base units. */
  faceValue: bigint;
  /** Annual coupon rate in bps. */
  couponBps: number;
  /** Coupon payments per year: 1, 2, 4 or 12. */
  frequency: number;
};

export type ActionTerms = {
  kind: ActionKind;
  /** Coupon: annual rate (0 = instrument rate). FinalRedemption: final coupon rate (0 = none). */
  rateBps: number;
  /** PartialRedemption: share of each holding redeemed. */
  redeemBps: number;
  /** Redemptions: price in bps of face (10_000 = par). */
  priceBps: number;
};

export type Entitlement = { amount: bigint; burnUnits: bigint; weight: bigint };

const BPS = 10_000n;
const U64_MAX = (1n << 64n) - 1n;

function u64(v: bigint, what: string): bigint {
  if (v < 0n || v > U64_MAX) throw new Error(`${what} overflows u64`);
  return v;
}

function bps(v: number, what: string): bigint {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff) throw new Error(`${what} must be a u16`);
  return BigInt(v);
}

export function couponPerUnit(faceValue: bigint, rateBps: number, frequency: number): bigint {
  if (!Number.isInteger(frequency) || frequency <= 0 || frequency > 255) throw new Error("frequency must be a positive u8");
  return u64((u64(faceValue, "face") * bps(rateBps, "rate")) / (BPS * BigInt(frequency)), "coupon per unit");
}

export function pricePerUnit(faceValue: bigint, priceBps: number): bigint {
  return u64((u64(faceValue, "face") * bps(priceBps, "price")) / BPS, "price per unit");
}

export function finalPerUnit(faceValue: bigint, priceBps: number, rateBps: number, frequency: number): bigint {
  return u64(pricePerUnit(faceValue, priceBps) + couponPerUnit(faceValue, rateBps, frequency), "final per unit");
}

export function partialRedeemUnits(units: bigint, redeemBps: number): bigint {
  return u64((u64(units, "units") * bps(redeemBps, "redeem share")) / BPS, "redeem units");
}

/** floor(T*b) - (n-1) <= sum of per-holder floors <= floor(T*b). */
export function partialRedeemBounds(totalUnits: bigint, redeemBps: number, holderCount: number): [bigint, bigint] {
  const max = partialRedeemUnits(totalUnits, redeemBps);
  const slack = BigInt(Math.max(holderCount - 1, 0));
  return [max > slack ? max - slack : 0n, max];
}

/** Effective coupon rate of a Coupon action (0 means "use the instrument rate"). */
export function effectiveRateBps(instrument: InstrumentTerms, action: ActionTerms): number {
  return action.kind === "Coupon" && action.rateBps === 0 ? instrument.couponBps : action.rateBps;
}

/** `amount_per_unit` exactly as `announce` stores it. */
export function amountPerUnit(instrument: InstrumentTerms, action: ActionTerms): bigint {
  switch (action.kind) {
    case "Coupon":
      return couponPerUnit(instrument.faceValue, effectiveRateBps(instrument, action), instrument.frequency);
    case "PartialRedemption":
      return pricePerUnit(instrument.faceValue, action.priceBps);
    case "FinalRedemption":
      return finalPerUnit(instrument.faceValue, action.priceBps, action.rateBps, instrument.frequency);
    case "Vote":
      return 0n;
  }
}

/** What one holder of `units` receives / burns / weighs, as `claim`, `pay` and `cast_vote` compute it. */
export function entitlementFor(kind: ActionKind, perUnit: bigint, redeemBps: number, units: bigint): Entitlement {
  u64(units, "units");
  switch (kind) {
    case "Coupon":
      return { amount: u64(units * perUnit, "amount"), burnUnits: 0n, weight: 0n };
    case "PartialRedemption": {
      const burnUnits = partialRedeemUnits(units, redeemBps);
      return { amount: u64(burnUnits * perUnit, "amount"), burnUnits, weight: 0n };
    }
    case "FinalRedemption":
      return { amount: u64(units * perUnit, "amount"), burnUnits: units, weight: 0n };
    case "Vote":
      return { amount: 0n, burnUnits: 0n, weight: units };
  }
}

export type ActionTotals = {
  perUnit: bigint;
  totalUnits: bigint;
  holderCount: number;
  /** Units burned across all holders (redemptions). `post_snapshot` takes this for partials. */
  totalRedeemUnits: bigint;
  /** Settlement owed; equals what `post_snapshot` computes on-chain. */
  totalEntitlement: bigint;
  rows: ({ holder: string; units: bigint } & Entitlement)[];
};

export function actionTotals(
  instrument: InstrumentTerms,
  action: ActionTerms,
  holdings: { holder: string; units: bigint }[],
): ActionTotals {
  const perUnit = amountPerUnit(instrument, action);
  let totalUnits = 0n;
  let totalRedeemUnits = 0n;
  let sumAmount = 0n;
  const rows = holdings.map((h) => {
    const e = entitlementFor(action.kind, perUnit, action.redeemBps, h.units);
    totalUnits += h.units;
    totalRedeemUnits += e.burnUnits;
    sumAmount += e.amount;
    return { holder: h.holder, units: h.units, ...e };
  });
  u64(totalUnits, "total units");
  // On-chain: coupon/final total = totalUnits * perUnit; partial = totalRedeemUnits * perUnit.
  // Per-denomination rounding makes these identical to the per-holder sum.
  const totalEntitlement =
    action.kind === "Vote"
      ? 0n
      : action.kind === "PartialRedemption"
        ? u64(totalRedeemUnits * perUnit, "total entitlement")
        : u64(totalUnits * perUnit, "total entitlement");
  if (totalEntitlement !== sumAmount) throw new Error("entitlement totals do not reconcile");
  return { perUnit, totalUnits, holderCount: holdings.length, totalRedeemUnits, totalEntitlement, rows };
}
