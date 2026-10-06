"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { accrued, YIELD_STRATEGIES } from "@/lib/yields";
import { DEMO_KZT_RATE } from "@/lib/constants";

export { DEMO_KZT_RATE };
export type ActivityType = "topup" | "invest" | "withdraw" | "buy";
export type YieldPosition = { principal: number; since: number };
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
};

type PersistedState = {
  cashUsd: number;
  realizedEarningsUsd: number;
  positions: Record<string, YieldPosition>;
  holdings: Record<string, Holding>;
  activity: ActivityItem[];
  displayCurrency: "USD" | "KZT";
};

type AppStore = PersistedState & {
  hydrated: boolean;
  topUp: (amount: number, method: string) => void;
  invest: (strategyId: string, amount: number) => boolean;
  withdraw: (strategyId: string) => number;
  buy: (assetId: string, amountUsd: number, extra?: {
    units?: number;
    signature?: string;
    explorerUrl?: string;
    title?: string;
    note?: string;
  }) => boolean;
  setDisplayCurrency: (currency: "USD" | "KZT") => void;
  resetDemo: () => void;
};

const STORAGE_KEY = "rwa-bridge-demo-v1";
const initialState: PersistedState = {
  cashUsd: 0,
  realizedEarningsUsd: 0,
  positions: {},
  holdings: {},
  activity: [],
  displayCurrency: "USD",
};

const AppStoreContext = createContext<AppStore | null>(null);

function makeActivity(item: Omit<ActivityItem, "id" | "at">): ActivityItem {
  return { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<PersistedState>;
          setState({
            cashUsd: typeof saved.cashUsd === "number" ? saved.cashUsd : 0,
            realizedEarningsUsd: typeof saved.realizedEarningsUsd === "number" ? saved.realizedEarningsUsd : 0,
            positions: saved.positions && typeof saved.positions === "object" ? saved.positions : {},
            holdings: saved.holdings && typeof saved.holdings === "object" ? saved.holdings : {},
            activity: Array.isArray(saved.activity) ? saved.activity : [],
            displayCurrency: saved.displayCurrency === "KZT" ? "KZT" : "USD",
          });
        }
      } catch {
        // Storage can be disabled or contain invalid demo data. Start with an empty portfolio.
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Keep the in-memory demo usable when browser storage is unavailable.
    }
  }, [hydrated, state]);

  const topUp = useCallback((amount: number, method: string) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setState((current) => ({
      ...current,
      cashUsd: current.cashUsd + amount,
      activity: [makeActivity({ type: "topup", title: "Пополнение баланса", amountUsd: amount, method }), ...current.activity],
    }));
  }, []);

  const invest = useCallback((strategyId: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (state.cashUsd < amount) return false;
    setState((current) => {
      if (current.cashUsd < amount) return current;
      const existing = current.positions[strategyId];
      const strategy = YIELD_STRATEGIES.find((item) => item.id === strategyId);
      const rolledForward = existing && strategy
        ? existing.principal + accrued(existing.principal, existing.since, strategy.demoApy, Date.now())
        : (existing?.principal ?? 0);
      const realizedEarningsUsd = current.realizedEarningsUsd + (
        existing && strategy
          ? accrued(existing.principal, existing.since, strategy.demoApy, Date.now())
          : 0
      );
      const position = { principal: rolledForward + amount, since: Date.now() };
      const title = strategy?.name ?? "Вклад";
      return {
        ...current,
        cashUsd: current.cashUsd - amount,
        realizedEarningsUsd,
        positions: { ...current.positions, [strategyId]: position },
        activity: [makeActivity({ type: "invest", title, amountUsd: amount }), ...current.activity],
      };
    });
    return true;
  }, [state.cashUsd]);

  const withdraw = useCallback((strategyId: string) => {
    const position = state.positions[strategyId];
    if (!position) return 0;
    const strategy = YIELD_STRATEGIES.find((item) => item.id === strategyId);
    const gain = strategy ? accrued(position.principal, position.since, strategy.demoApy, Date.now()) : 0;
    const payout = Math.round((position.principal + gain) * 100) / 100;
    setState((current) => {
      if (!current.positions[strategyId]) return current;
      const positions = { ...current.positions };
      delete positions[strategyId];
      return {
        ...current,
        cashUsd: current.cashUsd + payout,
        realizedEarningsUsd: current.realizedEarningsUsd + gain,
        positions,
        activity: [makeActivity({ type: "withdraw", title: `Вывод: ${strategy?.name ?? "вклад"}`, amountUsd: payout }), ...current.activity],
      };
    });
    return payout;
  }, [state.positions]);

  const buy = useCallback((assetId: string, amountUsd: number, extra?: {
    units?: number;
    signature?: string;
    explorerUrl?: string;
    title?: string;
    note?: string;
  }) => {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return false;
    if (state.cashUsd < amountUsd) return false;
    setState((current) => {
      if (current.cashUsd < amountUsd) return current;
      const existing = current.holdings[assetId] ?? { units: 0, costUsd: 0 };
      return {
        ...current,
        cashUsd: current.cashUsd - amountUsd,
        holdings: {
          ...current.holdings,
          [assetId]: {
            units: existing.units + (extra?.units ?? amountUsd),
            costUsd: existing.costUsd + amountUsd,
            ...(extra?.signature ? { signature: extra.signature } : {}),
          },
        },
        activity: [makeActivity({
          type: "buy",
          title: extra?.title ?? "Покупка доли",
          amountUsd,
          ...(extra?.explorerUrl ? { explorerUrl: extra.explorerUrl } : {}),
          ...(extra?.note
            ? { note: extra.note }
            : !extra?.signature
              ? { note: "Демо: перевод не отправлен" }
              : {}),
        }), ...current.activity],
      };
    });
    return true;
  }, [state.cashUsd]);

  const setDisplayCurrency = useCallback((displayCurrency: "USD" | "KZT") => {
    setState((current) => ({ ...current, displayCurrency }));
  }, []);

  const resetDemo = useCallback(() => setState(initialState), []);

  const value = useMemo<AppStore>(() => ({
    ...state, hydrated, topUp, invest, withdraw, buy, setDisplayCurrency, resetDemo,
  }), [state, hydrated, topUp, invest, withdraw, buy, setDisplayCurrency, resetDemo]);

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
