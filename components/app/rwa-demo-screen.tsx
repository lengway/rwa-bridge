"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RwaDemoLauncher } from "@/components/app/rwa-demo-drawer";
import { useDevnet } from "@/lib/useDevnet";

/**
 * A deliberately separate screen: RWA-DEMO must never inherit the real-asset
 * language used by the existing OFFICE flow.
 */
export function RwaDemoScreen() {
  const devnet = useDevnet();

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">DEVNET DEMO</Badge>
          <Badge variant="outline">Solana Devnet</Badge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">RWA-DEMO</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            A direct Meteora DLMM test-token roundtrip — not a real-world asset,
            security, fiat payment, or KZT payout.
          </p>
        </div>
      </section>

      <Card className="gap-2 rounded-2xl border-amber-500/25 bg-amber-500/5 p-4">
        <p className="text-sm font-medium">Demo truth model</p>
        <p className="text-xs leading-5 text-muted-foreground">
          `QUOTE-DEMO` and `RWA-DEMO` have no monetary value. A simulated KZT
          top-up or payout records a demo scenario only; the direct Devnet swap
          is the only trading transaction in this journey.
        </p>
      </Card>

      <Card className="gap-2 rounded-2xl p-4">
        <p className="text-sm font-medium">Connected network</p>
        <p className="text-xs leading-5 text-muted-foreground">
          {devnet.walletAddress
            ? "Your app wallet will be asked to sign any swap after a fresh quote."
            : "Sign in to load the app wallet. The demo will not prepare a transaction without one."}
        </p>
      </Card>

      <RwaDemoLauncher onTradeConfirmed={() => void devnet.refreshPortfolio()} />
    </div>
  );
}
