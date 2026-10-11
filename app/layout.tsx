import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { readCurrentMarketData } from "@/lib/market-server";
import type { MarketDataInitialData } from "@/lib/market-data";

const geist = Geist({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Plain",
  description: "Plain makes Kamino Lend easier to explore with an embedded wallet and verified Solana Devnet transactions. Test funds have no monetary value.",
  appleWebApp: {
    capable: true,
    title: "Plain",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f1f1f",
};

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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Next 16's connection() keeps this process-cache lookup request-time, so build prerenders cannot freeze market data.
  await connection();
  const initialMarketData = await getInitialMarketData();

  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers initialMarketData={initialMarketData}>{children}</Providers>
      </body>
    </html>
  );
}
