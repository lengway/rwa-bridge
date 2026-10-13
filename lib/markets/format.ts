/** Display helpers for Plain Markets. Dates are shown in UTC, like a settlement calendar. */

const groups = new Intl.NumberFormat("en-US");

/** Settlement base units → "$50,000.00" (keeps sub-cent digits when present). */
export function formatSettlement(value: bigint, decimals = 6, symbol = "USD") {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = abs / scale;
  let frac = (abs % scale).toString().padStart(decimals, "0");
  frac = frac.replace(/0+$/, "").padEnd(2, "0");
  const prefix = /USD/i.test(symbol) ? "$" : "";
  const suffix = prefix ? "" : ` ${symbol}`;
  return `${negative ? "−" : ""}${prefix}${groups.format(whole)}.${frac}${suffix}`;
}

/** Plain decimal string for CSV (no grouping, no symbol). */
export function settlementDecimal(value: bigint, decimals = 6) {
  const scale = BigInt(10) ** BigInt(decimals);
  const sign = value < BigInt(0) ? "-" : "";
  const abs = value < BigInt(0) ? -value : value;
  return `${sign}${abs / scale}.${(abs % scale).toString().padStart(decimals, "0")}`;
}

export function formatUnits(value: bigint) {
  return groups.format(value);
}

export function formatBps(bps: number) {
  return `${(bps / 100).toLocaleString("en-US", { minimumFractionDigits: bps % 100 ? 2 : 0, maximumFractionDigits: 2 })}%`;
}

export function formatShare(part: bigint, whole: bigint) {
  if (whole === BigInt(0)) return "0%";
  const bp = Number((part * BigInt(1_000_000)) / whole) / 10_000;
  return `${bp.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export function formatDate(ts: number) {
  return dateFmt.format(new Date(ts * 1000));
}

export function formatDateTime(ts: number) {
  return `${dateTimeFmt.format(new Date(ts * 1000))} UTC`;
}

export function isoDate(ts: number) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/** "in 2 days", "3 hours ago" relative to `now` (both unix seconds). */
export function formatRelative(ts: number, now: number) {
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86_400 * 60) return rtf.format(Math.round(diff / 86_400), "day");
  return rtf.format(Math.round(diff / (86_400 * 30)), "month");
}

export function shortAddress(address: string, size = 4) {
  return address.length <= size * 2 + 1 ? address : `${address.slice(0, size)}…${address.slice(-size)}`;
}
