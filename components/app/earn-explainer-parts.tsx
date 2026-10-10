"use client";

import { ChevronDown, CircleHelp, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { displayGatewayMode, displayStrategyTicker, presentDevnetCopy } from "@/components/app/earn-detail-parts";
import type { YieldStrategy } from "@/lib/yields";

export function ExplainerSections({ strategy }: { strategy: YieldStrategy }) {
  const gateway = strategy.gateway;
  const steps = gateway.provider === "KAMINO"
    ? [
        "Выберите сумму Devnet USDC. Банковская карта, KZT-перевод и фиатный платёж не принимаются.",
        "Сервер загрузит закреплённый Kamino Lend reserve, проверит состояние маршрута и симулирует точную транзакцию до показа подписи.",
        "Подпишите и отправьте подготовленную транзакцию подключённым кошельком. Статус завершения появится только после проверки Devnet-подтверждения.",
      ]
    : [
        "Новые пополнения для исторической Devnet-позиции отключены.",
        "Если для позиции доступен выход, подключённый кошелёк подписывает Devnet-транзакцию.",
        gateway.availability === "REDEMPTION_ONLY"
          ? "Это историческая запись: новые вклады не принимаются, а поддерживаемый выход остаётся ограничен Devnet-тестовыми токенами."
          : `Технический тикер: ${displayStrategyTicker(strategy)}. Числовая ставка не заявлена.`,
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
          <p className="text-sm leading-6">Источник: {presentDevnetCopy(gateway.sourceLabel)}.</p>
          <p className="text-sm leading-6">{presentDevnetCopy(gateway.source.statusNote)}</p>
          <p className="text-xs text-muted-foreground">SOLANA DEVNET · {presentDevnetCopy(gateway.funding.label)} · {presentDevnetCopy(gateway.yield.label)} · NO MONETARY VALUE</p>
        </Card>
      </section>
    </>
  );
}

export function RiskSection({ strategy }: { strategy: YieldStrategy }) {
  const isKamino = strategy.gateway.provider === "KAMINO";
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Ограничения Solana Devnet</h2>
      <Card className="flex-row items-start gap-3 rounded-2xl p-4">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-2">
          <p className="text-sm leading-5">{presentDevnetCopy(strategy.riskLabel)}</p>
          <p className="text-sm leading-5">
            {isKamino
              ? "Тестовые токены и позиция в Solana Devnet не имеют денежной стоимости. Ликвидность резерва, комиссии и ставка протокола могут меняться. Это не банковский вклад и не предложение вложить реальные средства."
              : "Тестовые токены и записи не имеют денежной стоимости. Это не банковский вклад, не инвестиционный продукт и не оффер."}
          </p>
          <p className="text-xs text-muted-foreground">{presentDevnetCopy(strategy.gateway.yield.sourceNote)}</p>
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
        <p className="text-sm leading-5">{presentDevnetCopy(strategy.eligibilityLabel)}</p>
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
          <p>Режим: <span className="font-mono text-foreground">{displayGatewayMode(gateway.mode)}</span></p>
          <p>Тикер: <span className="font-mono text-foreground">{displayStrategyTicker(strategy)}</span></p>
          {strategy.mintAddress ? (
            <div className="flex flex-wrap items-center gap-1">
              <span>Mint:</span>
              <a className="font-mono underline underline-offset-2" href={`https://explorer.solana.com/address/${strategy.mintAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" title={strategy.mintAddress}>{`${strategy.mintAddress.slice(0, 6)}…${strategy.mintAddress.slice(-5)}`}</a>
              <Button variant="ghost" size="icon" className="ml-1 size-6" aria-label="Скопировать адрес токена" onClick={() => void copyMint()}><Copy /></Button>
            </div>
          ) : <p>Mint Devnet-доли доступен только в настроенном Devnet-окружении.</p>}
          <p>{presentDevnetCopy(gateway.funding.description)}</p>
          <p>{presentDevnetCopy(gateway.payout.description)}</p>
          <p>{presentDevnetCopy(gateway.yield.sourceNote)}</p>
          {gateway.source.referenceUrl ? (
            <p>Справочный источник: <a href={gateway.source.referenceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{presentDevnetCopy(gateway.source.label)}</a>.</p>
          ) : <p>Внешний протокол или доходность для этой Devnet-стратегии не заявлены.</p>}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
