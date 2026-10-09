"use client";

import {
  CrossmintProvider,
  CrossmintAuthProvider,
  CrossmintWalletProvider,
} from "@crossmint/client-sdk-react-ui";
import { ThemeProvider } from "next-themes";
import { crossmintApiKey, isCrossmintConfigured, walletChain } from "@/lib/config";
import { AppStoreProvider } from "@/lib/store";
import { MarketDataProvider } from "@/lib/useMarketData";
import { DevnetProvider } from "@/lib/devnet-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { BankEmbedProvider } from "@/lib/useBankEmbed";
import type { MarketDataInitialData } from "@/lib/market-data";

export function Providers({
  children,
  initialMarketData,
}: {
  children: React.ReactNode;
  initialMarketData: MarketDataInitialData | null;
}) {
  const app = (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <DevnetProvider crossmintEnabled={isCrossmintConfigured}>
          <MarketDataProvider initialData={initialMarketData}>
            <AppStoreProvider>
              <BankEmbedProvider>{children}</BankEmbedProvider>
              <Toaster position="top-center" />
            </AppStoreProvider>
          </MarketDataProvider>
        </DevnetProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
  if (!isCrossmintConfigured) {
    // The gated shell still renders its email sign-in screen when auth is not configured.
    return app;
  }

  return (
    <CrossmintProvider apiKey={crossmintApiKey}>
      <CrossmintAuthProvider loginMethods={["email"]}>
        <CrossmintWalletProvider
          createOnLogin={{
            chain: walletChain,
            recoveryMethods: [{ type: "email" }],
          }}
        >
          {app}
        </CrossmintWalletProvider>
      </CrossmintAuthProvider>
    </CrossmintProvider>
  );
}
