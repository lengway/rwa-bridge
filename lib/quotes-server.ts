import "server-only";
import type { DataSource } from "@/lib/market-data";

export type ProviderQuote = {
  provider: "transak" | "moonpay";
  side: "buy" | "sell";
  amount: number;
  cryptoAmount: number;
  cryptoCode: "USDC" | "SOL";
  fiatAmount: number;
  feeUsd: number;
  asOf: string;
  source: DataSource;
  stale: boolean;
};

type QuoteCache = { value: ProviderQuote; expiresAt: number };
const QUOTE_TTL_MS = 30_000;
const quoteCache = new Map<string, QuoteCache>();
const quoteInFlight = new Map<string, Promise<ProviderQuote>>();

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return NaN;
}

function quoteTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1_000 : value).toISOString();
  }
  return new Date().toISOString();
}

async function fetchTransakQuote(amount: number): Promise<ProviderQuote> {
  const apiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY ?? "";
  if (!apiKey) throw new Error("Transak quote key is not configured");

  const endpoint = "https://api-stg.transak.com/api/v1/pricing/public/quotes";
  const url = new URL(endpoint);
  const params: Record<string, string> = {
    partnerApiKey: apiKey,
    fiatCurrency: "USD",
    cryptoCurrency: "USDC",
    network: "solana",
    isBuyOrSell: "BUY",
    paymentMethod: "credit_debit_card",
  };
  params.fiatAmount = amount.toFixed(2);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { "x-api-key": apiKey, accept: "application/json" },
  });
  if (!response.ok) throw new Error("Transak quote request failed");
  const payload = await response.json() as {
    response?: Record<string, unknown>;
  };
  const quote = payload.response;
  if (!quote) throw new Error("Transak quote response is missing");
  const cryptoAmount = numberValue(quote.cryptoAmount);
  const fiatAmount = numberValue(quote.fiatAmount);
  const feeUsd = numberValue(quote.totalFee);
  if (![cryptoAmount, fiatAmount, feeUsd].every(Number.isFinite) || cryptoAmount <= 0 || feeUsd < 0) {
    throw new Error("Transak quote fields are invalid");
  }

  return {
    provider: "transak",
    side: "buy",
    amount,
    cryptoAmount,
    cryptoCode: "USDC",
    fiatAmount,
    feeUsd,
    asOf: quoteTimestamp(quote.nonce),
    source: { name: "Transak · тестовый режим", url: endpoint },
    stale: false,
  };
}

async function fetchMoonPayQuote(side: "buy" | "sell", amount: number): Promise<ProviderQuote> {
  const apiKey = process.env.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY ?? "";
  if (!apiKey) throw new Error("MoonPay quote key is not configured");

  const currencyCode = apiKey.startsWith("pk_test_") ? "sol" : "usdc_sol";
  const endpoint = `https://api.moonpay.com/v3/currencies/${currencyCode}/${side}_quote`;
  const url = new URL(endpoint);
  url.searchParams.set("apiKey", apiKey);
  if (side === "buy") {
    url.searchParams.set("baseCurrencyAmount", amount.toFixed(2));
    url.searchParams.set("baseCurrencyCode", "usd");
  } else {
    // The withdrawal input is USD. Ask how much provider crypto would be sold for that payout.
    url.searchParams.set("quoteCurrencyAmount", amount.toFixed(2));
    url.searchParams.set("quoteCurrencyCode", "usd");
  }

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("MoonPay quote request failed");
  const quote = await response.json() as Record<string, unknown>;
  const cryptoAmount = side === "buy"
    ? numberValue(quote.quoteCurrencyAmount)
    : numberValue(quote.baseCurrencyAmount);
  const fiatAmount = side === "buy"
    ? numberValue(quote.baseCurrencyAmount)
    : numberValue(quote.quoteCurrencyAmount);
  const feeUsd = [quote.feeAmount, quote.networkFeeAmount, quote.extraFeeAmount]
    .map(numberValue)
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  if (![cryptoAmount, fiatAmount, feeUsd].every(Number.isFinite) || cryptoAmount <= 0 || feeUsd < 0) {
    throw new Error("MoonPay quote fields are invalid");
  }

  return {
    provider: "moonpay",
    side,
    amount,
    cryptoAmount,
    cryptoCode: currencyCode === "sol" ? "SOL" : "USDC",
    fiatAmount,
    feeUsd,
    // MoonPay's quote response has no timestamp field, so this is the quote observation time.
    asOf: new Date().toISOString(),
    source: {
      name: currencyCode === "sol" ? "MoonPay · тестовый SOL" : "MoonPay · USDC в Solana",
      url: endpoint,
    },
    stale: false,
  };
}

export async function readProviderQuote(
  provider: "transak" | "moonpay",
  side: "buy" | "sell",
  amount: number,
) {
  if (provider === "transak" && side !== "buy") {
    throw new Error("Provider flow is not supported");
  }
  const key = `${provider}:${side}:${amount.toFixed(2)}`;
  const now = Date.now();
  const cached = quoteCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const pending = quoteInFlight.get(key);
  if (pending) return pending;

  const load = (provider === "transak" ? fetchTransakQuote(amount) : fetchMoonPayQuote(side, amount))
    .then((value) => {
      quoteCache.set(key, { value, expiresAt: Date.now() + QUOTE_TTL_MS });
      return value;
    })
    .catch(() => {
      if (cached) return { ...cached.value, stale: true };
      throw new Error("Quote unavailable");
    })
    .finally(() => quoteInFlight.delete(key));
  quoteInFlight.set(key, load);
  return load;
}
