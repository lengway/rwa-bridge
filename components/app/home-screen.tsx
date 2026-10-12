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
import { SimpleEarnScreen } from "@/components/app/simple-earn-screen";

export function HomeScreen() {
  return <SimpleEarnScreen />;
}

export function HistoricHomeScreen() {
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
        hydrated={displayHydrated && portfolioReady}
        unavailable={!portfolioReady && !!devnet.portfolioError}
      />
      <QuickActions />
      {devnet.portfolio?.legacyUnavailable ? <p role="status" className="text-sm text-muted-foreground">Kamino balances are loaded. Historic test assets could not be loaded and are excluded from this summary; they have not been deleted.</p> : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Portfolio</h2>
          <Link href="/portfolio" className="rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View portfolio →</Link>
        </div>
        {(devnet.portfolio?.unassignedDepositsUsd ?? 0) > 0 ? (
          <Card className="gap-3 rounded-2xl p-4">
            <div>
              <p className="font-medium">
                Historic Devnet transfer found without an Earn action
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                It will not be credited or converted automatically. Contact a Solana Devnet operator to verify the transaction signature.
              </p>
            </div>
          </Card>
        ) : null}
        {hydrated && portfolioReady && positionValues.length === 0 && holdingValues.length === 0 ? (
          <Card className="items-center gap-3 rounded-2xl p-5 text-center">
             <p className="font-medium">Start earning with USDC</p>
             <p className="text-sm text-muted-foreground">Choose an Earn strategy and approve a deposit from your wallet.</p>
             <div className="w-full pt-1">
              <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/earn" />}>
                Explore Earn
              </Button>
            </div>
          </Card>
        ) : null}
        {!portfolioReady && !devnet.portfolioError ? <p role="status" className="text-sm text-muted-foreground">Loading portfolio…</p> : null}
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
