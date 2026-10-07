"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { MoonPaySellPath } from "@/components/app/moonpay-paths";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { accruedPosition, YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { useNow } from "@/lib/useNow";
import { useDevnet } from "@/lib/useDevnet";

type CompletedWithdrawal = {
  amount: number;
  title: string;
  explorerUrl?: string;
  note?: string;
  isCardWithdrawal?: boolean;
};

export function WithdrawDrawer({
  open,
  onOpenChange,
  onAddMoney,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMoney?: () => void;
}) {
  const { positions, displayCurrency, withdraw, cashUsd, recordCardWithdrawal } = useAppStore();
  const devnet = useDevnet();
  const now = useNow();
  const [completed, setCompleted] = useState<CompletedWithdrawal | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"yield" | "card">("yield");
  const [cardAmount, setCardAmount] = useState("50");
  const [cardAmountTouched, setCardAmountTouched] = useState(false);
  const cardWithdrawalRecorded = useRef(false);
  const active = YIELD_STRATEGIES.filter((strategy) => positions[strategy.id]);
  const cardAmountValue = Number(cardAmount);
  const validCardAmount = Number.isFinite(cardAmountValue)
    && cardAmountValue >= 20
    && cardAmountValue <= cashUsd
    && cardAmountValue <= 1000;

  const resetCardAmount = () => {
    setCardAmount(String(Math.max(20, Math.min(50, Math.floor(cashUsd)))));
    setCardAmountTouched(false);
  };

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen && method === "card") resetCardAmount();
    setCompleted(null);
    setError(null);
    cardWithdrawalRecorded.current = false;
    onOpenChange(nextOpen);
  };

  const completeCardWithdrawal = (amount: number, details: {
    onchain?: boolean;
    signature?: string;
    explorerUrl?: string;
    note: string;
  }) => {
    if (cardWithdrawalRecorded.current) return false;
    cardWithdrawalRecorded.current = true;
    const recorded = recordCardWithdrawal(amount, details);
    if (!recorded) {
      cardWithdrawalRecorded.current = false;
      setError("Недостаточно средств на балансе для вывода.");
      return false;
    }
    setError(null);
    setCompleted({
      amount,
      title: "MoonPay",
      explorerUrl: details.explorerUrl,
      note: details.note,
      isCardWithdrawal: true,
    });
    if (details.onchain) void devnet.refresh();
    toast.success(details.onchain ? "Тестовые доллары списаны с баланса" : "Демо-вывод записан");
    return true;
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
      description={method === "card"
        ? "Вывод на карту через MoonPay. В тестовом режиме списание тестовых долларов симулируется."
        : devnet.mode === "devnet"
        ? "Верните тестовые доллары из вклада в свой Solana-кошелёк."
        : "Верните средства из вклада на баланс приложения."}
    >
      {completed ? (
        <DrawerSuccess
          amount={completed.amount}
          currency={displayCurrency}
          sentence={completed.isCardWithdrawal
            ? "Вывод на карту записан в историю операций."
            : devnet.mode === "devnet"
              ? `Средства из вклада «${completed.title}» возвращены в ваш кошелёк.`
              : `Средства из вклада «${completed.title}» вернулись на баланс.`}
          note={completed.note}
          onDone={() => changeOpen(false)}
          secondaryHref="/activity"
          secondaryLabel="История операций"
          explorerUrl={completed.explorerUrl}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Способ вывода">
            <button
              type="button"
              role="tab"
              aria-selected={method === "yield"}
              onClick={() => {
                setMethod("yield");
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${method === "yield" ? "border-foreground bg-muted" : "hover:bg-muted/40"}`}
            >
              Из вклада на баланс
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "card"}
              onClick={() => {
                resetCardAmount();
                setError(null);
                setMethod("card");
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${method === "card" ? "border-foreground bg-muted" : "hover:bg-muted/40"}`}
            >
              На банковскую карту
            </button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {method === "yield" && active.length > 0 ? (
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
          ) : null}
          {method === "yield" && active.length === 0 ? (
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
          ) : null}
          {method === "card" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="moonpay-withdraw-amount" className="text-sm font-medium">Сумма вывода</label>
                <span className="text-xs text-muted-foreground">Доступно {formatMoney(cashUsd, "USD")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="moonpay-withdraw-amount"
                  type="number"
                  min="20"
                  max={cashUsd}
                  inputMode="decimal"
                  value={cardAmount}
                  onChange={(event) => {
                    setCardAmount(event.target.value);
                    setCardAmountTouched(true);
                  }}
                  className="h-11 text-lg tabular-nums"
                />
                <span className="text-sm font-medium">USD</span>
              </div>
              <p className="text-xs text-muted-foreground">Минимум $20, максимум за одну операцию MoonPay — $1 000.</p>
              {cashUsd < 20 ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Для вывода на карту нужно минимум $20.</p>
                  {onAddMoney ? (
                    <Button variant="outline" className="w-full" onClick={onAddMoney}>
                      Пополнить баланс
                    </Button>
                  ) : null}
                </div>
              ) : cardAmountTouched && !validCardAmount ? (
                <p className="text-xs text-destructive">
                  Введите сумму от $20 до доступного баланса и не выше $1 000.
                </p>
              ) : null}
            </div>
          ) : null}
          {method === "card" ? (
            <MoonPaySellPath
              amount={cardAmountValue || 0}
              validAmount={validCardAmount}
              onWithdrawal={completeCardWithdrawal}
              onSelectAnotherMethod={() => setMethod("yield")}
            />
          ) : null}
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
