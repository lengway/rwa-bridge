"use client";

import Link from "next/link";
import { AccountGreeting, BalanceCard } from "@/components/app/home-account";
import { QuickActions } from "@/components/app/home-actions";
import { HoldingsSection, PositionSection, PromoCard } from "@/components/app/home-portfolio";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BRIDGE_ASSETS } from "@/lib/assets";
import { useAppStore } from "@/lib/store";
import { ALL_YIELD_STRATEGIES } from "@/lib/yields";
import { useDevnet } from "@/lib/useDevnet";

export function HomeScreen() {
  const {
    cashUsd,
    positions,
    holdings,
    hydrated,
  } = useAppStore();
  const devnet = useDevnet();
  const displayHydrated = hydrated;
  const positionValues = ALL_YIELD_STRATEGIES.flatMap((strategy) => {
    const position = positions[strategy.id];
    if (!position) return [];
    const earned = position.earnedCarryUsd ?? 0;
    return [{ strategy, position, earned }];
  });
  const holdingValues = BRIDGE_ASSETS.flatMap((asset) => {
    const holding = holdings[asset.id];
    return holding ? [{ asset, holding }] : [];
  });
  const total = devnet.portfolio?.totalValueUsd ?? 0;
  // Illustrative yield is deliberately excluded from all portfolio balances.
  const unrealizedEarnings = 0;
  const portfolioReady = devnet.portfolio !== null;

  return (
    <div className="space-y-7">
      <AccountGreeting />
      <BalanceCard
        total={total}
        cashUsd={cashUsd}
        earnings={unrealizedEarnings}
        hydrated={displayHydrated}
      />
      <QuickActions />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Портфель</h2>
          <Link href="/portfolio" className="text-sm text-muted-foreground hover:text-foreground">Весь портфель →</Link>
        </div>
        {(devnet.portfolio?.unassignedDepositsUsd ?? 0) > 0 ? (
          <Card className="gap-3 rounded-2xl p-4">
            <div>
              <p className="font-medium">
                Найден исторический Devnet-перевод без действия Earn
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Он не будет автоматически зачислен или конвертирован. Обратитесь к оператору Solana Devnet для сверки подписи.
              </p>
            </div>
          </Card>
        ) : null}
        {hydrated && portfolioReady && positionValues.length === 0 && holdingValues.length === 0 ? (
          <Card className="items-center gap-3 rounded-2xl p-5 text-center">
            <p className="font-medium">Пока нет Devnet-позиций</p>
            <p className="text-sm text-muted-foreground">Откройте стратегию Solana Devnet или app test asset, чтобы увидеть портфель.</p>
            <div className="grid w-full grid-cols-2 gap-2 pt-1">
              <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/earn" />}>
                Открыть Solana Devnet
              </Button>
              <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/assets/office-building" />}>
                Открыть test asset
              </Button>
            </div>
          </Card>
        ) : null}
        {!portfolioReady ? <p className="text-sm text-muted-foreground">Загружаем портфель…</p> : null}
        {hydrated && positionValues.length > 0 ? (
          <PositionSection positions={positionValues} />
        ) : null}
        {hydrated && holdingValues.length > 0 ? (
          <HoldingsSection holdings={holdingValues} />
        ) : null}
      </section>
      {hydrated && !positions["kamino-lend"] ? <PromoCard /> : null}
    </div>
  );
}
