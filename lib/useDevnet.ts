"use client";

import { createContext, useContext } from "react";

export type DevnetStatus = {
  configured: boolean;
  usdMint: string | null;
  assetMint: string | null;
  vaultUsdyMint: string | null;
  vaultKzgbMint: string | null;
  treasury: string | null;
  treasuryOwner: string | null;
};

export type DevnetBalance = { usd: number; assetUnits: number };
export type DevnetPortfolio = {
  positions: Array<{
    productId: string;
    principalUsd: number;
    since: number;
    earnedCarryUsd: number;
    shares: number;
    priceUsd: number;
    valueUsd: number;
    apy?: number;
  }>;
  holdings: Array<{
    kind: "cash" | "vault" | "asset";
    productId?: string;
    assetId?: string;
    name: string;
    ticker: string;
    mint: string;
    tokenAccount: string;
    balance: number;
    priceUsd: number;
    valueUsd: number;
    costUsd?: number;
    pnlUsd?: number;
    mintExplorerUrl: string;
    tokenAccountExplorerUrl: string;
  }>;
  activity: Array<{
    id: string;
    type: "topup" | "invest" | "withdraw" | "buy";
    title: string;
    amountUsd: number;
    at: number;
    signature: string;
    explorerUrl: string;
  }>;
  history: Array<{
    id: string;
    title: string;
    type: "topup" | "invest" | "withdraw" | "buy";
    amountUsd: number;
    at: number;
    signature: string;
    explorerUrl: string;
  }>;
  wallet: {
    address: string;
    solBalance: number;
    explorerUrl: string;
    network: "Solana devnet";
  };
  totalValueUsd: number;
  changeTodayUsd: number;
  cashUsd: number;
  unassignedDepositsUsd: number;
};
export type DevnetState = {
  walletAddress: string | null;
  usdMint: string | null;
  assetMint: string | null;
  vaultUsdyMint: string | null;
  vaultKzgbMint: string | null;
  treasury: string | null;
  treasuryOwner: string | null;
  onchain: DevnetBalance | null;
  portfolio: DevnetPortfolio | null;
  refresh: () => Promise<void>;
  refreshPortfolio: () => Promise<void>;
};

const defaultState: DevnetState = {
  walletAddress: null,
  usdMint: null,
  assetMint: null,
  vaultUsdyMint: null,
  vaultKzgbMint: null,
  treasury: null,
  treasuryOwner: null,
  onchain: null,
  portfolio: null,
  refresh: async () => undefined,
  refreshPortfolio: async () => undefined,
};

export const DevnetContext = createContext<DevnetState>(defaultState);

export function useDevnet() {
  return useContext(DevnetContext);
}
