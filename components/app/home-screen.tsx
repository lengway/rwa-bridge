"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AddMoneyDrawer, WithdrawDrawer } from "@/components/app/drawers";
import { AccountGreeting, BalanceCard } from "@/components/app/home-account";
import { QuickActions } from "@/components/app/home-actions";
import { HoldingsSection, PositionSection, PromoCard } from "@/components/app/home-portfolio";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DEMO_ASSETS } from "@/lib/assets";
import { formatMoney } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { useAppStore } from "@/lib/store";
import { accruedPosition, YIELD_STRATEGIES } from "@/lib/yields";
import { useDevnet } from "@/lib/useDevnet";
import { getStrategyApy } from "@/lib/market-data";

export function HomeScreen() {
  const {
    cashUsd,
    positions,
    holdings,
    displayCurrency,
    setDisplayCurrency,
    realizedEarningsUsd,
    acceleratedAccrual,
    marketData,
    hydrated,
  } = useAppStore();
  const devnet = useDevnet();
  const displayHydrated = hydrated && (devnet.mode !== "devnet" || devnet.onchain !== null);
  const [addOpen, setAddOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [assigningDeposits, setAssigningDeposits] = useState(false);
  const now = useNow();

  const positionValues = YIELD_STRATEGIES.flatMap((strategy) => {
    const position = positions[strategy.id];
    if (!position) return [];
    const earned = now === null
      ? 0
      : accruedPosition(position, getStrategyApy(strategy.id, marketData.yields), now, acceleratedAccrual);
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
  const portfolioReady = devnet.mode !== "devnet" || devnet.portfolio !== null;

  const assignDeposits = async () => {
    if (!devnet.walletAddress || assigningDeposits) return;
    setAssigningDeposits(true);
    try {
      const response = await fetch("/api/devnet/assign-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: devnet.walletAddress, productId: YIELD_STRATEGIES[0].id }),
      });
      const result = await response.json() as { ok?: unknown; error?: unknown };
      if (!response.ok || result.ok !== true) {
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось зачислить перевод.");
      }
      await devnet.refresh();
      toast.success("Переводы зачислены во вклад");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось зачислить перевод.";
      toast.error(message);
    } finally {
      setAssigningDeposits(false);
    }
  };

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

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Портфель</h2>
        {devnet.mode === "devnet" && (devnet.portfolio?.unassignedDepositsUsd ?? 0) > 0 ? (
          <Card className="gap-3 rounded-2xl p-4">
            <div>
              <p className="font-medium">
                На хранении {formatMoney(devnet.portfolio!.unassignedDepositsUsd)} без привязки к вкладу
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Найдены подтверждённые переводы в казначейство. Выберите, куда их зачислить.
              </p>
            </div>
            <Button className="w-full" onClick={assignDeposits} disabled={assigningDeposits}>
              {assigningDeposits ? "Зачисляем…" : "Зачислить во «Долларовый вклад»"}
            </Button>
          </Card>
        ) : null}
        {hydrated && portfolioReady && positionValues.length === 0 && holdingValues.length === 0 ? (
          <Card className="items-center gap-3 rounded-2xl p-5 text-center">
            <p className="font-medium">Пока нет вкладов и долей</p>
            <p className="text-sm text-muted-foreground">Откройте вклад или купите долю, чтобы увидеть портфель.</p>
            <div className="grid w-full grid-cols-2 gap-2 pt-1">
              <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/earn" />}>
                Открыть вклад
              </Button>
              <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/assets/demo-office" />}>
                Купить долю
              </Button>
            </div>
          </Card>
        ) : null}
        {!portfolioReady ? <p className="text-sm text-muted-foreground">Загружаем портфель…</p> : null}
        {hydrated && positionValues.length > 0 ? (
          <PositionSection positions={positionValues} currency={displayCurrency} />
        ) : null}
        {hydrated && holdingValues.length > 0 ? (
          <HoldingsSection holdings={holdingValues} currency={displayCurrency} />
        ) : null}
      </section>
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
