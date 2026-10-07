"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { accrued, YIELD_STRATEGIES } from "@/lib/yields";
import { DEMO_KZT_RATE } from "@/lib/constants";
import { useDevnet } from "@/lib/useDevnet";

export { DEMO_KZT_RATE };
export type ActivityType = "topup" | "invest" | "withdraw" | "buy";
export type YieldPosition = { principal: number; since: number; earnedCarryUsd?: number };
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
  topUp: (amount: number, method: string, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => void;
  invest: (strategyId: string, amount: number, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => boolean;
  withdraw: (strategyId: string, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => number;
  recordCardWithdrawal: (amount: number, extra: { onchain?: boolean; signature?: string; explorerUrl?: string; note: string }) => boolean;
  recordWalletSend: (amount: number, signature: string, explorerUrl: string) => void;
  buy: (assetId: string, amountUsd: number, extra?: {
    units?: number;
    signature?: string;
    explorerUrl?: string;
    title?: string;
    note?: string;
    onchain?: boolean;
  }) => boolean;
  setDisplayCurrency: (currency: "USD" | "KZT") => void;
  resetDemo: () => void;
};

const STORAGE_KEY = "rwa-bridge-demo-v1";
const LEGACY_ASSET_ID = "aifc-mock-iconic-tower";
const CURRENT_ASSET_ID = "demo-office";
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

function migrateAssetReferences(value: unknown): unknown {
  if (value === LEGACY_ASSET_ID) return CURRENT_ASSET_ID;
  if (Array.isArray(value)) return value.map(migrateAssetReferences);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key === LEGACY_ASSET_ID ? CURRENT_ASSET_ID : key,
        migrateAssetReferences(nested),
      ]),
    );
  }
  return value;
}

function mergeMigratedRecords(legacy: unknown, current: unknown): unknown {
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)
    || !current || typeof current !== "object" || Array.isArray(current)) {
    return current;
  }
  const merged = { ...legacy, ...current } as Record<string, unknown>;
  for (const field of ["units", "costUsd", "principal", "earnedCarryUsd"]) {
    const legacyNumber = (legacy as Record<string, unknown>)[field];
    const currentNumber = (current as Record<string, unknown>)[field];
    if (typeof legacyNumber === "number" && typeof currentNumber === "number") {
      merged[field] = legacyNumber + currentNumber;
    }
  }
  const legacySince = (legacy as Record<string, unknown>).since;
  const currentSince = (current as Record<string, unknown>).since;
  if (typeof legacySince === "number" && typeof currentSince === "number") {
    merged.since = Math.min(legacySince, currentSince);
  }
  return merged;
}

