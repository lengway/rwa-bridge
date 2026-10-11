import { KAMINO_LEND_DEVNET as route } from "@/lib/kamino-lend-devnet-config";
import { formatAtomicToDecimal } from "@/lib/earn-gateway";
import type { DevnetPortfolio } from "@/lib/useDevnet";

type Position = {
  walletAddress: string;
  collateralAmountAtomic: string;
  liquidityAmountAtomic: string;
  estimatedUnderlyingAmountAtomic: string;
  solBalanceLamports: number;
  liquidityTokenAccount: string;
  collateralTokenAccount: string;
};
type ConfirmedAction = {
  confirmed: true;
  status: "COMPLETED";
  actionId: string;
  action: "deposit" | "withdraw";
  signature: string;
  actualLiquidityAmountAtomic: string;
  createdAt: number;
};
const addressUrl = (value: string) => `https://explorer.solana.com/address/${value}?cluster=devnet`;

// Numbers in this legacy-shaped projection are display-only. All execution,
// balances and persisted receipts retain exact integer strings on the server.
function displayAmount(value: string) {
  if (!/^\d+$/.test(value)) throw new Error("Invalid Kamino balance.");
  const amount = Number(formatAtomicToDecimal(BigInt(value), route.decimals));
  if (!Number.isFinite(amount)) throw new Error("Kamino balance cannot be displayed.");
  return amount;
}

export function buildKaminoPortfolio(position: Position, actions: readonly ConfirmedAction[]): DevnetPortfolio {
  const cash = displayAmount(position.liquidityAmountAtomic);
  const collateral = displayAmount(position.collateralAmountAtomic);
  const underlying = displayAmount(position.estimatedUnderlyingAmountAtomic);
  const holdings: DevnetPortfolio["holdings"] = [];
  const add = (kind: "cash" | "vault", mint: string, tokenAccount: string, balance: number, value: number, ticker: string, name: string) => {
    if (balance <= 0) return;
    holdings.push({ kind, ...(kind === "vault" ? { productId: "kamino-lend" } : {}),
      name, ticker, mint, tokenAccount, balance, priceUsd: value / balance, valueUsd: value,
      mintExplorerUrl: addressUrl(mint), tokenAccountExplorerUrl: addressUrl(tokenAccount) });
  };
  add("cash", route.liquidityMint, position.liquidityTokenAccount, cash, cash, "USDC", "USDC");
  add("vault", route.collateralMint, position.collateralTokenAccount, collateral, underlying, "Kamino cUSDC", "Kamino Lend");
  const history: DevnetPortfolio["history"] = actions.map((action): DevnetPortfolio["history"][number] => ({
    id: action.actionId,
    type: action.action === "deposit" ? "invest" : "withdraw",
    title: action.action === "deposit" ? "Kamino Lend · Deposit confirmed" : "Kamino Lend · Withdrawal confirmed",
    amountUsd: displayAmount(action.actualLiquidityAmountAtomic),
    at: action.createdAt,
    signature: action.signature,
    explorerUrl: `https://explorer.solana.com/tx/${action.signature}?cluster=devnet`,
  })).sort((left, right) => right.at - left.at).slice(0, 20);
  return {
    holdings,
    positions: collateral > 0 ? [{ productId: "kamino-lend", principalUsd: underlying,
      since: history.at(-1)?.at ?? Date.now(), earnedCarryUsd: 0, shares: collateral,
      priceUsd: underlying / collateral, valueUsd: underlying }] : [],
    history, activity: history,
    wallet: { address: position.walletAddress, solBalance: position.solBalanceLamports / 1_000_000_000,
      explorerUrl: addressUrl(position.walletAddress), network: "Solana devnet" },
    totalValueUsd: cash + underlying, changeTodayUsd: 0, cashUsd: cash, unassignedDepositsUsd: 0,
  };
}
