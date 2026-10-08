import Link from "next/link";
import { ArrowDownToLine, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DEMO_ASSETS } from "@/lib/assets";
import { formatApy, formatEarningsMoney, formatMoney } from "@/lib/format";
import { useAppStore, type Holding, type YieldPosition } from "@/lib/store";
import { YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { getStrategyApy } from "@/lib/market-data";
import { MarketDataNote } from "@/components/app/market-data-note";
import { useDevnet } from "@/lib/useDevnet";

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
  const { acceleratedAccrual } = useAppStore();
  const devnet = useDevnet();
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Ваши вклады</h2>
        <Link href="/earn" className="text-sm text-muted-foreground hover:text-foreground">Все</Link>
      </div>
      <div className="space-y-2">
        {positions.map((item) => <PositionCard key={item.strategy.id} item={item} currency={currency} />)}
      </div>
      <p className="text-xs text-muted-foreground">
        {devnet.mode === "devnet"
          ? "Стоимость позиции следует цене долей в Solana devnet."
          : acceleratedAccrual ? "Ускоренный режим начислений: 1 секунда = 1 день." : "Начисления идут в реальном времени."}
      </p>
    </section>
  );
}

function PositionCard({ item, currency }: { item: PositionItem; currency: "USD" | "KZT" }) {
  const { acceleratedAccrual, marketData } = useAppStore();
  const devnet = useDevnet();
  const { strategy, position, earned } = item;
  const apyData = strategy.id === "ondo-usdy" ? marketData.yields.usdy : marketData.yields.kaseGov;
  return (
    <Card className="gap-0 rounded-2xl p-0 transition-colors hover:bg-muted/40">
      <Link href={`/earn/${strategy.id}`} className="flex items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <BadgeCheck className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{strategy.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {devnet.mode === "devnet"
              ? `${position.shares?.toLocaleString("ru-RU", { maximumFractionDigits: 6 }) ?? "0"} ${strategy.id === "ondo-usdy" ? "vUSDY-DEMO" : "vKZGB-DEMO"} · ${formatApy(getStrategyApy(strategy.id, marketData.yields))}`
              : `Вложено ${formatMoney(position.principal, currency)} · ${formatApy(getStrategyApy(strategy.id, marketData.yields))}`}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-medium tabular-nums">
            {formatMoney(position.principal + earned, currency)}
          </span>
          <span className="mt-1 block text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
            +{formatEarningsMoney(earned, currency)}
            {devnet.mode === "devnet" ? <span className="ml-1 rounded-full border px-1.5 py-0.5">В сети Solana</span> : acceleratedAccrual ? <span className="ml-1 rounded-full border px-1.5 py-0.5">Ускоренный режим</span> : null}
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
  const devnet = useDevnet();
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
                  {holding.units.toLocaleString("ru-RU")} {devnet.mode === "devnet" ? "OFFICE-DEMO" : "долей · демо"}
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
  const apyData = marketData.yields.usdy;
  return (
    <Card className="gap-3 rounded-2xl border-emerald-600/20 bg-emerald-500/5 p-5">
      <Link href={`/earn/${strategy.id}`} className="block space-y-3">
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-300">
            {formatApy(apy)} годовых
          </Badge>
          <ArrowDownToLine className="size-4 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <h2 className="font-semibold">Долларовый вклад</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Посмотрите, как цифровые доллары (USDC) могут получать доход.
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
