"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createBrowserDevnetService, type MarketsPublicConfig } from "@/lib/markets/devnet-service";
import { createSimulatedMarketsService } from "@/lib/markets/mock-service";
import type { MarketsService } from "@/lib/markets/service";

/**
 * Supplies the MarketsService to Plain Markets screens: the real program on devnet when the
 * server is configured with `MARKETS_MODE=devnet`, otherwise the simulated ledger.
 */

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function createService(config: MarketsPublicConfig): MarketsService {
  if (config.mode === "devnet") return createBrowserDevnetService(config);
  return createSimulatedMarketsService({ storage: browserStorage(), latencyMs: 420 });
}

const singletons = new Map<string, MarketsService>();
function getService(config: MarketsPublicConfig) {
  const key = JSON.stringify(config);
  let svc = singletons.get(key);
  if (!svc) {
    svc = createService(config);
    singletons.set(key, svc);
  }
  return svc;
}

const Ctx = createContext<MarketsService | null>(null);

export function MarketsProvider({ config = { mode: "mock" }, children }: { config?: MarketsPublicConfig; children: ReactNode }) {
  const [service] = useState(() => getService(config));
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
  // A stable subscribe function, so React does not resubscribe on every render.
  const subscribe = useCallback(
    (onChange: () => void) =>
      svc.subscribe(() => {
        box.value += 1;
        onChange();
      }),
    [svc, box],
  );
  return useSyncExternalStore(subscribe, () => box.value, () => 0);
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
