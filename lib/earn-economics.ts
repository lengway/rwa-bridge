/** Product fee policy. Estimates never authorize a charge or alter a balance. */
export const DEFAULT_PERFORMANCE_FEE_BPS = 3500;

export function performanceFeeBps(value?: string) {
  if (value === undefined || value === "") return DEFAULT_PERFORMANCE_FEE_BPS;
  if (!/^\d+$/.test(value)) throw new Error("Invalid performance fee.");
  const bps = Number(value);
  if (!Number.isInteger(bps) || bps < 0 || bps > 4000)
    throw new Error("Performance fee must be between 0 and 40%.");
  return bps;
}

/** Charge only gain above a cash-flow-adjusted high-water mark, never principal. */
export function quotePerformanceFee(
  valueAtomic: bigint,
  highWaterMarkAtomic: bigint,
  feeBps: number,
) {
  if (
    valueAtomic < BigInt(0) ||
    highWaterMarkAtomic < BigInt(0) ||
    !Number.isInteger(feeBps) ||
    feeBps < 0 ||
    feeBps > 4000
  )
    throw new Error("Invalid fee quote.");
  const gain =
    valueAtomic > highWaterMarkAtomic
      ? valueAtomic - highWaterMarkAtomic
      : BigInt(0);
  const fee = (gain * BigInt(feeBps)) / BigInt(10000);
  return {
    gainAtomic: gain.toString(),
    feeAtomic: fee.toString(),
    netGainAtomic: (gain - fee).toString(),
  };
}

export function dailyYieldEstimate(
  positionUsd: number,
  supplyApy: number | null,
  feeBps: number,
) {
  if (
    !Number.isFinite(positionUsd) ||
    positionUsd < 0 ||
    supplyApy === null ||
    !Number.isFinite(supplyApy) ||
    supplyApy < 0 ||
    supplyApy > 10 ||
    !Number.isInteger(feeBps) ||
    feeBps < 0 ||
    feeBps > 4000
  )
    return null;
  const gross = positionUsd * Math.expm1(Math.log1p(supplyApy) / 365);
  const fee = (gross * feeBps) / 10000;
  return { gross, fee, net: gross - fee };
}
