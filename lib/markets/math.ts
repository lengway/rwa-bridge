import type { ActionParams, Instrument } from "./service";

/**
 * Entitlement math, mirroring the `plain_markets` program. Integer only, rounding down,
 * computed per holder from (units, instrument terms, action params) — never from a client amount.
 *
 * Coupon            amount = units × face × couponBps / 10_000 / frequency
 * PartialRedemption redeem = units × redeemBps / 10_000          (whole units, rounded down)
 *                   amount = redeem × face × priceBps / 10_000
 * FinalRedemption   redeem = units
 *                   amount = units × face × priceBps / 10_000 (+ last coupon if included)
 * Vote              weight = units
 *
 * The program derives `total_entitlement` from `total_units` with the same formula. Because each
 * holder is rounded down separately, Σ holder amounts can fall short of that total by less than
 * one unit's payment per holder; that residue stays in the paying vault and returns to the issuer
 * at settlement.
 */

export type Terms = Pick<Instrument, "faceValue" | "couponBps" | "frequency">;
export type HolderEntitlement = { amount: bigint; redeemUnits: bigint; weight: bigint };

const BPS = BigInt(10_000);
const ZERO = BigInt(0);

export function couponAmount(terms: Terms, units: bigint, couponBps = terms.couponBps): bigint {
  return (units * terms.faceValue * BigInt(couponBps)) / BPS / BigInt(terms.frequency);
}

export function holderEntitlement(terms: Terms, params: ActionParams, units: bigint): HolderEntitlement {
  switch (params.kind) {
    case "Coupon":
      return { amount: couponAmount(terms, units, params.couponBps), redeemUnits: ZERO, weight: ZERO };
    case "PartialRedemption": {
      const redeemUnits = (units * BigInt(params.redeemBps)) / BPS;
      return { amount: (redeemUnits * terms.faceValue * BigInt(params.priceBps)) / BPS, redeemUnits, weight: ZERO };
    }
    case "FinalRedemption": {
      const principal = (units * terms.faceValue * BigInt(params.priceBps)) / BPS;
      const coupon = params.includeCoupon ? couponAmount(terms, units, params.couponBps) : ZERO;
      return { amount: principal + coupon, redeemUnits: units, weight: ZERO };
    }
    case "Vote":
      return { amount: ZERO, redeemUnits: ZERO, weight: units };
  }
}

/** What the program stores as `total_entitlement` after `post_snapshot`. */
export function programTotal(terms: Terms, params: ActionParams, totalUnits: bigint): bigint {
  return holderEntitlement(terms, params, totalUnits).amount;
}

/** Payment for a single unit, used to bound the rounding residue. */
export function perUnitAmount(terms: Terms, params: ActionParams): bigint {
  switch (params.kind) {
    case "Coupon":
      return couponAmount(terms, BigInt(1), params.couponBps);
    case "PartialRedemption":
      return (terms.faceValue * BigInt(params.priceBps)) / BPS;
    case "FinalRedemption":
      return holderEntitlement(terms, params, BigInt(1)).amount;
    case "Vote":
      return ZERO;
  }
}

export function isPaymentAction(params: Pick<ActionParams, "kind">) {
  return params.kind !== "Vote";
}

export function isRedemption(params: Pick<ActionParams, "kind">) {
  return params.kind === "PartialRedemption" || params.kind === "FinalRedemption";
}
