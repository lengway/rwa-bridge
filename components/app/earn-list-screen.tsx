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

export function EarnList() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Kamino Lend в Solana Devnet.</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Операции строятся для закреплённого Devnet reserve и подписываются подключённым кошельком. Тестовые токены
          и позиции не имеют денежной стоимости.
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
          SOLANA DEVNET · NO MONETARY VALUE. Не банковский вклад, не застраховано фондом гарантирования депозитов.
          Ставка и ликвидность резерва переменны; доход не гарантирован.
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
      <Link href={`/earn/${strategy.slug}`} className="block space-y-4" aria-label={`Открыть сведения о стратегии ${displayStrategyName(strategy)}`}>
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
            <p className="text-xs text-muted-foreground">{hasIllustrativeApy ? "ILLUSTRATIVE YIELD · ориентир" : hasVariableProtocolRate ? "VARIABLE PROTOCOL RATE" : "ставка не задана"}</p>
          </div>
          <RiskBadge strategy={strategy} />
        </div>
        <p className="text-sm text-muted-foreground">{presentDevnetCopy(strategy.description)}</p>
      </Link>
      <div className="space-y-1 border-t pt-3 text-xs leading-5 text-muted-foreground">
        <p>Источник / режим: {presentDevnetCopy(gateway.sourceLabel)}.</p>
        <p>{presentDevnetCopy(gateway.yield.sourceNote)}</p>
        {canInvest ? (
          <p>USER-SIGNED ON-CHAIN: сервер симулирует точную Devnet-транзакцию, а подключённый кошелёк подписывает и отправляет её.</p>
        ) : (
          <p>Новые пополнения сейчас недоступны.</p>
        )}
      </div>
    </Card>
  );
}