function migrateKeyedAssetRecords(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const records = value as Record<string, unknown>;
  const migrated = migrateAssetReferences(records) as Record<string, unknown>;
  if (Object.hasOwn(records, LEGACY_ASSET_ID)) {
    const legacy = migrateAssetReferences(records[LEGACY_ASSET_ID]);
    const current = records[CURRENT_ASSET_ID] === undefined
      ? undefined
      : migrateAssetReferences(records[CURRENT_ASSET_ID]);
    migrated[CURRENT_ASSET_ID] = current === undefined
      ? legacy
      : mergeMigratedRecords(legacy, current);
  }
  return migrated;
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
          const positions = migrateKeyedAssetRecords(saved.positions);
          const holdings = migrateKeyedAssetRecords(saved.holdings);
          const activity = migrateAssetReferences(saved.activity);
          setState({
            cashUsd: typeof saved.cashUsd === "number" ? saved.cashUsd : 0,
            realizedEarningsUsd: typeof saved.realizedEarningsUsd === "number" ? saved.realizedEarningsUsd : 0,
            positions: positions && typeof positions === "object" && !Array.isArray(positions)
              ? positions as Record<string, YieldPosition>
              : {},
            holdings: holdings && typeof holdings === "object" && !Array.isArray(holdings)
              ? holdings as Record<string, Holding>
              : {},
            activity: Array.isArray(activity) ? activity as ActivityItem[] : [],
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

  const topUp = useCallback((amount: number, method: string, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setState((current) => ({
      ...current,
      cashUsd: extra?.onchain ? current.cashUsd : current.cashUsd + amount,
      activity: [makeActivity({
        type: "topup",
        title: method === "devnet-faucet" ? "Тестовый банкомат" : "Пополнение баланса",
        amountUsd: amount,
        method,
        ...(extra?.signature ? { signature: extra.signature } : {}),
        ...(extra?.explorerUrl ? { explorerUrl: extra.explorerUrl } : {}),
      }), ...current.activity],
    }));
  }, []);

  const invest = useCallback((strategyId: string, amount: number, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (!extra?.onchain && state.cashUsd < amount) return false;
    setState((current) => {
      if (!extra?.onchain && current.cashUsd < amount) return current;
      const key = extra?.onchain ? `devnet:${strategyId}` : strategyId;
      const existing = current.positions[key];
      const strategy = YIELD_STRATEGIES.find((item) => item.id === strategyId);
      const previousEarned = existing && strategy
        ? (existing.earnedCarryUsd ?? 0) + accrued(existing.principal, existing.since, strategy.demoApy, Date.now())
        : 0;
      const rolledForward = existing && strategy
        ? existing.principal + accrued(existing.principal, existing.since, strategy.demoApy, Date.now()) + (existing.earnedCarryUsd ?? 0)
        : (existing?.principal ?? 0);
      const realizedEarningsUsd = extra?.onchain
        ? current.realizedEarningsUsd
        : current.realizedEarningsUsd + (
          existing && strategy
            ? accrued(existing.principal, existing.since, strategy.demoApy, Date.now()) + (existing.earnedCarryUsd ?? 0)
            : 0
        );
      const position: YieldPosition = extra?.onchain
        ? { principal: (existing?.principal ?? 0) + amount, since: Date.now(), earnedCarryUsd: previousEarned }
        : { principal: rolledForward + amount, since: Date.now() };
      const title = strategy?.name ?? "Вклад";
      return {
        ...current,
        cashUsd: extra?.onchain ? current.cashUsd : current.cashUsd - amount,
        realizedEarningsUsd,
        positions: { ...current.positions, [key]: position },
        activity: [makeActivity({
          type: "invest",
          title,
          amountUsd: amount,
          ...(extra?.signature ? { signature: extra.signature } : {}),
          ...(extra?.explorerUrl ? { explorerUrl: extra.explorerUrl } : {}),
        }), ...current.activity],
      };
    });
    return true;
  }, [state.cashUsd]);

  const withdraw = useCallback((strategyId: string, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => {
    const key = extra?.onchain ? `devnet:${strategyId}` : strategyId;
    const position = state.positions[key];
    if (!position) return 0;
    const strategy = YIELD_STRATEGIES.find((item) => item.id === strategyId);
    const gain = strategy
      ? (position.earnedCarryUsd ?? 0) + accrued(position.principal, position.since, strategy.demoApy, Date.now())
      : (position.earnedCarryUsd ?? 0);
    const payout = Math.round((position.principal + gain) * 100) / 100;
    setState((current) => {
      if (!current.positions[key]) return current;
      const positions = { ...current.positions };
      delete positions[key];
      return {
        ...current,
        cashUsd: extra?.onchain ? current.cashUsd : current.cashUsd + payout,
        realizedEarningsUsd: current.realizedEarningsUsd + gain,
        positions,
        activity: [makeActivity({
          type: "withdraw",
          title: `Вывод: ${strategy?.name ?? "вклад"}`,
          amountUsd: payout,
          ...(extra?.signature ? { signature: extra.signature } : {}),
          ...(extra?.explorerUrl ? { explorerUrl: extra.explorerUrl } : {}),
        }), ...current.activity],
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
    onchain?: boolean;
  }) => {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return false;
    if (!extra?.onchain && state.cashUsd < amountUsd) return false;
    setState((current) => {
      if (!extra?.onchain && current.cashUsd < amountUsd) return current;
      const existing = current.holdings[assetId] ?? { units: 0, costUsd: 0 };
      return {
        ...current,
        cashUsd: extra?.onchain ? current.cashUsd : current.cashUsd - amountUsd,
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
          ...(extra?.signature ? { signature: extra.signature } : {}),
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

  const recordWalletSend = useCallback((amount: number, signature: string, explorerUrl: string) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setState((current) => ({
      ...current,
      activity: [makeActivity({
        type: "withdraw",
        title: "Отправка на кошелёк",
        amountUsd: amount,
        signature,
        explorerUrl,
      }), ...current.activity],
    }));
  }, []);

  const recordCardWithdrawal = useCallback((amount: number, extra: {
    onchain?: boolean;
    signature?: string;
    explorerUrl?: string;
    note: string;
  }) => {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (!extra.onchain && state.cashUsd < amount) return false;
    setState((current) => {
      if (!extra.onchain && current.cashUsd < amount) return current;
      return {
        ...current,
        cashUsd: extra.onchain ? current.cashUsd : current.cashUsd - amount,
        activity: [makeActivity({
          type: "withdraw",
          title: "Вывод на карту · MoonPay",
          amountUsd: amount,
          method: "moonpay",
          note: extra.note,
          ...(extra.signature ? { signature: extra.signature } : {}),
          ...(extra.explorerUrl ? { explorerUrl: extra.explorerUrl } : {}),
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
    ...state, hydrated, topUp, invest, withdraw, buy, recordCardWithdrawal, recordWalletSend, setDisplayCurrency, resetDemo,
  }), [state, hydrated, topUp, invest, withdraw, buy, recordCardWithdrawal, recordWalletSend, setDisplayCurrency, resetDemo]);

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const context = useContext(AppStoreContext);
  if (!context) throw new Error("useAppStore must be used within an AppStoreProvider");
  const devnet = useDevnet();
  const positions = Object.fromEntries(
    Object.entries(context.positions)
      .filter(([key]) => devnet.mode === "devnet" ? key.startsWith("devnet:") : !key.startsWith("devnet:"))
      .map(([key, position]) => [devnet.mode === "devnet" ? key.slice("devnet:".length) : key, position]),
  );
  return {
    ...context,
    positions,
    cashUsd: devnet.mode === "devnet" ? (devnet.onchain?.usd ?? 0) : context.cashUsd,
  };
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
