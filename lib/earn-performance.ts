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
  return (BigInt(underlyingAtomic) - principal).toString();
}
