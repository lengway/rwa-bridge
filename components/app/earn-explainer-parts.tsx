"use client";

import { ChevronDown, CircleHelp, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { YieldStrategy } from "@/lib/yields";
import { useAppStore } from "@/lib/store";
import { getStrategyApy } from "@/lib/market-data";
import { MarketDataNote, marketApyLabel } from "@/components/app/market-data-note";

export function ExplainerSections({ strategy }: { strategy: YieldStrategy }) {
  const steps = [
    "Выберите сумму и подпишите перевод с кошелька.",
    `После подтверждения операции доли ${strategy.ticker} поступят на ваш кошелёк.`,
    strategy.description,
  ];

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Как это работает</h2>
        <div className="space-y-2">
          {steps.map((step, index) => (
            <Card key={step} className="flex-row items-start gap-3 rounded-2xl p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span>
              <p className="text-sm leading-5">{step}</p>
            </Card>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Что вы получаете</h2>
        <Card className="gap-3 rounded-2xl p-4">
          <p className="text-sm leading-6">Токены доли {strategy.ticker} отражаются в кошельке и портфеле после подтверждения операции.</p>
          <p className="text-xs text-muted-foreground">Эмитент / ориентир: {strategy.issuer}</p>
        </Card>
      </section>
    </>
  );
}

export function RiskSection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Риски</h2>
      <Card className="flex-row items-start gap-3 rounded-2xl p-4">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-sm leading-5">{strategy.riskLabel}</p>
          <p className="text-sm leading-5">Цена, доступность продажи и условия могут меняться. Возможна потеря части вложений.</p>
          <p className="text-xs text-muted-foreground">Не банковский вклад, не застраховано фондом гарантирования депозитов.</p>
        </div>
      </Card>
    </section>
  );
}

export function EligibilitySection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Кому доступно</h2>
      <Card className="gap-2 rounded-2xl p-4"><p className="text-sm leading-5">{strategy.eligibilityLabel}</p></Card>
    </section>
  );
}

export function TechnicalDetails({ strategy }: { strategy: YieldStrategy }) {
  const { marketData } = useAppStore();
  const apyAvailable = strategy.id !== "ondo-usdy" || marketData.availability.usdy;
  const apyData = strategy.id === "ondo-usdy"
    ? marketData.availability.usdy ? marketData.yields.usdy : null
    : marketData.yields.kaseGov;
  const apy = getStrategyApy(strategy.id, marketData.yields);
  const copyMint = async () => {
    if (!strategy.mintAddress) return;
    try {
      await navigator.clipboard.writeText(strategy.mintAddress);
      toast.success("Адрес токена скопирован");
    } catch {
      toast.error("Не удалось скопировать адрес");
    }
  };

  return (
    <Collapsible>
      <Card className="rounded-2xl p-0">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left font-medium">
          <span>Технические детали</span><ChevronDown className="size-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t px-4 py-4 text-xs leading-5 text-muted-foreground">
          <p>Тикер: <span className="font-mono text-foreground">{strategy.ticker}</span></p>
          {strategy.mintAddress ? (
            <div className="flex flex-wrap items-center gap-1">
              <span>Mint:</span>
              <a className="font-mono underline underline-offset-2" href={`https://solscan.io/token/${strategy.mintAddress}`} target="_blank" rel="noopener noreferrer" title={strategy.mintAddress}>{`${strategy.mintAddress.slice(0, 6)}…${strategy.mintAddress.slice(-5)}`}</a>
              <Button variant="ghost" size="icon" className="ml-1 size-6" aria-label="Скопировать адрес токена" onClick={() => void copyMint()}><Copy /></Button>
            </div>
          ) : <p>Mint доли загружается из настроек продукта.</p>}
          {strategy.sourceUrl ? (
            <div className="space-y-1">
              <p>Документация эмитента: <a href={strategy.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">адрес токена</a>. APY {marketApyLabel(apy, apyAvailable)}.</p>
              <MarketDataNote data={apyData} />
            </div>
          ) : (
            <div className="space-y-1">
              <p>Ориентир доходности: {marketApyLabel(apy, apyAvailable)}. Источник — индекс государственных облигаций KASE.</p>
              <MarketDataNote data={apyData} />
            </div>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
