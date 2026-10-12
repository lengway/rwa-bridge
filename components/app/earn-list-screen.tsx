"use client";

import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import {
  GatewayDisclosureBadges,
  RiskBadge,
  canInvestInStrategy,
  displayStrategyName,
  displayStrategyTicker,
  getGatewayInfo,
  presentDevnetCopy,
} from "@/components/app/earn-detail-parts";
import { formatApy } from "@/lib/format";
import { SimpleEarnScreen } from "@/components/app/simple-earn-screen";

export function EarnList() {
  return <SimpleEarnScreen />;
}

export function HistoricEarnList() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Put your USDC to work.</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Explore lending strategies. You approve every transaction from your wallet.
        </p>
      </div>
      <div className="space-y-3">
        {YIELD_STRATEGIES.map((strategy) => (
          <YieldCard key={strategy.id} strategy={strategy} />
        ))}
      </div>
      <Card className="flex-row items-start gap-3 rounded-2xl p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-5 text-muted-foreground">
          Not a bank deposit. Reserve liquidity and protocol rates can change;
          returns are not guaranteed.
        </p>
      </Card>
    </div>
  );
}

function YieldCard({ strategy }: { strategy: YieldStrategy }) {
  const gateway = getGatewayInfo(strategy);
  const apyBps = gateway.yield.apyBps;
  const hasIllustrativeApy = gateway.yieldKind === "ILLUSTRATIVE"
    && typeof apyBps === "number"
    && Number.isFinite(apyBps);
  const hasVariableProtocolRate = gateway.yieldKind === "PROTOCOL_VARIABLE";
  const apy = hasIllustrativeApy ? apyBps / 10_000 : Number.NaN;
  const canInvest = canInvestInStrategy(strategy);
  return (
    <Card className="gap-4 rounded-2xl p-5 transition-colors hover:bg-muted/40">
      <Link href={`/earn/${strategy.slug}`} className="block space-y-4" aria-label={`View details for ${displayStrategyName(strategy)}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <h2 className="font-semibold">{displayStrategyName(strategy)}</h2>
            <p className="text-sm text-muted-foreground">
              {displayStrategyTicker(strategy)} · {strategy.issuer}
            </p>
            <GatewayDisclosureBadges strategy={strategy} includeAvailability />
          </div>
          <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className={`font-semibold tracking-tight tabular-nums ${hasIllustrativeApy ? "text-3xl text-emerald-700 dark:text-emerald-400" : hasVariableProtocolRate ? "text-xl text-emerald-700 dark:text-emerald-400" : "text-lg text-muted-foreground"}`}>
              {hasIllustrativeApy ? formatApy(apy) : hasVariableProtocolRate ? "Variable" : "Unavailable"}
            </p>
            <p className="text-xs text-muted-foreground">{hasIllustrativeApy ? "ILLUSTRATIVE YIELD · estimate" : hasVariableProtocolRate ? "VARIABLE PROTOCOL RATE" : "rate unavailable"}</p>
          </div>
          <RiskBadge strategy={strategy} />
        </div>
         <p className="text-sm text-muted-foreground">{strategy.id === "kamino-lend" ? "Supply USDC, receive cUSDC, and withdraw when reserve liquidity is available." : presentDevnetCopy(strategy.description)}</p>
      </Link>
      <div className="space-y-1 border-t pt-3 text-xs leading-5 text-muted-foreground">
        {strategy.id !== "kamino-lend" ? <><p>Source / mode: {presentDevnetCopy(gateway.sourceLabel)}.</p><p>{presentDevnetCopy(gateway.yield.sourceNote)}</p></> : null}
        {canInvest ? (
          <p>Your wallet signs the transaction after a passing simulation.</p>
        ) : (
          <p>New deposits are currently unavailable.</p>
        )}
      </div>
    </Card>
  );
}
