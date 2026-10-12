"use client";
import type { YieldStrategy } from "@/lib/yields";
import { Card } from "@/components/ui/card";

export function ExplainerSections({ strategy }: { strategy: YieldStrategy }) {
  return (
    <p className="text-sm text-muted-foreground">
      {strategy.id === "kamino-lend"
        ? "Deposit USDC. Track your returns. Withdraw when liquidity is available."
        : "New deposits unavailable."}
    </p>
  );
}
export function RiskSection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <details className="rounded-2xl border p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Withdrawal terms & risks
      </summary>
      <p className="mt-3 leading-6 text-muted-foreground">
        {strategy.id === "kamino-lend"
          ? "Rates vary. Withdrawals depend on available liquidity. Protocol losses are possible."
          : "Withdrawals depend on the available exit route."}
      </p>
    </details>
  );
}
export function EligibilitySection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <p className="text-sm text-muted-foreground">
      {strategy.id === "kamino-lend"
        ? "Deposit USDC from your wallet."
        : "New deposits unavailable."}
    </p>
  );
}
export function TechnicalDetails({ strategy }: { strategy: YieldStrategy }) {
  return (
    <Card className="rounded-2xl p-4">
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          About {strategy.id === "kamino-lend" ? "Kamino" : strategy.name}
        </summary>
        <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          {strategy.sourceUrl ? (
            <a
              href={strategy.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Protocol documentation
            </a>
          ) : null}
          {strategy.mintAddress ? (
            <p>
              <a
                href={`https://explorer.solana.com/address/${strategy.mintAddress}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View token
              </a>
            </p>
          ) : null}
        </div>
      </details>
    </Card>
  );
}
