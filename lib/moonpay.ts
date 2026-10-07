import "server-only";

import { createHmac } from "node:crypto";

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

export function getMoonPayCurrencyParam(flow: MoonPayFlow) {
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

export function createWidgetUrl(flow: MoonPayFlow, params: URLSearchParams) {
  const url = new URL(widgetHosts[flow][moonpayConfig.environment]);
  url.search = params.toString();
  return signUrl(url.toString());
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

export async function getTransactionByExternalId(id: string, flow: MoonPayFlow) {
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
