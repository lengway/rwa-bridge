"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { setFormattedKztRate } from "@/lib/format";
import { INITIAL_MARKET_DATA, type KztRateData, type MarketData, type YieldData } from "@/lib/market-data";

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const MarketDataContext = createContext<MarketData>(INITIAL_MARKET_DATA);

export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(INITIAL_MARKET_DATA);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [rateResult, yieldsResult] = await Promise.allSettled([
        fetch("/api/rates/kzt", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("rate unavailable");
          return response.json() as Promise<KztRateData>;
        }),
        fetch("/api/yields", { cache: "no-store" }).then(async (response) => {
          if (!response.ok) throw new Error("yields unavailable");
          return response.json() as Promise<YieldData>;
        }),
      ]);
      if (!active) return;
      setData((current) => {
        const rate = rateResult.status === "fulfilled" ? rateResult.value : current.rate;
        const yields = yieldsResult.status === "fulfilled" ? yieldsResult.value : current.yields;
        setFormattedKztRate(rate.usdKzt);
        return { rate, yields };
      });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return <MarketDataContext.Provider value={data}>{children}</MarketDataContext.Provider>;
}

export function useMarketData() {
  return useContext(MarketDataContext);
}
