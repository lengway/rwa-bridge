import { KAMINO_LEND_DEVNET as route } from "@/lib/kamino-lend-devnet-config";

export type KaminoWalletSnapshot = {
  walletAddress: string;
  liquidityAmountAtomic: string;
  collateralAmountAtomic: string;
  estimatedUnderlyingAmountAtomic: string;
  solBalanceLamports: string;
};

export function isCanonicalAtomic(value: unknown): value is string {
  return typeof value === "string" && value === value.trim()
    && value.length <= 20 && /^(0|[1-9]\d*)$/.test(value);
}

export function normalizeKaminoWalletSnapshot(value: unknown, expectedWallet: string): KaminoWalletSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.network !== "devnet" || record.walletAddress !== expectedWallet
    || record.mint !== route.liquidityMint || record.collateralMint !== route.collateralMint
    || record.decimals !== route.decimals
    || !isCanonicalAtomic(record.liquidityAmountAtomic)
    || !isCanonicalAtomic(record.collateralAmountAtomic)
    || !isCanonicalAtomic(record.estimatedUnderlyingAmountAtomic)) return null;
  const solBalanceLamports = typeof record.solBalanceLamports === "number"
    && Number.isSafeInteger(record.solBalanceLamports) && record.solBalanceLamports >= 0
    ? record.solBalanceLamports.toString() : record.solBalanceLamports;
  if (!isCanonicalAtomic(solBalanceLamports)) return null;
  return {
    walletAddress: expectedWallet,
    liquidityAmountAtomic: record.liquidityAmountAtomic,
    collateralAmountAtomic: record.collateralAmountAtomic,
    estimatedUnderlyingAmountAtomic: record.estimatedUnderlyingAmountAtomic,
    solBalanceLamports,
  };
}

/** An exact UI limit, not a promise of withdrawal liquidity or a signed quote. */
export function kaminoActionMaximum({ action, cap, reserveLiquidity, wallet }: {
  action: "deposit" | "withdraw";
  cap: string | null;
  reserveLiquidity: string | null;
  wallet: KaminoWalletSnapshot | null;
}): string | null {
  if (!wallet || !isCanonicalAtomic(cap)) return null;
  const balance = action === "deposit" ? wallet.liquidityAmountAtomic : wallet.estimatedUnderlyingAmountAtomic;
  if (!isCanonicalAtomic(balance)) return null;
  const candidates = [BigInt(cap), BigInt(balance)];
  if (action === "withdraw") {
    if (!isCanonicalAtomic(reserveLiquidity)) return null;
    candidates.push(BigInt(reserveLiquidity));
  }
  return candidates.reduce((minimum, value) => value < minimum ? value : minimum).toString();
}
