"use client";

import { useEffect, useState } from "react";
import { useDevnet } from "@/lib/useDevnet";

export type EarnOverview = {
  walletAddress: string;
  network: string;
  positionAtomic: string;
  collateralAtomic: string;
  principalAtomic: string | null;
  protocolGainAtomic: string | null;
  supplyApy: number | null;
  dailyEstimate: { gross: number; fee: number; net: number } | null;
  performanceFeeBps: number;
  feeCollectionEnabled: boolean;
};

/**
 * Kamino position, tracked principal and live supply APY for the session
 * wallet. Refetches whenever the devnet portfolio refreshes (after every
 * confirmed deposit or withdrawal) and once a minute.
 */
export function useEarnOverview() {
  const devnet = useDevnet();
  const walletAddress = devnet.walletAddress;
  const [loaded, setLoaded] = useState<{ value: EarnOverview | null; walletAddress: string } | null>(null);
  useEffect(() => {
    if (!walletAddress) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/earn/overview", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        });
        const value = await response.json();
        if (!controller.signal.aborted)
          setLoaded({
            walletAddress: walletAddress!,
            value: response.ok
              && value.walletAddress === walletAddress
              && value.network === "devnet"
              && value.feeCollectionEnabled === false
              ? value
              : null,
          });
      } catch {
        if (!controller.signal.aborted) setLoaded({ walletAddress: walletAddress!, value: null });
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [walletAddress, devnet.portfolio]);
  const current = loaded?.walletAddress === walletAddress ? loaded : null;
  return {
    overview: current?.value ?? null,
    loading: Boolean(walletAddress) && current === null,
  };
}
