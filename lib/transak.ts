import "server-only";
import { TRANSAK_STAGING_WIDGET_ORIGIN } from "@/lib/onramps";

const REFRESH_TOKEN_URL = "https://api-stg.transak.com/partners/api/v2/refresh-token";
const CREATE_WIDGET_URL = "https://api-gateway-stg.transak.com/api/v2/auth/session";
const apiKey = process.env.NEXT_PUBLIC_TRANSAK_API_KEY ?? "";
const apiSecret = process.env.TRANSAK_API_SECRET ?? "";

export const transakConfig = {
  apiKeyConfigured: apiKey.length > 0,
  secretConfigured: apiSecret.length > 0,
  configured: apiKey.length > 0 && apiSecret.length > 0,
  environment: "STAGING" as const,
};

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;
let refreshInFlight: Promise<string> | null = null;

export async function getPartnerAccessToken(): Promise<string> {
  if (!transakConfig.apiKeyConfigured || !transakConfig.secretConfigured) {
    throw new Error("Transak staging credentials are not configured");
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const response = await fetch(REFRESH_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-secret": apiSecret,
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apiKey }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Transak staging access token request failed");

    const result = await response.json().catch(() => null) as {
      data?: { accessToken?: unknown; expiresAt?: unknown };
    } | null;
    const accessToken = result?.data?.accessToken;
    const expiresAt = result?.data?.expiresAt;
    if (
      typeof accessToken !== "string"
      || !accessToken
      || typeof expiresAt !== "number"
      || !Number.isFinite(expiresAt)
      || expiresAt * 1000 <= Date.now()
    ) {
      throw new Error("Transak staging returned an invalid access token response");
    }

    cachedToken = { accessToken, expiresAt: expiresAt * 1000 };
    return accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function createWidgetUrl({
  walletAddress,
  fiatAmount,
  fiatCurrency,
  userIp,
  referrerDomain,
}: {
  walletAddress?: string;
  fiatAmount: number;
  fiatCurrency: string;
  userIp: string;
  referrerDomain: string;
}): Promise<string> {
  const accessToken = await getPartnerAccessToken();
  const widgetParams: Record<string, string | number | boolean> = {
    apiKey,
    referrerDomain,
    productsAvailed: "BUY",
    fiatAmount,
    fiatCurrency,
    cryptoCurrencyCode: "USDC",
    network: "solana",
  };

  if (walletAddress) {
    widgetParams.walletAddress = walletAddress;
    widgetParams.disableWalletAddressForm = true;
  }

  const response = await fetch(CREATE_WIDGET_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "x-api-key": apiKey,
      "access-token": accessToken,
      "x-user-ip": userIp,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ widgetParams }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Transak staging widget session request failed");

  const result = await response.json().catch(() => null) as {
    data?: { widgetUrl?: unknown };
  } | null;
  const widgetUrl = result?.data?.widgetUrl;
  if (typeof widgetUrl !== "string") {
    throw new Error("Transak staging returned an invalid widget URL");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(widgetUrl);
  } catch {
    throw new Error("Transak staging returned an invalid widget URL");
  }
  if (parsedUrl.origin !== TRANSAK_STAGING_WIDGET_ORIGIN) {
    throw new Error("Transak returned a non-staging widget URL");
  }
  return parsedUrl.toString();
}
