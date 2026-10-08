"use client";

import { createContext, useContext } from "react";

export type DevnetStatus = {
  configured: boolean;
  usdMint: string | null;
  assetMint: string | null;
  treasury: string | null;
  treasuryOwner: string | null;
};

export type DevnetBalance = { usd: number; assetUnits: number };
export type DevnetPortfolio = {
  positions: Array<{ productId: string; principalUsd: number; since: number; earnedCarryUsd: number }>;
  holdings: Array<{ assetId: string; units: number; costUsd: number }>;
  activity: Array<{
    id: string;
    type: "invest" | "withdraw" | "buy";
    title: string;
    amountUsd: number;
    at: number;
    signature: string;
    explorerUrl: string;
  }>;
  unassignedDepositsUsd: number;
};
export type DevnetState = {
  mode: "devnet" | "demo";
  walletAddress: string | null;
  usdMint: string | null;
  treasury: string | null;
  treasuryOwner: string | null;
  onchain: DevnetBalance | null;
  portfolio: DevnetPortfolio | null;
  refresh: () => Promise<void>;
  refreshPortfolio: () => Promise<void>;
};

const defaultState: DevnetState = {
  mode: "demo",
  walletAddress: null,
  usdMint: null,
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
