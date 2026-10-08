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
  title: "RWA Bridge",
  description: "Тестовый слой доходности на Solana devnet для банков и финтех-приложений.",
  appleWebApp: {
    capable: true,
    title: "RWA Bridge",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f1f1f",
};

async function getInitialMarketData(): Promise<MarketDataInitialData | null> {
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
      lang="ru"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers initialMarketData={initialMarketData}>{children}</Providers>
      </body>
    </html>
  );
}
