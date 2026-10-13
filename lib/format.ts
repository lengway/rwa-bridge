import { FALLBACK_KZT_RATE } from "@/lib/constants";

let liveUsdKzt = FALLBACK_KZT_RATE;

export function setFormattedKztRate(rate: number) {
  if (Number.isFinite(rate) && rate > 0) liveUsdKzt = rate;
}

export function formatMoney(usd: number, currency: "USD" | "KZT" = "USD") {
  if (!Number.isFinite(usd)) return "—";
  const value = currency === "KZT" ? usd * liveUsdKzt : usd;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency === "KZT" ? "KZT" : "USD",
    maximumFractionDigits: currency === "KZT" ? 0 : 2,
  }).format(value);
}

export function formatEarningsMoney(usd: number, currency: "USD" | "KZT" = "USD") {
  if (!Number.isFinite(usd)) return "—";
  const smallAmount = Math.abs(usd) < 1;
  const value = currency === "KZT" ? usd * liveUsdKzt : usd;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency === "KZT" ? "KZT" : "USD",
    minimumFractionDigits: smallAmount ? (currency === "USD" ? 4 : 2) : 0,
    maximumFractionDigits: smallAmount ? (currency === "USD" ? 6 : 4) : (currency === "KZT" ? 0 : 2),
  }).format(value);
}

export function formatApy(apy: number) {
  if (!Number.isFinite(apy)) return "—";
  return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 }).format(apy);
}

export function formatQuantity(value: number, maximumFractionDigits = 6) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function formatActivityDay(timestamp: number, now = Date.now()) {
  const today = new Date(now);
  const date = new Date(timestamp);
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (todayKey === dateKey) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  if (yesterdayKey === dateKey) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" }).format(date);
}
