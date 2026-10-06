import Link from "next/link";
import { ArrowDownToLine, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DEMO_ASSETS } from "@/lib/assets";
import { formatApy, formatMoney } from "@/lib/format";
import type { Holding, YieldPosition } from "@/lib/store";
import { YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";

type PositionItem = {
  strategy: YieldStrategy;
  position: YieldPosition;
  earned: number;
};

type HoldingItem = {
  asset: (typeof DEMO_ASSETS)[number];
  holding: Holding;
};

export function PositionSection({
  positions,
  currency,
}: {
  positions: PositionItem[];
  currency: "USD" | "KZT";
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Ваши вклады</h2>
        <Link href="/earn" className="text-sm text-muted-foreground hover:text-foreground">Все</Link>
      </div>
      <div className="space-y-2">
        {positions.map(({ strategy, position, earned }) => (
          <Link key={strategy.id} href={`/earn/${strategy.id}`} className="block">
            <Card className="flex-row items-center gap-3 rounded-2xl p-4 transition-colors hover:bg-muted/40">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <BadgeCheck className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{strategy.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Вложено {formatMoney(position.principal, currency)} · {formatApy(strategy.demoApy)}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-medium tabular-nums">
                  {formatMoney(position.principal + earned, currency)}
                </span>
                <span className="mt-1 block text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{formatMoney(earned, currency)}
                </span>
              </span>
            </Card>
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Демо-начисления ускорены: 1 секунда = 1 день.</p>
    </section>
  );
}

export function HoldingsSection({
  holdings,
  currency,
}: {
  holdings: HoldingItem[];
  currency: "USD" | "KZT";
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Ваши активы</h2>
      <div className="space-y-2">
        {holdings.map(({ asset, holding }) => (
          <Link key={asset.id} href={`/assets/${asset.id}`} className="block">
            <Card className="flex-row items-center gap-3 rounded-2xl p-4">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {asset.ticker.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{asset.name}</span>
                <span className="text-xs text-muted-foreground">
                  {holding.units.toLocaleString("ru-RU")} долей · демо
                </span>
              </span>
              <span className="font-medium tabular-nums">{formatMoney(holding.costUsd, currency)}</span>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function PromoCard() {
  const strategy = YIELD_STRATEGIES[0];
  return (
    <Link href={`/earn/${strategy.id}`} className="block">
      <Card className="gap-3 rounded-2xl border-emerald-600/20 bg-emerald-500/5 p-5">
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-300">
            {formatApy(strategy.demoApy)} годовых
          </Badge>
          <ArrowDownToLine className="size-4 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <h2 className="font-semibold">Долларовый вклад</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Посмотрите, как цифровые доллары (USDC) могут получать доход.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {strategy.apyLabel}. Не банковский вклад, доход не гарантирован.
        </p>
      </Card>
    </Link>
  );
}
