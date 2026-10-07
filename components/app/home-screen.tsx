"use client";

import { useState } from "react";
import { AddMoneyDrawer, WithdrawDrawer } from "@/components/app/drawers";
import { AccountGreeting, BalanceCard } from "@/components/app/home-account";
import { OnboardingChecklist, QuickActions } from "@/components/app/home-actions";
import { HoldingsSection, PositionSection, PromoCard } from "@/components/app/home-portfolio";
import { DEMO_ASSETS } from "@/lib/assets";
import { useNow } from "@/lib/useNow";
import { useAppStore } from "@/lib/store";
import { accruedPosition, YIELD_STRATEGIES } from "@/lib/yields";
import { useDevnet } from "@/lib/useDevnet";

export function HomeScreen() {
  const {
    cashUsd,
    positions,
    holdings,
    displayCurrency,
    setDisplayCurrency,
    realizedEarningsUsd,
    hydrated,
  } = useAppStore();
  const devnet = useDevnet();
  const displayHydrated = hydrated && (devnet.mode !== "devnet" || devnet.onchain !== null);
  const [addOpen, setAddOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const now = useNow();

  const positionValues = YIELD_STRATEGIES.flatMap((strategy) => {
    const position = positions[strategy.id];
    if (!position) return [];
    const earned = now === null
      ? 0
      : accruedPosition(position, strategy.demoApy, now);
    return [{ strategy, position, earned }];
  });
  const holdingValues = DEMO_ASSETS.flatMap((asset) => {
    const holding = holdings[asset.id];
    return holding ? [{ asset, holding }] : [];
  });
  const positionsValue = positionValues.reduce(
    (sum, item) => sum + item.position.principal + item.earned,
    0,
  );
  const holdingsValue = holdingValues.reduce(
    (sum, item) => sum + item.holding.costUsd,
    0,
  );
  const total = cashUsd + positionsValue + holdingsValue;
  const unrealizedEarnings = positionValues.reduce(
    (sum, item) => sum + item.earned,
    0,
  );
  const hasCash = cashUsd > 0;
  const hasPosition = positionValues.length > 0;

  return (
    <div className="space-y-7">
      <AccountGreeting />
      <BalanceCard
        total={total}
        cashUsd={cashUsd}
        earnings={realizedEarningsUsd + unrealizedEarnings}
        currency={displayCurrency}
        hydrated={displayHydrated}
        onCurrencyChange={setDisplayCurrency}
        mode={devnet.mode}
      />
      <QuickActions
        onAddMoney={() => setAddOpen(true)}
        onWithdraw={() => setWithdrawOpen(true)}
      />

      {hydrated && positionValues.length === 0 && holdingValues.length === 0 ? (
        <OnboardingChecklist
          hasCash={hasCash}
          hasPosition={hasPosition}
          onAddMoney={() => setAddOpen(true)}
        />
      ) : null}

      {hydrated && positionValues.length > 0 ? (
        <PositionSection positions={positionValues} currency={displayCurrency} />
      ) : null}
      {hydrated && holdingValues.length > 0 ? (
        <HoldingsSection holdings={holdingValues} currency={displayCurrency} />
      ) : null}
      {hydrated && !positions["ondo-usdy"] ? <PromoCard /> : null}
      <AddMoneyDrawer open={addOpen} onOpenChange={setAddOpen} />
      <WithdrawDrawer
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        onAddMoney={() => {
          setWithdrawOpen(false);
          setAddOpen(true);
        }}
      />
    </div>
  );
}
