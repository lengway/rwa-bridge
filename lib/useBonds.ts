"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { BondDetail, InvestorOverview } from "@/lib/markets/investor";

/**
 * Client access to the investor routes. One shared entry per URL, so the Bonds tab, Portfolio and
 * Activity read the same `/api/bonds` response; it refreshes every 30 s while something is mounted
 * and right after a purchase.
 */

type Entry<T> = { data: T | null; error: string | null; loading: boolean; at: number };

const REFRESH_MS = 30_000;
const entries = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const EMPTY: Entry<never> = { data: null, error: null, loading: true, at: 0 };

function emit(url: string) {
  for (const l of listeners.get(url) ?? []) l();
}

function load(url: string): Promise<void> {
  const running = inflight.get(url);
  if (running) return running;
  const prev = entries.get(url);
  if (prev) entries.set(url, { ...prev, loading: true });
  const run = (async () => {
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "We couldn't load bond data. Try again.");
      entries.set(url, { data: body, error: null, loading: false, at: Date.now() });
    } catch (error) {
      const old = entries.get(url);
      entries.set(url, { data: old?.data ?? null, error: error instanceof Error ? error.message : "We couldn't load bond data.", loading: false, at: Date.now() });
    } finally {
      inflight.delete(url);
      emit(url);
    }
  })();
  inflight.set(url, run);
  emit(url);
  return run;
}

function useJson<T>(url: string | null) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!url) return () => undefined;
      const set = listeners.get(url) ?? new Set();
      set.add(listener);
      listeners.set(url, set);
      return () => {
        set.delete(listener);
      };
    },
    [url],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (url ? ((entries.get(url) as Entry<T> | undefined) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );

  useEffect(() => {
    if (!url) return;
    const stale = Date.now() - (entries.get(url)?.at ?? 0) > 5_000;
    if (stale) void load(url);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(url);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [url]);

  const refresh = useCallback(() => (url ? load(url) : Promise.resolve()), [url]);
  return { data: entry.data as T | null, error: entry.error, loading: entry.loading, refresh };
}

export const BONDS_URL = "/api/bonds";

export function useBondsOverview() {
  return useJson<InvestorOverview>(BONDS_URL);
}

export function useBondDetail(mint: string) {
  return useJson<BondDetail>(`/api/bonds/${encodeURIComponent(mint)}`);
}

/** Reload every bond view after a change (a purchase). */
export function refreshBonds() {
  return Promise.all([...entries.keys()].filter((u) => u.startsWith(BONDS_URL)).map((u) => load(u)));
}

export const devnetTxUrl = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
