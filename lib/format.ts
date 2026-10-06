import { DEMO_KZT_RATE } from "@/lib/constants";

export function formatMoney(usd: number, currency: "USD" | "KZT" = "USD") {
  const value = currency === "KZT" ? usd * DEMO_KZT_RATE : usd;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency === "KZT" ? "KZT" : "USD",
    maximumFractionDigits: currency === "KZT" ? 0 : 2,
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
