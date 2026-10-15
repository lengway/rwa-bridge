import "server-only";

import { getKaminoLendDevnetHistory } from "./kamino-lend-devnet";
import { getConfirmedSmartWalletHistory } from "./kamino-smart-wallet-executor";

export type KaminoReceipt = {
  signature: string;
  action: "deposit" | "withdraw";
  actualLiquidityAmountAtomic: string;
  actualCollateralAmountAtomic: string;
  createdAt: number;
};

/**
 * Finalized Kamino receipts for a wallet from both execution paths: directly
 * signed transactions and Crossmint smart-wallet operations. Read-only.
 */
export async function getKaminoReceipts(walletAddress: string): Promise<KaminoReceipt[]> {
  const [direct, smartWallet] = await Promise.all([
    getKaminoLendDevnetHistory(walletAddress),
    getConfirmedSmartWalletHistory(walletAddress),
  ]);
  const smartWalletReceipts = smartWallet.flatMap((record): KaminoReceipt[] =>
    record.action === "initialize" ? [] : [{
      signature: record.signature,
      action: record.action,
      // A missing amount fails the digit check downstream and yields "unknown".
      actualLiquidityAmountAtomic: record.actualLiquidityAmountAtomic ?? "",
      actualCollateralAmountAtomic: record.actualCollateralAmountAtomic ?? "",
      createdAt: record.createdAt,
    }]);
  return [...direct, ...smartWalletReceipts].sort((left, right) => left.createdAt - right.createdAt);
}
