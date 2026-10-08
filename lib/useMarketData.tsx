"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { setFormattedKztRate } from "@/lib/format";
import {
  FALLBACK_KZT_DATA,
  FALLBACK_YIELD_DATA,
  INITIAL_MARKET_DATA,
  type KztRateData,
  type MarketData,
  type MarketDataInitialData,
  type YieldData,
} from "@/lib/market-data";

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RETRY_DELAY_MS = 30 * 1_000;
const MarketDataContext = createContext<MarketData>(INITIAL_MARKET_DATA);

function toMarketData(initialData: MarketDataInitialData | null): MarketData {
  return {
    rate: initialData?.rate ?? FALLBACK_KZT_DATA,
    yields: {
      usdy: initialData?.yields.usdy ?? FALLBACK_YIELD_DATA.usdy,
      tbill3m: initialData?.yields.tbill3m ?? FALLBACK_YIELD_DATA.tbill3m,
      kaseGov: FALLBACK_YIELD_DATA.kaseGov,
    },
    availability: {
      rate: initialData?.rate !== null && initialData?.rate !== undefined,
      usdy: initialData?.yields.usdy !== null && initialData?.yields.usdy !== undefined,
      tbill3m: initialData?.yields.tbill3m !== null && initialData?.yields.tbill3m !== undefined,
    },
  };
}

export function MarketDataProvider({
  children,
  initialData,
}: {
  children: React.ReactNode;
  initialData: MarketDataInitialData | null;
}) {
  const [data, setData] = useState(() => toMarketData(initialData));

  useEffect(() => {
    setFormattedKztRate(data.rate.usdKzt);
  }, [data.rate.usdKzt]);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
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
      const failed = rateResult.status === "rejected" || yieldsResult.status === "rejected";
      setData((current) => {
        const rate = rateResult.status === "fulfilled"
          ? rateResult.value
          : current.availability.rate ? current.rate : FALLBACK_KZT_DATA;
        const yields = yieldsResult.status === "fulfilled"
          ? yieldsResult.value
          : {
              usdy: current.availability.usdy ? current.yields.usdy : FALLBACK_YIELD_DATA.usdy,
              tbill3m: current.availability.tbill3m ? current.yields.tbill3m : FALLBACK_YIELD_DATA.tbill3m,
              kaseGov: FALLBACK_YIELD_DATA.kaseGov,
            };
        return {
          rate,
          yields,
          // A failed client request is the point at which the stale fallback may be shown.
          availability: { rate: true, usdy: true, tbill3m: true },
        };
      });
      if (failed && retryTimer === undefined) {
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          void refresh();
        }, RETRY_DELAY_MS);
      } else if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, []);

  return <MarketDataContext.Provider value={data}>{children}</MarketDataContext.Provider>;
}

export function useMarketData() {
  return useContext(MarketDataContext);
}
