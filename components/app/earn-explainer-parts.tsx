"use client";

import { CircleHelp, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { canRedeemStrategy, displayGatewayMode, displayStrategyTicker, presentDevnetCopy } from "@/components/app/earn-detail-parts";
import type { YieldStrategy } from "@/lib/yields";

export function ExplainerSections({ strategy }: { strategy: YieldStrategy }) {
  const gateway = strategy.gateway;
  const steps = gateway.provider === "KAMINO"
    ? [
        "Choose an amount of Devnet USDC. Card, KZT, and other fiat payments are not supported.",
        "The server loads the pinned Kamino Lend reserve, checks the route, and simulates the exact transaction before asking for a signature.",
        "Sign and submit the prepared transaction with your connected wallet. Completion is shown only after the Devnet confirmation is verified.",
      ]
    : [
        "New deposits to historic Devnet positions are disabled.",
        "If an exit is available, the connected wallet signs the Devnet transaction.",
        gateway.availability === "REDEMPTION_ONLY"
          ? "This is a historic record: no new deposits are accepted, and any supported exit is limited to Devnet test tokens."
          : `Technical ticker: ${displayStrategyTicker(strategy)}. No numeric rate is stated.`,
      ];

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How it works</h2>
        <div className="space-y-2">
          {steps.map((step, index) => (
            <Card key={step} className="flex-row items-start gap-3 rounded-2xl p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>
              <p className="text-sm leading-5">{step}</p>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

export function RiskSection({ strategy }: { strategy: YieldStrategy }) {
  const isKamino = strategy.gateway.provider === "KAMINO";
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Risks and limits</h2>
      <Card className="flex-row items-start gap-3 rounded-2xl p-4">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-sm leading-5">{presentDevnetCopy(strategy.riskLabel)}</p>
          <p className="text-sm leading-5">
            {isKamino
              ? "Devnet tokens and positions have no monetary value. Reserve liquidity, fees, and the protocol rate can change; withdrawals may depend on reserve conditions. This is not a bank deposit or an offer to invest real funds. Returns are not guaranteed."
              : "Historic Devnet tokens and records have no monetary value. This is not a current provider position, bank deposit, investment product, or offer."}
          </p>
        </div>
      </Card>
    </section>
  );
}

export function EligibilitySection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Availability</h2>
      <Card className="gap-2 rounded-2xl p-4">
        <p className="text-sm leading-5">{presentDevnetCopy(strategy.eligibilityLabel)}</p>
        {strategy.gateway.availabilityReason ? <p className="text-xs text-muted-foreground">{strategy.gateway.availabilityReason}</p> : null}
      </Card>
    </section>
  );
}

export function TechnicalDetails({ strategy }: { strategy: YieldStrategy }) {
  const gateway = strategy.gateway;
  const canRedeem = canRedeemStrategy(strategy);
  const copyMint = async () => {
    if (!strategy.mintAddress) return;
    try {
      await navigator.clipboard.writeText(strategy.mintAddress);
      toast.success("Token address copied");
    } catch {
      toast.error("Could not copy the address");
    }
  };

  return (
    <Card className="rounded-2xl p-0">
      <details className="p-4">
        <summary className="cursor-pointer font-medium">Network, funding, and protocol details</summary>
        <div className="mt-3 space-y-3 border-t pt-4 text-xs leading-5 text-muted-foreground">
          <p>Network: <span className="font-mono text-foreground">Solana Devnet</span></p>
          <p>Mode: <span className="font-mono text-foreground">{displayGatewayMode(gateway.mode)}</span></p>
          <p>Ticker: <span className="font-mono text-foreground">{displayStrategyTicker(strategy)}</span></p>
          {gateway.provider === "KAMINO" ? (
            <p>The app prepares and simulates a transaction for the pinned Kamino Lend Devnet reserve. The connected wallet signs and submits it and pays any network fee. Completion appears after the Devnet confirmation is checked.</p>
          ) : canRedeem ? (
            <p>New deposits are disabled. Historic Devnet positions can only be exited through a user-signed Devnet transaction; this is not a cash payout.</p>
          ) : (
            <p>This entry is for reference only. New deposits are disabled until a compatible Devnet strategy and its terms are confirmed.</p>
          )}
          <p>Source / mode: {presentDevnetCopy(gateway.sourceLabel)}.</p>
          <p>{presentDevnetCopy(gateway.source.statusNote)}</p>
          {strategy.mintAddress ? (
            <div className="flex flex-wrap items-center gap-1">
              <span>Mint:</span>
              <a className="font-mono underline underline-offset-2" href={`https://explorer.solana.com/address/${strategy.mintAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" title={strategy.mintAddress}>{`${strategy.mintAddress.slice(0, 6)}…${strategy.mintAddress.slice(-5)}`}</a>
              <Button variant="ghost" size="icon" className="ml-1 size-6" aria-label="Copy token address" onClick={() => void copyMint()}><Copy /></Button>
            </div>
          ) : <p>The Devnet share mint is available only in a configured Devnet environment.</p>}
          <p>{presentDevnetCopy(gateway.funding.description)}</p>
          <p>{presentDevnetCopy(gateway.payout.description)}</p>
          <p>{presentDevnetCopy(gateway.yield.sourceNote)}</p>
          {gateway.source.referenceUrl ? (
            <p>Reference: <a href={gateway.source.referenceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{presentDevnetCopy(gateway.source.label)}</a>.</p>
          ) : <p>No external protocol or yield is stated for this Devnet strategy.</p>}
          {gateway.disclosures.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4">
              {gateway.disclosures.map((disclosure) => <li key={disclosure.label}>{presentDevnetCopy(disclosure.text)}</li>)}
            </ul>
          ) : null}
        </div>
      </details>
    </Card>
  );
}
