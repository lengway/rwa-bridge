type Receipt = {
  signature: string;
  action: "deposit" | "withdraw";
  actualLiquidityAmountAtomic: string;
  actualCollateralAmountAtomic: string;
};

/** External cToken holdings cannot be assigned a made-up cost basis. */
export function trackedProtocolGain(
  collateralAtomic: string,
  underlyingAtomic: string,
  receipts: readonly Receipt[],
) {
  return trackedPosition(collateralAtomic, underlyingAtomic, receipts)?.gainAtomic ?? null;
}

/**
 * Net principal (deposits − withdrawals) and gain over it, from finalized
 * receipts only. Null when receipts do not account for the whole cToken
 * balance, because any number shown then would be a guess.
 */
export function trackedPosition(
  collateralAtomic: string,
  underlyingAtomic: string,
  receipts: readonly Receipt[],
) {
  let collateral = BigInt(0);
  let principal = BigInt(0);
  const seen = new Set<string>();
  for (const receipt of receipts) {
    if (seen.has(receipt.signature)) continue;
    seen.add(receipt.signature);
    if (
      !/^\d+$/.test(receipt.actualLiquidityAmountAtomic) ||
      !/^\d+$/.test(receipt.actualCollateralAmountAtomic)
    )
      return null;
    const direction = receipt.action === "deposit" ? BigInt(1) : BigInt(-1);
    collateral += direction * BigInt(receipt.actualCollateralAmountAtomic);
    principal += direction * BigInt(receipt.actualLiquidityAmountAtomic);
  }
  if (
    !/^\d+$/.test(collateralAtomic) ||
    !/^\d+$/.test(underlyingAtomic) ||
    collateral !== BigInt(collateralAtomic)
  )
    return null;
  return {
    principalAtomic: principal.toString(),
    gainAtomic: (BigInt(underlyingAtomic) - principal).toString(),
  };
}

/** Exchange-rate flooring can leave a value a few atoms under principal. */
export const EARNED_ROUNDING_TOLERANCE_ATOMIC = BigInt(10_000);

/** Display-only: a tiny negative gain is rounding, not a loss. */
export function displayEarnedAtomic(gainAtomic: string | null | undefined) {
  if (gainAtomic == null || !/^-?\d+$/.test(gainAtomic)) return null;
  const gain = BigInt(gainAtomic);
  return gain < BigInt(0) && -gain <= EARNED_ROUNDING_TOLERANCE_ATOMIC ? "0" : gain.toString();
}
