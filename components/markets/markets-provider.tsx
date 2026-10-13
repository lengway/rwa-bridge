"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createSimulatedMarketsService } from "@/lib/markets/mock-service";
import type { MarketsService } from "@/lib/markets/service";

/**
 * Supplies the MarketsService to Plain Markets screens. Today it is the simulated ledger;
 * swapping in the program client is a one-line change in `createService`.
 */

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function createService(): MarketsService {
  return createSimulatedMarketsService({ storage: browserStorage(), latencyMs: 420 });
}

let singleton: MarketsService | null = null;
function getService() {
  singleton ??= createService();
  return singleton;
}

const Ctx = createContext<MarketsService | null>(null);

export function MarketsProvider({ children }: { children: ReactNode }) {
  const [service] = useState(getService);
  return <Ctx.Provider value={service}>{children}</Ctx.Provider>;
}

export function useMarkets() {
  const svc = useContext(Ctx);
  if (!svc) throw new Error("useMarkets must be used inside <MarketsProvider>");
  return svc;
}

const versions = new WeakMap<MarketsService, { value: number }>();

/** Increments whenever the ledger reports a change. */
export function useLedgerVersion() {
  const svc = useMarkets();
  if (!versions.has(svc)) versions.set(svc, { value: 0 });
  const box = versions.get(svc)!;
  return useSyncExternalStore(
    (onChange) =>
      svc.subscribe(() => {
        box.value += 1;
        onChange();
      }),
    () => box.value,
    () => 0,
  );
}

export type Query<T> = { data: T | undefined; error: Error | null; loading: boolean };

/**
 * Runs `fn` against the service and re-runs it when `key` changes or the ledger changes.
 * Keeps the previous data while refreshing, so views update in place instead of flashing.
 */
export function useLedgerQuery<T>(key: string | null, fn: (svc: MarketsService) => Promise<T>): Query<T> {
  const svc = useMarkets();
  const version = useLedgerVersion();
  const token = key == null ? null : `${key}#${version}`;
  const [state, setState] = useState<{ token: string | null; key: string | null; data: T | undefined; error: Error | null }>({ token: null, key: null, data: undefined, error: null });

  useEffect(() => {
    if (token == null) return;
    let alive = true;
    fn(svc).then(
      (data) => alive && setState({ token, key, data, error: null }),
      (error: unknown) => alive && setState({ token, key, data: undefined, error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      alive = false;
    };
    // `fn` is re-created every render; `token` captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, svc]);

  const sameKey = state.key === key;
  return { data: sameKey ? state.data : undefined, error: sameKey ? state.error : null, loading: key != null && state.token !== token };
}

/** The ledger's clock (cluster time on chain; the simulated clock otherwise). */
export function useLedgerNow() {
  const svc = useMarkets();
  useLedgerVersion();
  return svc.now();
}
