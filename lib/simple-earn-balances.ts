import { KAMINO_LEND_DEVNET } from "@/lib/kamino-lend-devnet-config";
import type { DevnetPortfolio } from "@/lib/useDevnet";

export function simpleEarnBalances(portfolio: DevnetPortfolio | null) {
  if (!portfolio) return null;
  const available = portfolio.holdings.filter((holding) => holding.mint === KAMINO_LEND_DEVNET.liquidityMint)
    .reduce((total, holding) => total + holding.balance, 0);
  const invested = portfolio.positions.filter((position) => position.productId === "kamino-lend")
    .reduce((total, position) => total + position.valueUsd, 0);
  if (![available, invested].every((value) => Number.isFinite(value) && value >= 0)) return null;
  return { available, invested, hasOtherTokens: portfolio.holdings.some((holding) =>
    holding.mint !== KAMINO_LEND_DEVNET.liquidityMint && holding.productId !== "kamino-lend") };
}
