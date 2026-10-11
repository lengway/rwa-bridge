import Link from "next/link";
import { ArrowDownToLine, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { displayStrategyName, displayStrategyTicker, presentDevnetCopy } from "@/components/app/earn-detail-parts";
import { Card } from "@/components/ui/card";
import { BRIDGE_ASSETS } from "@/lib/assets";
import { formatQuantity } from "@/lib/format";
import { type Holding, type YieldPosition } from "@/lib/store";
import { YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";

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
}: {
  positions: PositionItem[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Your positions</h2>
        <Link href="/earn" className="rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">All strategies</Link>
      </div>
      <div className="space-y-2">
        {positions.map((item) => <PositionCard key={item.strategy.id} item={item} />)}
      </div>
    </section>
  );
}

function PositionCard({ item }: { item: PositionItem }) {
  const { strategy, position, earned } = item;
  return (
    <Card className="gap-0 rounded-2xl p-0 transition-colors hover:bg-muted/40">
      <Link href={`/earn/${strategy.slug}`} className="flex items-center gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <BadgeCheck className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{displayStrategyName(strategy)}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {formatQuantity(position.shares ?? 0)} {strategy.id === "kamino-lend" ? "cUSDC" : displayStrategyTicker(strategy)} · {strategy.id === "kamino-lend" ? "Lending position" : presentDevnetCopy(strategy.gateway.yield.label)}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-medium tabular-nums">
             {formatQuantity(position.valueUsd ?? position.principal)} {strategy.id === "kamino-lend" ? "USDC" : "TEST QUOTE"}
          </span>
          <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
             Estimated value
          </span>
        </span>
      </Link>
      <p className="px-4 pb-3 text-xs text-muted-foreground">
        {strategy.id === "kamino-lend" ? "Withdrawals depend on reserve liquidity." : presentDevnetCopy(strategy.gateway.yield.sourceNote)} {earned !== 0 ? "Historic display carry is excluded from this balance." : ""}
      </p>
    </Card>
  );
}

export function HoldingsSection({
  holdings,
}: {
  holdings: HoldingItem[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Your assets</h2>
      <div className="space-y-2">
        {holdings.map(({ asset, holding }) => (
          <Link key={asset.id} href={`/assets/${asset.slug}`} className="block">
            <Card className="flex-row items-center gap-3 rounded-2xl p-4">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                {asset.ticker.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">OFFICE · app test token</span>
                <span className="text-xs text-muted-foreground">
                  {formatQuantity(holding.units, 0)} {asset.ticker}
                </span>
              </span>
              <span className="font-medium tabular-nums">{formatQuantity(holding.costUsd)} TEST QUOTE</span>
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
    <Card className="gap-3 rounded-2xl border-emerald-600/20 bg-emerald-500/5 p-5">
      <Link href={`/earn/${strategy.slug}`} className="block space-y-3">
        <div className="flex items-center justify-between">
           <Badge variant="secondary" className="font-normal text-emerald-700 dark:text-emerald-300">Earn with USDC</Badge>
          <ArrowDownToLine className="size-4 text-emerald-700 dark:text-emerald-300" />
        </div>
        <div>
          <h2 className="font-semibold">{displayStrategyName(strategy)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Supply USDC to a lending reserve. Your wallet stays in control of every deposit and withdrawal.
          </p>
        </div>
      </Link>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>Variable rate · Withdrawals depend on liquidity.</p>
      </div>
    </Card>
  );
}
