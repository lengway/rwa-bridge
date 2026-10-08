import "server-only";
import {
  FALLBACK_KZT_DATA,
  FALLBACK_YIELD_DATA,
  type DatedMetric,
  type KztRateData,
  type YieldData,
} from "@/lib/market-data";

const RATE_TTL_MS = 6 * 60 * 60 * 1_000;
const USDY_TTL_MS = 6 * 60 * 60 * 1_000;
const TBILL_TTL_MS = 12 * 60 * 60 * 1_000;
const USDY_SOLANA_POOL = "00b83068-9f87-4411-b5d7-5d2ff48c40c4";
const USDY_POOL_CHART_URL = `https://yields.llama.fi/chart/${USDY_SOLANA_POOL}`;

type CacheEntry<T> = { value: T; expiresAt: number };
const caches = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

async function withTtlCache<T>(
  key: string,
  ttlMs: number,
  fallback: T,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = caches.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.value;

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const request = load()
    .then((value) => {
      caches.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch(() => cached ? { ...cached.value, stale: true } : { ...fallback, stale: true })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
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

async function getKztRate() {
  return withTtlCache<KztRateData>("kzt", RATE_TTL_MS, FALLBACK_KZT_DATA, async () => {
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
  });
}

async function getUsdY() {
  return withTtlCache<DatedMetric>("usdy", USDY_TTL_MS, FALLBACK_YIELD_DATA.usdy, async () => {
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
  });
}

function treasuryCsvUrl(year: number) {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
}

async function getTbill3m() {
  const year = new Date().getUTCFullYear();
  const url = treasuryCsvUrl(year);
  const fallback = {
    ...FALLBACK_YIELD_DATA.tbill3m,
    source: { ...FALLBACK_YIELD_DATA.tbill3m.source, url },
  };
  return withTtlCache<DatedMetric>("tbill3m", TBILL_TTL_MS, fallback, async () => {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
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
  });
}

export async function readKztRate() {
  return getKztRate();
}

export async function readYieldData(): Promise<YieldData> {
  const [usdy, tbill3m] = await Promise.all([getUsdY(), getTbill3m()]);
  return {
    usdy,
    tbill3m,
    // No stable machine-readable public KASE endpoint was found, so this benchmark stays dated and manual.
    kaseGov: FALLBACK_YIELD_DATA.kaseGov,
  };
}
