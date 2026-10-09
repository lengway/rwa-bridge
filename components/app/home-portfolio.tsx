import Link from "next/link";
import { ArrowDownToLine, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BRIDGE_ASSETS } from "@/lib/assets";
import { formatEarningsMoney, formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore, type Holding, type YieldPosition } from "@/lib/store";
import { YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { getStrategyApy } from "@/lib/market-data";
import { MarketDataNote, marketApyLabel } from "@/components/app/market-data-note";

type PositionItem = {
  strategy: YieldStrategy;
  position: YieldPosition;
  earned: number;
};

type HoldingItem = {
  asset: (typeof BRIDGE_ASSETS)[number];
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
        {positions.map((item) => <PositionCard key={item.strategy.id} item={item} currency={currency} />)}
      </div>
    </section>
  );
}

function PositionCard({ item, currency }: { item: PositionItem; currency: "USD" | "KZT" }) {
  const { marketData } = useAppStore();
  const { strategy, position, earned } = item;
  const apyAvailable = strategy.id !== "ondo-usdy" || marketData.availability.usdy;
  const apyData = strategy.id === "ondo-usdy"
    ? marketData.availability.usdy ? marketData.yields.usdy : null
    : marketData.yields.kaseGov;
  const apyLabel = marketApyLabel(getStrategyApy(strategy.id, marketData.yields), apyAvailable);
  return (
    <Card className="gap-0 rounded-2xl p-0 transition-colors hover:bg-muted/40">
      <Link href={`/earn/${strategy.slug}`} className="flex items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <BadgeCheck className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{strategy.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            `${formatQuantity(position.shares ?? 0)} ${strategy.ticker} · ${apyLabel}`
          </span>
        </span>
        <span className="text-right">
          <span className="block font-medium tabular-nums">
            {formatMoney(position.valueUsd ?? position.principal + earned, currency)}
          </span>
          <span className="mt-1 block text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
            +{formatEarningsMoney(earned, currency)}
          </span>
        </span>
      </Link>
      <div className="px-4 pb-3">
        <MarketDataNote data={apyData} plain />
      </div>
    </Card>
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
          <Link key={asset.id} href={`/assets/${asset.slug}`} className="block">
            <Card className="flex-row items-center gap-3 rounded-2xl p-4">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {asset.ticker.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{asset.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatQuantity(holding.units, 0)} {asset.ticker}
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
  const { marketData } = useAppStore();
  const apy = getStrategyApy(strategy.id, marketData.yields);
  const apyAvailable = marketData.availability.usdy;
  const apyData = apyAvailable ? marketData.yields.usdy : null;
  return (
    <Card className="gap-3 rounded-2xl border-emerald-600/20 bg-emerald-500/5 p-5">
      <Link href={`/earn/${strategy.slug}`} className="block space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className={apyAvailable ? "text-emerald-700 dark:text-emerald-300" : "font-normal text-muted-foreground"}>
            {marketApyLabel(apy, apyAvailable)} годовых
          </Badge>
          <ArrowDownToLine className="size-4 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <h2 className="font-semibold">Долларовый вклад</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Цена доли следует доходности USDY, публикуемой Ondo через DefiLlama.
          </p>
        </div>
      </Link>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Не банковский вклад, доход не гарантирован.</p>
        <MarketDataNote data={apyData} plain />
      </div>
    </Card>
  );
}
