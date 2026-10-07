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
export type DevnetState = {
  mode: "devnet" | "demo";
  walletAddress: string | null;
  usdMint: string | null;
  treasury: string | null;
  treasuryOwner: string | null;
  onchain: DevnetBalance | null;
  refresh: () => Promise<void>;
};

const defaultState: DevnetState = {
  mode: "demo",
  walletAddress: null,
  usdMint: null,
  treasury: null,
  treasuryOwner: null,
  onchain: null,
  refresh: async () => undefined,
};

export const DevnetContext = createContext<DevnetState>(defaultState);

export function useDevnet() {
  return useContext(DevnetContext);
}
