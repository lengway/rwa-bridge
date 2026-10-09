import "server-only";
import {
  FALLBACK_YIELD_DATA,
  type DatedMetric,
  type KztRateData,
  type MarketDataInitialData,
  type YieldData,
} from "@/lib/market-data";

const RATE_TTL_MS = 6 * 60 * 60 * 1_000;
const USDY_TTL_MS = 6 * 60 * 60 * 1_000;
const TBILL_TTL_MS = 12 * 60 * 60 * 1_000;
const REFRESH_RETRY_MS = 30 * 1_000;
const USDY_SOLANA_POOL = "00b83068-9f87-4411-b5d7-5d2ff48c40c4";
const USDY_POOL_CHART_URL = `https://yields.llama.fi/chart/${USDY_SOLANA_POOL}`;

type Cacheable = { stale: boolean };
type CacheEntry<T extends Cacheable> = { value: T; expiresAt: number };
const caches = new Map<string, CacheEntry<Cacheable>>();
const inFlight = new Map<string, Promise<void>>();
const retryAfter = new Map<string, number>();

function cachedValue<T extends Cacheable>(key: string): T | null {
  const entry = caches.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  return { ...entry.value, stale: entry.expiresAt <= Date.now() };
}

function refreshInBackground<T extends Cacheable>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
) {
  if (inFlight.has(key) || (retryAfter.get(key) ?? 0) > Date.now()) return;

  const request = Promise.resolve()
    .then(load)
    .then((value) => {
      caches.set(key, { value, expiresAt: Date.now() + ttlMs });
      retryAfter.delete(key);
    })
    .catch(() => {
      retryAfter.set(key, Date.now() + REFRESH_RETRY_MS);
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
}

function almatyDateParam() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Almaty",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.day}.${value.month}.${value.year}`;
}

function isoFromDmy(value: string) {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

async function loadKztRate(): Promise<KztRateData> {
  const requestedDate = almatyDateParam();
  const url = `https://nationalbank.kz/rss/get_rates.cfm?fdate=${requestedDate}`;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("National Bank rates request failed");
  const xml = await response.text();
  const dataDate = xml.match(/<date>\s*([^<]+)\s*<\/date>/i)?.[1]?.trim();
  const usdItem = xml.match(/<item>\s*(?:(?!<item>)[\s\S])*?<title>\s*USD\s*<\/title>(?:(?!<item>)[\s\S])*?<description>\s*([^<]+)\s*<\/description>(?:(?!<item>)[\s\S])*?<quant>\s*([^<]+)\s*<\/quant>(?:(?!<item>)[\s\S])*?<\/item>/i);
  const amount = usdItem?.[1] ? Number(usdItem[1].trim().replace(",", ".")) : NaN;
  const quantity = usdItem?.[2] ? Number(usdItem[2].trim().replace(",", ".")) : NaN;
  const asOf = dataDate ? isoFromDmy(dataDate) : "";
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(quantity) || quantity <= 0 || !asOf) {
    throw new Error("National Bank rates response format changed");
  }
  return {
    usdKzt: amount / quantity,
    asOf,
    source: { name: "Национальный Банк Республики Казахстан", url },
    stale: false,
  };
}

async function loadUsdY(): Promise<DatedMetric> {
  // The pool UUID was verified from DefiLlama's /pools record for USDY on Solana;
  // its chart endpoint supplies the current APY together with the observation timestamp.
  const response = await fetch(USDY_POOL_CHART_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error("DefiLlama USDY request failed");
  const payload = await response.json() as {
    status?: unknown;
    data?: Array<{ timestamp?: unknown; apy?: unknown }>;
  };
  const observations = Array.isArray(payload.data) ? payload.data : [];
  const latest = observations.at(-1);
  const apy = typeof latest?.apy === "number" ? latest.apy : NaN;
  const timestamp = typeof latest?.timestamp === "string" ? latest.timestamp : "";
  const asOf = timestamp.slice(0, 10);
  if (payload.status !== "success" || !Number.isFinite(apy) || apy < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("DefiLlama USDY response format changed");
  }
  return {
    apy: apy / 100,
    asOf,
    source: { name: "DefiLlama · USDY в Solana", url: USDY_POOL_CHART_URL },
    stale: false,
  };
}

function treasuryCsvUrl(year: number) {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
}

async function loadTbill3m(): Promise<DatedMetric> {
  const year = new Date().getUTCFullYear();
  const url = treasuryCsvUrl(year);
  // This endpoint can take 15+ seconds; it runs only in the background and never holds a page or route response.
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("U.S. Treasury rates request failed");
  const rows = (await response.text()).trim().split(/\r?\n/);
  const header = rows[0]?.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")) ?? [];
  const dateIndex = header.indexOf("Date");
  const rateIndex = header.indexOf("3 Mo");
  if (dateIndex < 0 || rateIndex < 0) throw new Error("U.S. Treasury CSV columns changed");
  for (const row of rows.slice(1)) {
    const cells = row.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const match = cells[dateIndex]?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const rate = Number(cells[rateIndex]);
    if (!match || !Number.isFinite(rate) || rate < 0) continue;
    const asOf = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    return {
      apy: rate / 100,
      asOf,
      source: { name: "U.S. Treasury · кривая доходности", url },
      stale: false,
    };
  }
  throw new Error("U.S. Treasury CSV contains no dated 3-month rate");
}

function cachedYieldMetric(key: "usdy" | "tbill3m") {
  return cachedValue<DatedMetric>(key);
}

/** Returns only values already in this process cache; it never starts an upstream request. */
export async function readCurrentMarketData(): Promise<MarketDataInitialData> {
  return {
    rate: cachedValue<KztRateData>("kzt"),
    yields: {
      usdy: cachedYieldMetric("usdy"),
      tbill3m: cachedYieldMetric("tbill3m"),
    },
  };
}

/** Returns the current rate immediately; an empty or expired cache refreshes in the background. */
export async function readKztRate(): Promise<KztRateData | null> {
  const value = cachedValue<KztRateData>("kzt");
  if (!value || value.stale) refreshInBackground("kzt", RATE_TTL_MS, loadKztRate);
  return value;
}

/** Returns the latest cached NBK rate or refreshes it before an exchange calculation. */
export async function getKztRateForOperation(): Promise<KztRateData> {
  const cached = cachedValue<KztRateData>("kzt");
  if (cached && !cached.stale) return cached;
  try {
    const value = await loadKztRate();
    caches.set("kzt", { value, expiresAt: Date.now() + RATE_TTL_MS });
    retryAfter.delete("kzt");
    return value;
  } catch {
    if (cached) return cached;
    throw new Error("Курс НБ РК временно недоступен.");
  }
}

/** Returns live cached yields immediately; missing Treasury data never delays this response. */
export async function readYieldData(): Promise<YieldData | null> {
  const usdy = cachedYieldMetric("usdy");
  const tbill3m = cachedYieldMetric("tbill3m");
  if (!usdy || usdy.stale) refreshInBackground("usdy", USDY_TTL_MS, loadUsdY);
  if (!tbill3m || tbill3m.stale) refreshInBackground("tbill3m", TBILL_TTL_MS, loadTbill3m);
  if (!usdy || !tbill3m) return null;
  return {
    usdy,
    tbill3m,
    // No stable machine-readable public KASE endpoint was found, so this benchmark stays dated and manual.
    kaseGov: FALLBACK_YIELD_DATA.kaseGov,
  };
}
