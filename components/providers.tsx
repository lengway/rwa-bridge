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

export function Providers({ children }: { children: React.ReactNode }) {
  const app = (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <DevnetProvider crossmintEnabled={isCrossmintConfigured}>
          <MarketDataProvider>
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
    // No key yet — render the app without wallet/auth so the rest of the UI
    // (asset cards, onramp button, layout) stays inspectable before keys land.
    return app;
  }

  return (
    <CrossmintProvider apiKey={crossmintApiKey}>
      <CrossmintAuthProvider>
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
