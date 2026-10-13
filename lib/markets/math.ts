import { amountPerUnit, entitlementFor, partialRedeemUnits, type ActionTerms } from "./entitlements";
import type { ActionParams, Instrument } from "./service";

/**
 * Entitlement math for the UI, delegating to `entitlements.ts` (the byte-for-byte mirror of the
 * program's `math.rs`). Integer only.
 *
 * Rounding is per unit (per denomination, the market convention): the amount for one bond unit is
 * floored first and then multiplied by units, so every unit receives the same amount.
 *
 * Coupon            perUnit = floor(face × rateBps / 10_000 / frequency); amount = units × perUnit
 * PartialRedemption redeem  = floor(units × redeemBps / 10_000)          (whole units, per holder)
 *                   perUnit = floor(face × priceBps / 10_000);          amount = redeem × perUnit
 * FinalRedemption   perUnit = floor(face × priceBps / 10_000) + coupon(rateBps); amount = units × perUnit
 * Vote              weight  = units
 *
 * The program stores `total_entitlement` = total_units × perUnit (coupon / final) or
 * total_redeem_units × perUnit (partial), which equals Σ holder amounts exactly.
 */

export type Terms = Pick<Instrument, "faceValue" | "couponBps" | "frequency">;
export type HolderEntitlement = { amount: bigint; redeemUnits: bigint; weight: bigint };

/** UI parameters → the four numbers the program's `announce` takes. */
export function actionTerms(params: ActionParams): ActionTerms {
  switch (params.kind) {
    case "Coupon":
      return { kind: "Coupon", rateBps: params.couponBps, redeemBps: 0, priceBps: 0 };
    case "PartialRedemption":
      return { kind: "PartialRedemption", rateBps: 0, redeemBps: params.redeemBps, priceBps: params.priceBps };
    case "FinalRedemption":
      return { kind: "FinalRedemption", rateBps: params.includeCoupon ? params.couponBps : 0, redeemBps: 0, priceBps: params.priceBps };
    case "Vote":
      return { kind: "Vote", rateBps: 0, redeemBps: 0, priceBps: 0 };
  }
}

/** Settlement base units per unit, exactly as `announce` stores `amount_per_unit`. */
export function perUnitAmount(terms: Terms, params: ActionParams): bigint {
  return amountPerUnit(terms, actionTerms(params));
}

export function holderEntitlement(terms: Terms, params: ActionParams, units: bigint): HolderEntitlement {
  const t = actionTerms(params);
  const e = entitlementFor(t.kind, amountPerUnit(terms, t), t.redeemBps, units);
  return { amount: e.amount, redeemUnits: e.burnUnits, weight: e.weight };
}

/**
 * What the program stores as `total_entitlement` after `post_snapshot`. For a partial redemption
 * pass the posted `totalRedeemUnits` (Σ per-holder floors); without it the formula is applied to
 * the total, which is an upper bound.
 */
export function programTotal(terms: Terms, params: ActionParams, totalUnits: bigint, totalRedeemUnits?: bigint): bigint {
  const perUnit = perUnitAmount(terms, params);
  switch (params.kind) {
    case "Vote":
      return BigInt(0);
    case "PartialRedemption":
      return (totalRedeemUnits ?? partialRedeemUnits(totalUnits, params.redeemBps)) * perUnit;
    default:
      return totalUnits * perUnit;
  }
}

export function isPaymentAction(params: Pick<ActionParams, "kind">) {
  return params.kind !== "Vote";
}

export function isRedemption(params: Pick<ActionParams, "kind">) {
  return params.kind === "PartialRedemption" || params.kind === "FinalRedemption";
}
