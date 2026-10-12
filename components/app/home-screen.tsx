"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AccountGreeting, BalanceCard } from "@/components/app/home-account";
import {
  HoldingsSection,
  PositionSection,
} from "@/components/app/home-portfolio";
import { Card } from "@/components/ui/card";
import { BRIDGE_ASSETS } from "@/lib/assets";
import { useAppStore } from "@/lib/store";
import { ALL_YIELD_STRATEGIES } from "@/lib/yields";
import { useDevnet } from "@/lib/useDevnet";
import { EarnJourney } from "@/components/app/earn-journey";

export function HomeScreen() {
  const { cashUsd, positions, holdings, hydrated } = useAppStore();
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
      <div className="grid grid-cols-3 gap-2">
        <Button nativeButton={false} render={<Link href="/funding" />}>Add money</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/earn" />}>Invest</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/earn/kamino-lend?action=withdraw" />}>Withdraw</Button>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Your portfolio</h2>
          <Link href="/portfolio" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">View all →</Link>
        </div>
        {(devnet.portfolio?.unassignedDepositsUsd ?? 0) > 0 ? (
          <Card className="gap-3 rounded-2xl p-4">
            <div>
              <p className="font-medium">
                Transfer needs review
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This transfer could not be matched to a deposit. Contact support.
              </p>
            </div>
          </Card>
        ) : null}
        {portfolioReady && devnet.portfolio?.positions.length === 0 && devnet.portfolio?.holdings.length === 0 ? <Card className="rounded-2xl p-5"><p className="text-sm text-muted-foreground">Your assets and investments will appear here.</p></Card> : null}
        {!portfolioReady && !devnet.portfolioError ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading portfolio…
          </p>
        ) : null}
        {hydrated && positionValues.length > 0 ? (
          <PositionSection positions={positionValues} />
        ) : null}
        {hydrated && holdingValues.length > 0 ? (
          <HoldingsSection holdings={holdingValues} />
        ) : null}
      </section>
      <EarnJourney showNextStep={false} />
    </div>
  );
}
