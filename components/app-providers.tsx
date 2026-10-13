import { connection } from "next/server";
import { Providers } from "@/components/providers";
import { readCurrentMarketData } from "@/lib/market-server";
import type { MarketDataInitialData } from "@/lib/market-data";

async function getInitialMarketData(): Promise<MarketDataInitialData | null> {
  // FX and legacy reference yields are not prerequisites for Kamino Earn.
  if (process.env.NEXT_PUBLIC_ENABLE_LEGACY_FIAT_ADAPTERS !== "true") return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readCurrentMarketData(),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), 1_500);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// Wallet, auth and market providers (including the Crossmint SDK) are mounted only
// by app routes, so the public landing page stays static and ships no wallet code.
export async function AppProviders({ children }: { children: React.ReactNode }) {
  // Next 16's connection() keeps this process-cache lookup request-time, so build prerenders cannot freeze market data.
  await connection();
  const initialMarketData = await getInitialMarketData();
  return <Providers initialMarketData={initialMarketData}>{children}</Providers>;
}
