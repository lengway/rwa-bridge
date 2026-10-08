"use client";

import { ChevronDown, CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { YieldStrategy } from "@/lib/yields";
import { useDevnet } from "@/lib/useDevnet";
import { useAppStore } from "@/lib/store";
import { formatApy } from "@/lib/format";
import { getStrategyApy } from "@/lib/market-data";
import { MarketDataNote } from "@/components/app/market-data-note";

export function ExplainerSections({ strategy }: { strategy: YieldStrategy }) {
  const devnet = useDevnet();
  const { acceleratedAccrual } = useAppStore();
  const steps = strategy.kind === "demo"
    ? [
        devnet.mode === "devnet"
          ? "Вы отправляете тестовые доллары в казначейство Solana devnet."
          : "Вы выбираете сумму в долларах из демо-баланса.",
        "Приложение показывает условное вложение в тенговый продукт будущего.",
        "Доходность на экране — ориентир индекса, не обещание выплаты. Токена пока нет.",
      ]
    : [
        "Эмитент сообщает, что токен обеспечен краткосрочными гособлигациями США и банковскими депозитами.",
        "По описанию эмитента доход отражается в цене токена.",
        devnet.mode === "devnet"
          ? `Тестовые доллары переводятся в казначейство, а доходность начисляется в приложении${acceleratedAccrual ? " в ускоренном режиме" : " в реальном времени"}.`
          : `В этой демо-версии вклад и начисления симулируются в приложении${acceleratedAccrual ? " в ускоренном режиме" : " в реальном времени"}; реальная покупка не выполняется.`,
      ];

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Как это работает</h2>
        <div className="space-y-2">
          {steps.map((step, index) => (
            <Card key={step} className="flex-row items-start gap-3 rounded-2xl p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {index + 1}
              </span>
              <p className="text-sm leading-5">{step}</p>
            </Card>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Что вы получаете</h2>
        <Card className="gap-3 rounded-2xl p-4">
          <p className="text-sm leading-6">
            {strategy.kind === "live"
              ? devnet.mode === "devnet"
                ? "Тестовое вложение фиксируется переводом долларов в Solana devnet. Расчёт дохода остаётся демонстрационным; токен USDY не покупается."
                : "Цифровой токен, стоимость которого, по описанию эмитента, отражает доход от обеспечивающих активов. В этой демо-версии покупка токена не выполняется: баланс вклада — симуляция."
              : "Демонстрационную запись о вложении в будущий продукт. Токен mKZGB-DEMO не существует и доходность не является предложением купить облигацию."}
          </p>
          <p className="text-xs text-muted-foreground">Эмитент / модель: {strategy.issuer}</p>
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
          <p className="text-sm leading-5">
            {strategy.kind === "demo"
              ? "Высокая ставка в тенге может частично или полностью быть съедена девальвацией к доллару. Сам токен демонстрационный."
              : "Цена, доступность продажи и условия эмитента могут меняться. Возможна потеря части вложений."}
          </p>
          <p className="text-xs text-muted-foreground">
            Не банковский вклад, не застраховано фондом гарантирования депозитов.
          </p>
        </div>
      </Card>
    </section>
  );
}

export function EligibilitySection({ strategy }: { strategy: YieldStrategy }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Кому доступно</h2>
      <Card className="gap-2 rounded-2xl p-4">
        <p className="text-sm leading-5">{strategy.eligibilityLabel}</p>
        {strategy.id === "kz-bond-demo" ? (
          <p className="text-xs text-muted-foreground">
            Это только демонстрация. Мы не представляемся партнёром биржи или государственного органа.
          </p>
        ) : null}
      </Card>
    </section>
  );
}

export function TechnicalDetails({ strategy }: { strategy: YieldStrategy }) {
  const { marketData } = useAppStore();
  const apyData = strategy.id === "ondo-usdy" ? marketData.yields.usdy : marketData.yields.kaseGov;
  const apy = getStrategyApy(strategy.id, marketData.yields);
  return (
    <Collapsible>
      <Card className="rounded-2xl p-0">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left font-medium">
          <span>Технические детали</span>
          <ChevronDown className="size-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t px-4 py-4 text-xs leading-5 text-muted-foreground">
          <p>Тикер: <span className="font-mono text-foreground">{strategy.ticker}</span></p>
          {strategy.mintAddress ? (
            <p className="break-all">
              Адрес токена: <a className="font-mono underline underline-offset-2" href={`https://solscan.io/token/${strategy.mintAddress}`} target="_blank" rel="noreferrer">{strategy.mintAddress}</a>
            </p>
          ) : <p>Адрес токена: токен не существует.</p>}
          {strategy.sourceUrl ? (
            <div className="space-y-1">
              <p>
                Документация эмитента: <a href={strategy.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">адрес токена</a>. APY {formatApy(apy)}.
              </p>
              <MarketDataNote data={apyData} />
            </div>
          ) : (
            <div className="space-y-1">
              <p>Ориентир {formatApy(apy)}. Это демонстрационный показатель, не предложение от биржи или банка.</p>
              <MarketDataNote data={apyData} />
            </div>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function DemoDisclosure() {
  const devnet = useDevnet();
  return (
    <Card className="gap-2 rounded-2xl bg-muted/40 p-4">
      <Badge variant="outline" className="w-fit">Демо</Badge>
      <p className="text-sm leading-5">
        Тенговые облигации в приложении пока не существуют. {devnet.mode === "devnet"
          ? "Тестовый перевод будет сделан в Solana devnet, а запись о вкладе и доход останутся демонстрационными."
          : "Покупка изменит только демо-баланс."}
      </p>
    </Card>
  );
}
