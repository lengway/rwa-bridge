import { FALLBACK_KZT_RATE } from "@/lib/constants";

let liveUsdKzt = FALLBACK_KZT_RATE;

export function setFormattedKztRate(rate: number) {
  if (Number.isFinite(rate) && rate > 0) liveUsdKzt = rate;
}

export function formatMoney(usd: number, currency: "USD" | "KZT" = "USD") {
  const value = currency === "KZT" ? usd * liveUsdKzt : usd;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency === "KZT" ? "KZT" : "USD",
    maximumFractionDigits: currency === "KZT" ? 0 : 2,
  }).format(value);
}

export function formatEarningsMoney(usd: number, currency: "USD" | "KZT" = "USD") {
  const smallAmount = Math.abs(usd) < 1;
  const value = currency === "KZT" ? usd * liveUsdKzt : usd;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency === "KZT" ? "KZT" : "USD",
    minimumFractionDigits: smallAmount ? (currency === "USD" ? 4 : 2) : 0,
    maximumFractionDigits: smallAmount ? (currency === "USD" ? 6 : 4) : (currency === "KZT" ? 0 : 2),
  }).format(value);
}

export function formatApy(apy: number) {
  return new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 2 }).format(apy);
}

export function formatActivityDay(timestamp: number, now = Date.now()) {
  const today = new Date(now);
  const date = new Date(timestamp);
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (todayKey === dateKey) return "Сегодня";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;
  if (yesterdayKey === dateKey) return "Вчера";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
}
