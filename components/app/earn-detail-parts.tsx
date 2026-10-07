import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { formatApy, formatMoney } from "@/lib/format";
import type { YieldStrategy } from "@/lib/yields";
import { useDevnet } from "@/lib/useDevnet";

export function RiskBadge({ strategy }: { strategy: YieldStrategy }) {
  if (strategy.kind === "demo") {
    return <Badge variant="outline">Демо · повышенный риск</Badge>;
  }
  return <Badge variant="secondary">Риск: средний</Badge>;
}

export function ProductSummary({ strategy }: { strategy: YieldStrategy }) {
  const devnet = useDevnet();
  return (
    <section className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge strategy={strategy} />
        {strategy.kind === "demo" ? (
          <Badge variant="outline">Демо-токен</Badge>
        ) : (
          <Badge variant="outline">{devnet.mode === "devnet" ? "Вклад в Solana devnet" : "Покупка в демо-режиме"}</Badge>
        )}
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{strategy.name}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className="text-5xl font-semibold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatApy(strategy.demoApy)}
          </p>
          <p className="text-sm text-muted-foreground">годовых</p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{strategy.apyLabel}</p>
      </div>
      <p className="text-sm leading-6">{strategy.description}</p>
      <p className="rounded-xl border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        Не банковский вклад, не застраховано фондом гарантирования депозитов. Доход не гарантирован.
      </p>
    </section>
  );
}

export function ProjectionCalculator({
  strategy,
  amount,
  onAmountChange,
  currentPosition,
  currency,
}: {
  strategy: YieldStrategy;
  amount: number;
  onAmountChange: (amount: number) => void;
  currentPosition?: { value: number; earned: number };
  currency: "USD" | "KZT";
}) {
  const years = [0, 1, 2, 3, 4, 5];
  const projection = (year: number) => amount * (1 + strategy.demoApy * year);
  const points = years.map((year, index) => {
    const x = 40 + index * 64;
    const y = 124 - ((projection(year) / projection(5)) * 94);
    return `${x},${y}`;
  }).join(" ");

  return (
    <Card className="gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Калькулятор дохода</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Оценка по текущему ориентиру, без учёта комиссий и изменения цены.
          </p>
        </div>
        <Sparkles className="size-5 text-emerald-700 dark:text-emerald-400" />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">Сумма</p>
        <p className="text-lg font-semibold tabular-nums">{formatMoney(amount, currency)}</p>
      </div>
      <Slider
        aria-label="Сумма для расчёта"
        value={[amount]}
        min={100}
        max={10000}
        step={100}
        onValueChange={(value) => {
          const nextValue = Array.isArray(value) ? value[0] : value;
          onAmountChange(Number(nextValue));
        }}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>$100</span>
        <span>$10 000</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ProjectedReturn label="За месяц" amount={amount * strategy.demoApy / 12} currency={currency} />
        <ProjectedReturn label="За год" amount={amount * strategy.demoApy} currency={currency} />
      </div>
      <ProjectionChart amount={amount} projection={projection} points={points} years={years} />
      {currentPosition ? (
        <p className="text-xs text-muted-foreground">
          Сейчас в этом вкладе {formatMoney(currentPosition.value, currency)}, начислено +{formatMoney(currentPosition.earned, currency)}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Расчёт ознакомительный. В демо 1 секунда = 1 день.
        </p>
      )}
    </Card>
  );
}

function ProjectedReturn({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  currency: "USD" | "KZT";
}) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
        +{formatMoney(amount, currency)}
      </p>
    </div>
  );
}

function ProjectionChart({
  amount,
  projection,
  points,
  years,
}: {
  amount: number;
  projection: (year: number) => number;
  points: string;
  years: number[];
}) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <p className="mb-2 text-xs font-medium">Стоимость при неизменном ориентире</p>
      <svg
        viewBox="0 0 400 150"
        className="h-32 w-full"
        role="img"
        aria-label={`Проекция от ${formatMoney(amount)} до ${formatMoney(projection(5))} за пять лет`}
      >
        {[30, 60, 90, 120].map((y) => (
          <line key={y} x1="28" y1={y} x2="390" y2={y} className="stroke-border" strokeWidth="1" />
        ))}
        <polyline
          points={points}
          fill="none"
          className="stroke-emerald-600 dark:stroke-emerald-400"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {years.map((year, index) => {
          const x = 40 + index * 64;
          const y = 124 - ((projection(year) / projection(5)) * 94);
          return (
            <g key={year}>
              <circle cx={x} cy={y} r="3.5" className="fill-emerald-600 dark:fill-emerald-400" />
              <text x={x} y="146" textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                {year} г.
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
