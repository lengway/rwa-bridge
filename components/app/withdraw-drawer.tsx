"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, CreditCard, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { accrued, YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { useNow } from "@/lib/useNow";

type CompletedWithdrawal = {
  amount: number;
  title: string;
};

export function WithdrawDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { positions, displayCurrency, withdraw } = useAppStore();
  const now = useNow();
  const [completed, setCompleted] = useState<CompletedWithdrawal | null>(null);
  const active = YIELD_STRATEGIES.filter((strategy) => positions[strategy.id]);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setCompleted(null);
    if (nextOpen) setCompleted(null);
    onOpenChange(nextOpen);
  };

  const withdrawPosition = (strategy: YieldStrategy) => {
    const amount = withdraw(strategy.id);
    if (!amount) return;
    setCompleted({ amount, title: strategy.name });
    toast.success("Средства возвращены на баланс");
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="Вывести средства"
      description="Верните средства из вклада на баланс приложения."
    >
      {completed ? (
        <DrawerSuccess
          amount={completed.amount}
          currency={displayCurrency}
          sentence={`Средства из вклада «${completed.title}» вернулись на баланс.`}
          onDone={() => changeOpen(false)}
          secondaryHref="/activity"
          secondaryLabel="История операций"
        />
      ) : (
        <div className="space-y-4">
          {active.length > 0 ? (
            <div className="space-y-2">
              {active.map((strategy) => (
                <WithdrawPosition
                  key={strategy.id}
                  strategy={strategy}
                  position={positions[strategy.id]!}
                  now={now}
                  currency={displayCurrency}
                  onWithdraw={withdrawPosition}
                />
              ))}
            </div>
          ) : (
            <Card className="items-center gap-2 p-6 text-center">
              <WalletCards className="size-6 text-muted-foreground" />
              <p className="font-medium">Нет открытых вкладов</p>
              <p className="text-sm text-muted-foreground">
                Откройте вклад во вкладке «Доход», чтобы вернуть деньги на баланс.
              </p>
              <Button
                variant="outline"
                className="mt-2"
                nativeButton={false}
                render={<Link href="/earn" />}
              >
                Перейти к вкладам
              </Button>
            </Card>
          )}
          <Card className="flex-row items-start gap-3 p-4">
            <div className="rounded-full bg-muted p-2"><CreditCard className="size-4" /></div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium">Вывести на карту</p>
                <Badge variant="outline">Скоро</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Выплата на карту и в тенге пока недоступна.
              </p>
            </div>
          </Card>
        </div>
      )}
    </DrawerFrame>
  );
}

function WithdrawPosition({
  strategy,
  position,
  now,
  currency,
  onWithdraw,
}: {
  strategy: YieldStrategy;
  position: { principal: number; since: number };
  now: number | null;
  currency: "USD" | "KZT";
  onWithdraw: (strategy: YieldStrategy) => void;
}) {
  const earned = now === null
    ? 0
    : accrued(position.principal, position.since, strategy.demoApy, now);
  const payout = position.principal + earned;

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{strategy.name}</p>
          <p className="text-xs text-muted-foreground">
            Вложено {formatMoney(position.principal, currency)}
          </p>
        </div>
        <span className="text-right text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
          +{formatMoney(earned, currency)}
        </span>
      </div>
      <Button variant="outline" className="w-full" onClick={() => onWithdraw(strategy)}>
        <ArrowUpFromLine />Вывести {formatMoney(payout, currency)}
      </Button>
    </Card>
  );
}
