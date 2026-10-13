"use client";

import {
  CrossmintProvider,
  CrossmintWalletProvider,
} from "@crossmint/client-sdk-react-ui";
import { crossmintApiKey, isCrossmintConfigured } from "@/lib/config";
import { AppStoreProvider } from "@/lib/store";
import { MarketDataProvider } from "@/lib/useMarketData";
import { DevnetProvider } from "@/lib/devnet-provider";
import { AuthProvider } from "@/lib/useAuth";
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
    <TooltipProvider>
      <MarketDataProvider initialData={initialMarketData}>
        <AppStoreProvider>
          <BankEmbedProvider>{children}</BankEmbedProvider>
          <Toaster position="top-center" />
        </AppStoreProvider>
      </MarketDataProvider>
    </TooltipProvider>
  );
  if (!isCrossmintConfigured) {
    return <AuthProvider crossmintEnabled={false}><DevnetProvider crossmintEnabled={false}>{app}</DevnetProvider></AuthProvider>;
  }

  return (
    <CrossmintProvider apiKey={crossmintApiKey}>
      {/* The default device signer avoids OTP prompts on normal transactions; losing device storage may still require Crossmint email recovery. */}
      <CrossmintWalletProvider>
        <AuthProvider crossmintEnabled>
          <DevnetProvider crossmintEnabled>{app}</DevnetProvider>
        </AuthProvider>
      </CrossmintWalletProvider>
    </CrossmintProvider>
  );
}
