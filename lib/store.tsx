"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { useMarketData } from "@/lib/useMarketData";
import { useDevnet } from "@/lib/useDevnet";
import type { MarketData } from "@/lib/market-data";

export type ActivityType = "topup" | "invest" | "withdraw" | "buy";
export type YieldPosition = {
  principal: number;
  since: number;
  earnedCarryUsd?: number;
  shares?: number;
  priceUsd?: number;
  valueUsd?: number;
};
export type Holding = { units: number; costUsd: number; signature?: string };
export type ActivityItem = {
  id: string;
  type: ActivityType;
  title: string;
  amountUsd: number;
  at: number;
  method?: string;
  note?: string;
  explorerUrl?: string;
  signature?: string;
};

type AppStore = {
  cashUsd: number;
  positions: Record<string, YieldPosition>;
  holdings: Record<string, Holding>;
  activity: ActivityItem[];
  displayCurrency: "USD" | "KZT";
  marketData: MarketData;
  hydrated: boolean;
  setDisplayCurrency: (currency: "USD" | "KZT") => void;
};

const STORAGE_KEY = "rwa-bridge-preferences";
const AppStoreContext = createContext<AppStore | null>(null);
const preferenceListeners = new Set<() => void>();

function getDisplayCurrencySnapshot(): "USD" | "KZT" {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (JSON.parse(raw) as { displayCurrency?: unknown }).displayCurrency === "KZT") return "KZT";
  } catch {
    // Currency selection falls back to USD when browser storage is unavailable.
  }
  return "USD";
}

function subscribeToDisplayCurrency(listener: () => void) {
  preferenceListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const marketData = useMarketData();
  const devnet = useDevnet();
  const displayCurrency = useSyncExternalStore(
    subscribeToDisplayCurrency,
    getDisplayCurrencySnapshot,
    () => "USD" as const,
  );

  const setDisplayCurrency = useCallback((currency: "USD" | "KZT") => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ displayCurrency: currency }));
    } catch {
      // The preference remains available to subscribed views when storage is unavailable.
    }
    for (const listener of preferenceListeners) listener();
  }, []);

  const positions = useMemo(() => Object.fromEntries(
    (devnet.portfolio?.positions ?? []).map((position) => [position.productId, {
      principal: position.principalUsd,
      since: position.since,
      earnedCarryUsd: position.earnedCarryUsd,
      shares: position.shares,
      priceUsd: position.priceUsd,
      valueUsd: position.valueUsd,
    }]),
  ), [devnet.portfolio?.positions]);

  const holdings = useMemo(() => Object.fromEntries(
    (devnet.portfolio?.holdings ?? [])
      .filter((holding) => holding.kind === "asset")
      .map((holding) => [holding.assetId ?? "office-building", {
        units: holding.balance,
        costUsd: holding.costUsd ?? holding.valueUsd,
      }]),
  ), [devnet.portfolio?.holdings]);

  const value = useMemo<AppStore>(() => ({
    cashUsd: devnet.portfolio?.cashUsd ?? 0,
    positions,
    holdings,
    activity: (devnet.portfolio?.activity ?? []) as ActivityItem[],
    displayCurrency,
    marketData,
    hydrated: devnet.portfolio !== null,
    setDisplayCurrency,
  }), [devnet.portfolio, displayCurrency, holdings, marketData, positions, setDisplayCurrency]);

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const context = useContext(AppStoreContext);
  if (!context) throw new Error("useAppStore must be used within an AppStoreProvider");
  return context;
}

export function useCashBalance() {
  const { cashUsd, hydrated } = useAppStore();
  return { cashUsd, hydrated };
}

export function usePositions() {
  const { positions, holdings, hydrated } = useAppStore();
  return { positions, holdings, hydrated };
}

export function useActivity() {
  const { activity, hydrated } = useAppStore();
  return { activity, hydrated };
}
