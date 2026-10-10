"use client";

import { ChevronDown, CircleHelp, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { YieldStrategy } from "@/lib/yields";

export function ExplainerSections({ strategy }: { strategy: YieldStrategy }) {
  const gateway = strategy.gateway;
  const steps = [
    "SIMULATED FUNDING: выберите сумму тестовых единиц. Банковская карта, KZT-перевод и фиатный платёж не принимаются.",
    "Подпишите перевод тестового токена в Solana Devnet. Сервер продолжит действие только после проверки подтверждённой подписи и суммы в сети.",
    gateway.availability === "REDEMPTION_ONLY"
      ? "Это историческая запись: новые вклады не принимаются, но подтверждённые старые тестовые доли можно погасить по фиксированной Devnet-стоимости."
      : `После подтверждения выпускаются демо-доли ${strategy.ticker} 1:1. ILLUSTRATIVE YIELD не меняет их баланс или цену погашения.`,
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
        <h2 className="text-lg font-semibold">Статус стратегии</h2>
        <Card className="gap-3 rounded-2xl p-4">
          <p className="text-sm leading-6">Источник: {gateway.sourceLabel}.</p>
          <p className="text-sm leading-6">{gateway.source.statusNote}</p>
          <p className="text-xs text-muted-foreground">DEVNET DEMO · {gateway.funding.label} · {gateway.yield.label} · NO MONETARY VALUE</p>
        </Card>
      </section>
    </>
  );
}

export function RiskSection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Ограничения демо</h2>
      <Card className="flex-row items-start gap-3 rounded-2xl p-4">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-sm leading-5">{strategy.riskLabel}</p>
          <p className="text-sm leading-5">Тестовые токены, записи и симулированные выплаты не имеют денежной стоимости. Это не банковский вклад, не инвестиционный продукт и не оффер.</p>
          <p className="text-xs text-muted-foreground">{strategy.gateway.yield.sourceNote}</p>
        </div>
      </Card>
    </section>
  );
}

export function EligibilitySection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Доступность</h2>
      <Card className="gap-2 rounded-2xl p-4">
        <p className="text-sm leading-5">{strategy.eligibilityLabel}</p>
        {strategy.gateway.availabilityReason ? <p className="text-xs text-muted-foreground">{strategy.gateway.availabilityReason}</p> : null}
      </Card>
    </section>
  );
}

export function TechnicalDetails({ strategy }: { strategy: YieldStrategy }) {
  const gateway = strategy.gateway;
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
          <p>Сеть: <span className="font-mono text-foreground">Solana Devnet</span></p>
          <p>Режим: <span className="font-mono text-foreground">{gateway.mode}</span></p>
          <p>Тикер: <span className="font-mono text-foreground">{strategy.ticker}</span></p>
          {strategy.mintAddress ? (
            <div className="flex flex-wrap items-center gap-1">
              <span>Mint:</span>
              <a className="font-mono underline underline-offset-2" href={`https://explorer.solana.com/address/${strategy.mintAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" title={strategy.mintAddress}>{`${strategy.mintAddress.slice(0, 6)}…${strategy.mintAddress.slice(-5)}`}</a>
              <Button variant="ghost" size="icon" className="ml-1 size-6" aria-label="Скопировать адрес токена" onClick={() => void copyMint()}><Copy /></Button>
            </div>
          ) : <p>Mint демо-доли доступен только в настроенном Devnet-окружении.</p>}
          <p>{gateway.funding.description}</p>
          <p>{gateway.payout.description}</p>
          <p>{gateway.yield.sourceNote}</p>
          {gateway.source.referenceUrl ? (
            <p>Справочный источник: <a href={gateway.source.referenceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{gateway.source.label}</a>.</p>
          ) : <p>Внешний протокол или доходность для этой демо-стратегии не заявлены.</p>}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
