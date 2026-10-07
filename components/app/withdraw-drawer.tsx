"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { accruedPosition, YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { useNow } from "@/lib/useNow";
import { useDevnet } from "@/lib/useDevnet";

type CompletedWithdrawal = {
  amount: number;
  title: string;
  explorerUrl?: string;
};

export function WithdrawDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { positions, displayCurrency, withdraw } = useAppStore();
  const devnet = useDevnet();
  const now = useNow();
  const [completed, setCompleted] = useState<CompletedWithdrawal | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = YIELD_STRATEGIES.filter((strategy) => positions[strategy.id]);

  const changeOpen = (nextOpen: boolean) => {
    setCompleted(null);
    setError(null);
    onOpenChange(nextOpen);
  };

  const withdrawPosition = async (strategy: YieldStrategy) => {
    if (processingId) return;
    setError(null);
    if (devnet.mode === "devnet") {
      const position = positions[strategy.id];
      if (!position || !devnet.walletAddress) return;
      const earnedUsd = now === null
        ? position.earnedCarryUsd ?? 0
        : accruedPosition(position, strategy.demoApy, now);
      setProcessingId(strategy.id);
      try {
        const response = await fetch("/api/devnet/withdraw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: devnet.walletAddress,
            productId: strategy.id,
            principalUsd: position.principal,
            earnedUsd,
          }),
        });
        const result = await response.json() as {
          signature?: unknown;
          explorerUrl?: unknown;
          amountUsd?: unknown;
          error?: unknown;
        };
        if (!response.ok || typeof result.signature !== "string" || typeof result.explorerUrl !== "string") {
          throw new Error(typeof result.error === "string" ? result.error : "Не удалось вернуть средства.");
        }
        const amount = withdraw(strategy.id, {
          onchain: true,
          signature: result.signature,
          explorerUrl: result.explorerUrl,
        });
        if (!amount) throw new Error("Не удалось обновить состояние вклада.");
        setCompleted({ amount, title: strategy.name, explorerUrl: result.explorerUrl });
        void devnet.refresh();
        toast.success("Средства возвращены в кошелёк");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "";
        setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось вернуть тестовые доллары. Попробуйте ещё раз.");
      } finally {
        setProcessingId(null);
      }
      return;
    }

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
      description={devnet.mode === "devnet"
        ? "Верните тестовые доллары из вклада в свой Solana-кошелёк."
        : "Верните средства из вклада на баланс приложения."}
    >
      {completed ? (
        <DrawerSuccess
          amount={completed.amount}
          currency={displayCurrency}
          sentence={devnet.mode === "devnet"
            ? `Средства из вклада «${completed.title}» возвращены в ваш кошелёк.`
            : `Средства из вклада «${completed.title}» вернулись на баланс.`}
          onDone={() => changeOpen(false)}
          secondaryHref="/activity"
          secondaryLabel="История операций"
          explorerUrl={completed.explorerUrl}
        />
      ) : (
        <div className="space-y-4">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {active.length > 0 ? (
            <div className="space-y-2">
              {active.map((strategy) => (
                <WithdrawPosition
                  key={strategy.id}
                  strategy={strategy}
                  position={positions[strategy.id]!}
                  now={now}
                  currency={displayCurrency}
                  processing={processingId === strategy.id}
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
  processing,
  onWithdraw,
}: {
  strategy: YieldStrategy;
  position: { principal: number; since: number; earnedCarryUsd?: number };
  now: number | null;
  currency: "USD" | "KZT";
  processing: boolean;
  onWithdraw: (strategy: YieldStrategy) => void;
}) {
  const earned = now === null ? (position.earnedCarryUsd ?? 0) : accruedPosition(position, strategy.demoApy, now);
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
      <Button variant="outline" className="w-full" onClick={() => onWithdraw(strategy)} disabled={processing}>
        <ArrowUpFromLine />{processing ? "Возвращаем…" : `Вывести ${formatMoney(payout, currency)}`}
      </Button>
    </Card>
  );
}
