import { FALLBACK_KZT_RATE } from "@/lib/constants";
import { KZ_BOND_DEMO, ONDO_USDY } from "@/lib/yields";

export type DataSource = { name: string; url: string };

export type DatedMetric = {
  apy: number;
  asOf: string;
  source: DataSource;
  stale: boolean;
  manualUpdate?: boolean;
};

export type YieldData = {
  usdy: DatedMetric;
  tbill3m: DatedMetric;
  kaseGov: DatedMetric;
};

export type KztRateData = {
  usdKzt: number;
  asOf: string;
  source: DataSource;
  stale: boolean;
};

export type MarketData = { rate: KztRateData; yields: YieldData };

export const FALLBACK_KZT_DATA: KztRateData = {
  usdKzt: FALLBACK_KZT_RATE,
  asOf: "2026-10-08",
  source: {
    name: "Ориентир приложения (без актуальной котировки)",
    url: "https://nationalbank.kz/rss/get_rates.cfm",
  },
  stale: true,
};

export const FALLBACK_YIELD_DATA: YieldData = {
  usdy: {
    apy: ONDO_USDY.demoApy,
    asOf: "2026-10-02",
    source: {
      name: "Ondo USDY — резервное значение",
      url: "https://ondo.finance/usdy",
    },
    stale: true,
  },
  tbill3m: {
    apy: 0.0422,
    asOf: "2026-10-07",
    source: {
      name: "U.S. Treasury — 3-month rate (CSV)",
      url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026",
    },
    stale: true,
  },
  // KASE's public index page is server-rendered HTML; no stable public JSON/XML feed was found.
  // Keep the last reviewed benchmark and point to the official daily index page for manual updates.
  kaseGov: {
    apy: KZ_BOND_DEMO.demoApy,
    asOf: "2026-10-06",
    source: {
      name: "KASE · индекс доходности KZGB_Ym1m",
      url: "https://kase.kz/en/indexes-and-indicators/gsecs/kzgb-ym1m",
    },
    stale: true,
    manualUpdate: true,
  },
};

export const INITIAL_MARKET_DATA: MarketData = {
  rate: FALLBACK_KZT_DATA,
  yields: FALLBACK_YIELD_DATA,
};

export function getStrategyApy(strategyId: string, yields: YieldData) {
  if (strategyId === "ondo-usdy") return yields.usdy.apy;
  if (strategyId === "kz-bond-demo") return yields.kaseGov.apy;
  return 0;
}

export function formatDataDate(asOf: string) {
  const date = new Date(`${asOf.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return asOf;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
