"use client";

import {
  CrossmintProvider,
  CrossmintAuthProvider,
  CrossmintWalletProvider,
} from "@crossmint/client-sdk-react-ui";
import { crossmintApiKey, isCrossmintConfigured, walletChain } from "@/lib/config";

export function Providers({ children }: { children: React.ReactNode }) {
  if (!isCrossmintConfigured) {
    // No key yet — render the app without wallet/auth so the rest of the UI
    // (asset cards, onramp button, layout) stays inspectable before keys land.
    return <>{children}</>;
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
          {children}
        </CrossmintWalletProvider>
      </CrossmintAuthProvider>
    </CrossmintProvider>
  );
}
