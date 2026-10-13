"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { RwaDemoLauncher } from "@/components/app/rwa-demo-drawer";
import { useDevnet } from "@/lib/useDevnet";

/** A separate Devnet asset route with explicit no-value boundaries. */
export function RwaDemoScreen() {
  const devnet = useDevnet();

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">SOLANA DEVNET</Badge>
          <Badge variant="outline">DEVNET TEST UNITS</Badge>
          <Badge variant="outline">NO MONETARY VALUE</Badge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            RWA · Solana Devnet
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            A digital Devnet share. Choose an amount, review the terms and
            confirm the operation in your wallet.
          </p>
        </div>
      </section>

      <Card className="gap-3 rounded-2xl p-4">
        <p className="text-sm font-medium">How it works</p>
        <ol className="grid gap-3 text-xs leading-5 text-muted-foreground sm:grid-cols-3">
          <li>
            <span className="font-medium text-foreground">1. Choose an amount.</span>{" "}
            Enter how much of the test settlement token to use for the purchase.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Review the terms.</span>{" "}
            You&apos;ll see the exact result before confirming.
          </li>
          <li>
            <span className="font-medium text-foreground">3. Confirm.</span>{" "}
            Your wallet will ask you to confirm the Solana Devnet operation.
          </li>
        </ol>
      </Card>

      <p className="text-center text-xs leading-5 text-muted-foreground">
        {devnet.walletAddress
          ? "SOLANA DEVNET: this operation uses a test settlement token and creates no rights to a real asset or cash payout."
          : "Sign in to continue in the Solana Devnet environment."}
      </p>

      <RwaDemoLauncher onTradeConfirmed={() => void devnet.refreshPortfolio()} />
    </div>
  );
}
