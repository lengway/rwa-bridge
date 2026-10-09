import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type MoonPayFlow = "buy" | "sell";
export type MoonPayEnvironment = "sandbox" | "production";

const publishableKey = process.env.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY?.trim() ?? "";
const secretKey = process.env.MOONPAY_SECRET_KEY?.trim() ?? "";

export const moonpayConfig = {
  publishableKey,
  environment: (publishableKey.startsWith("pk_test_") ? "sandbox" : "production") as MoonPayEnvironment,
  configured: Boolean(publishableKey),
  canSign: Boolean(publishableKey && secretKey),
};

export function getMoonPayCurrencyParam(flow: MoonPayFlow = "sell") {
  return {
    name: flow === "buy" ? "currencyCode" : "baseCurrencyCode",
    value: moonpayConfig.environment === "sandbox" ? "sol" : "usdc_sol",
  } as const;
}

export const MOONPAY_MISSING_SECRET_MESSAGE = "Добавьте MOONPAY_SECRET_KEY в .env.local, чтобы подписывать ссылку MoonPay.";

const widgetHosts: Record<MoonPayFlow, Record<MoonPayEnvironment, string>> = {
  buy: {
    sandbox: "https://buy-sandbox.moonpay.com/",
    production: "https://buy.moonpay.com/",
  },
  sell: {
    sandbox: "https://sell-sandbox.moonpay.com/",
    production: "https://sell.moonpay.com/",
  },
};

export function createWidgetUrl(params: URLSearchParams, flow: MoonPayFlow = "sell") {
  const url = new URL(widgetHosts[flow][moonpayConfig.environment]);
  url.search = params.toString();
  return signUrl(url.toString());
}

function normalizeIpv6(address: string) {
  const lower = address.toLowerCase().split("%", 1)[0];
  const ipv4Tail = lower.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  let source = lower;
  if (ipv4Tail) {
    const parts = ipv4Tail.split(".").map(Number);
    if (parts.some((part) => part < 0 || part > 255)) return null;
    const first = ((parts[0] << 8) | parts[1]).toString(16);
    const second = ((parts[2] << 8) | parts[3]).toString(16);
    source = `${lower.slice(0, lower.length - ipv4Tail.length)}${first}:${second}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    return Number.parseInt(group, 16);
  });
  if (groups.length !== 8 || groups.some((group) => group === null)) return null;
  const words = groups as number[];
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`;
  }

  let bestStart = -1;
  let bestLength = 1;
  for (let index = 0; index < words.length;) {
    if (words[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < words.length && words[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const rendered = words.map((word) => word.toString(16));
  if (bestStart < 0) return rendered.join(":");
  const leftPart = rendered.slice(0, bestStart).join(":");
  const rightPart = rendered.slice(bestStart + bestLength).join(":");
  return `${leftPart}::${rightPart}`;
}

export function normalizeMoonPayIp(value: string) {
  let address = value.trim();
  if (address.startsWith("[")) {
    const end = address.indexOf("]");
    if (end < 0) return null;
    address = address.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(address)) {
    address = address.slice(0, address.lastIndexOf(":"));
  }
  address = address.split("%", 1)[0];
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return { address: parts.join("."), family: 4 as const };
  }
  if (family === 6) {
    const normalized = normalizeIpv6(address);
    if (!normalized) return null;
    return isIP(normalized) === 4
      ? { address: normalized, family: 4 as const }
      : { address: normalized, family: 6 as const };
  }
  return null;
}

export function getAllowedIpAddressHash(addresses: string[]) {
  if (!secretKey) return null;
  const unique = new Map<number, string>();
  for (const rawAddress of addresses) {
    const normalized = normalizeMoonPayIp(rawAddress);
    if (normalized && !unique.has(normalized.family)) unique.set(normalized.family, normalized.address);
  }
  if (unique.size === 0) return null;
  return [...unique.values()]
    .map((address) => createHmac("sha256", secretKey).update(address).digest("base64"))
    .join(",");
}

export function signUrl(value: string) {
  if (!secretKey) throw new Error(MOONPAY_MISSING_SECRET_MESSAGE);
  const url = new URL(value);
  // MoonPay signs the URL-encoded query string including its leading question mark.
  const signature = createHmac("sha256", secretKey).update(url.search).digest("base64");
  url.searchParams.append("signature", signature);
  return url.toString();
}

export async function getSandboxSellSolAmount(amountUsd: number): Promise<number | null> {
  if (!publishableKey || moonpayConfig.environment !== "sandbox") return null;

  const url = new URL("/v3/currencies/sol/sell_quote", "https://api.moonpay.com");
  url.searchParams.set("apiKey", publishableKey);
  url.searchParams.set("quoteCurrencyAmount", String(amountUsd));
  url.searchParams.set("quoteCurrencyCode", "usd");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload)) return null;
    const amount = typeof payload.baseCurrencyAmount === "number"
      ? payload.baseCurrencyAmount
      : typeof payload.baseCurrencyAmount === "string"
        ? Number(payload.baseCurrencyAmount)
        : NaN;
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getTransactionByExternalId(id: string, flow: MoonPayFlow = "sell") {
  if (!publishableKey) throw new Error("MoonPay publishable key is not configured.");

  const path = flow === "buy"
    ? `/v1/transactions/ext/${encodeURIComponent(id)}`
    : `/v3/sell_transactions/ext/${encodeURIComponent(id)}`;
  const url = new URL(path, "https://api.moonpay.com");
  url.searchParams.set("apiKey", publishableKey);

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`MoonPay transaction lookup failed (${response.status}).`);

  const payload: unknown = await response.json().catch(() => null);
  const transactions = Array.isArray(payload) ? payload.filter(isRecord) : isRecord(payload) ? [payload] : [];
  const match = transactions.find((transaction) => transaction.externalTransactionId === id);
  return match ?? null;
}

export function isMoonPayExternalId(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function getMoonPayNumericField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return null;
}
