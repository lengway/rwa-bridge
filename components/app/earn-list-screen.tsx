"use client";

import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatApy } from "@/lib/format";
import { YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { RiskBadge } from "@/components/app/earn-detail-parts";
import { useDevnet } from "@/lib/useDevnet";
import { useAppStore } from "@/lib/store";
import { getStrategyApy } from "@/lib/market-data";
import { MarketDataNote } from "@/components/app/market-data-note";

export function EarnList() {
  const devnet = useDevnet();
  const { acceleratedAccrual } = useAppStore();
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Вклады с понятными условиями</p>
        <p className="text-xs text-muted-foreground">
          {devnet.mode === "devnet"
            ? "Операции проходят в тестовой сети Solana (devnet). Доход по вкладам рассчитывается в приложении."
            : "Вложения и начисления здесь показаны в демо-режиме."}
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
          Не банковский вклад, не застраховано фондом гарантирования депозитов. Доход не гарантирован. {acceleratedAccrual ? "Ускоренный режим начислений: 1 секунда = 1 день." : "Начисления идут в реальном времени."}
        </p>
      </Card>
    </div>
  );
}

function YieldCard({ strategy }: { strategy: YieldStrategy }) {
  const { marketData } = useAppStore();
  const apy = getStrategyApy(strategy.id, marketData.yields);
  const apyData = strategy.id === "ondo-usdy" ? marketData.yields.usdy : marketData.yields.kaseGov;
  return (
    <Card className="gap-4 rounded-2xl p-5 transition-colors hover:bg-muted/40">
      <Link href={`/earn/${strategy.id}`} className="block space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold">{strategy.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {strategy.ticker} · {strategy.issuer}
            </p>
          </div>
          <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-3xl font-semibold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatApy(apy)}
            </p>
            <p className="text-xs text-muted-foreground">ориентир годовых</p>
          </div>
          <RiskBadge strategy={strategy} />
        </div>
        <p className="text-sm text-muted-foreground">{strategy.description}</p>
      </Link>
      <div className="space-y-1 border-t pt-3">
        <MarketDataNote data={apyData} plain />
      </div>
    </Card>
  );
}
