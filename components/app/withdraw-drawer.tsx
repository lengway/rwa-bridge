"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { ArrowUpFromLine, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { MoonPaySellPath } from "@/components/app/moonpay-paths";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatEarningsMoney, formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { accruedPosition, YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { useNow } from "@/lib/useNow";
import { useDevnet } from "@/lib/useDevnet";
import { getStrategyApy } from "@/lib/market-data";
import { Badge } from "@/components/ui/badge";
import { isCrossmintConfigured } from "@/lib/config";

type CompletedWithdrawal = {
  amount: number;
  title: string;
  shares?: number;
  shareTicker?: string;
  explorerUrl?: string;
  note?: string;
  isCardWithdrawal?: boolean;
};

type WithdrawDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMoney?: () => void;
};

export function WithdrawDrawer(props: WithdrawDrawerProps) {
  if (!isCrossmintConfigured) return <WithdrawDrawerContents {...props} wallet={null} />;
  return <WithdrawDrawerWithWallet {...props} />;
}

function WithdrawDrawerWithWallet(props: WithdrawDrawerProps) {
  const { wallet } = useWallet();
  return <WithdrawDrawerContents {...props} wallet={wallet ?? null} />;
}

function WithdrawDrawerContents({
  open,
  onOpenChange,
  onAddMoney,
  wallet,
}: WithdrawDrawerProps & { wallet: ReturnType<typeof useWallet>["wallet"] | null }) {
  const {
    positions,
    displayCurrency,
    withdraw,
    cashUsd,
    recordCardWithdrawal,
  } = useAppStore();
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
    const recorded = details.onchain ? true : recordCardWithdrawal(amount, details);
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
    if (details.onchain) void devnet.refreshPortfolio();
    toast.success(details.onchain ? "Тестовые доллары списаны с баланса" : "Демо-вывод записан");
    return true;
  };

  const withdrawPosition = async (strategy: YieldStrategy, requestedShares?: number) => {
    if (processingId) return;
    setError(null);
    if (devnet.mode === "devnet") {
      const position = positions[strategy.id];
      if (!position || !devnet.walletAddress) return;
      const shares = requestedShares ?? position.shares ?? 0;
      const vaultMint = strategy.id === "ondo-usdy" ? devnet.vaultUsdyMint : devnet.vaultKzgbMint;
      if (!wallet || !devnet.treasuryOwner || !vaultMint || shares <= 0) {
        setError("Не удалось подключить кошелёк или токен доли.");
        return;
      }
      setProcessingId(strategy.id);
      try {
        const transfer = await wallet.send(devnet.treasuryOwner, vaultMint, String(shares));
        if (!transfer.hash) throw new Error("Кошелёк не вернул подпись перевода долей.");
        const response = await fetch("/api/devnet/withdraw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: devnet.walletAddress,
            productId: strategy.id,
            signature: transfer.hash,
            shares,
          }),
        });
        const result = await response.json() as {
          signature?: unknown;
          explorerUrl?: unknown;
          amountUsd?: unknown;
          sharesRedeemed?: unknown;
          error?: unknown;
        };
        if (!response.ok || typeof result.signature !== "string" || typeof result.explorerUrl !== "string"
          || typeof result.amountUsd !== "number" || typeof result.sharesRedeemed !== "number") {
          throw new Error(typeof result.error === "string" ? result.error : "Не удалось вернуть средства.");
        }
        setCompleted({
          amount: result.amountUsd,
          title: strategy.name,
          shares: result.sharesRedeemed,
          shareTicker: strategy.id === "ondo-usdy" ? "vUSDY-DEMO" : "vKZGB-DEMO",
          explorerUrl: result.explorerUrl,
        });
        void devnet.refreshPortfolio();
        toast.success("Доли погашены, тестовые доллары отправлены");
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
        ? "Отправьте доли на погашение. Казначейство вернёт тестовые доллары по текущей цене доли."
        : "Верните средства из вклада на баланс приложения."}
    >
      {completed ? (
        <DrawerSuccess
          amount={completed.amount}
          currency={displayCurrency}
          sentence={completed.isCardWithdrawal
            ? "Вывод на карту записан в историю операций."
            : devnet.mode === "devnet"
              ? `Погашено ${completed.shares?.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${completed.shareTicker}; тестовые доллары отправлены в ваш кошелёк.`
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
  position: { principal: number; since: number; earnedCarryUsd?: number; shares?: number; priceUsd?: number };
  now: number | null;
  currency: "USD" | "KZT";
  processing: boolean;
  onWithdraw: (strategy: YieldStrategy, shares?: number) => void;
}) {
  const { marketData, acceleratedAccrual } = useAppStore();
  const devnet = useDevnet();
  const availableShares = position.shares ?? position.principal;
  const [sharesInput, setSharesInput] = useState(String(availableShares));
  const requestedShares = Number(sharesInput);
  const validShares = Number.isFinite(requestedShares) && requestedShares > 0 && requestedShares <= availableShares;
  const earned = devnet.mode === "devnet"
    ? position.earnedCarryUsd ?? 0
    : now === null
      ? (position.earnedCarryUsd ?? 0)
      : accruedPosition(position, getStrategyApy(strategy.id, marketData.yields), now, acceleratedAccrual);
  const payout = devnet.mode === "devnet"
    ? requestedShares * (position.priceUsd ?? 1)
    : position.principal + earned;
  const shareTicker = strategy.id === "ondo-usdy" ? "vUSDY-DEMO" : "vKZGB-DEMO";

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{strategy.name}</p>
          <p className="text-xs text-muted-foreground">
            {devnet.mode === "devnet"
              ? `${availableShares.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${shareTicker} · ${formatMoney(position.principal + earned, currency)}`
              : `Вложено ${formatMoney(position.principal, currency)}`}
          </p>
        </div>
        <span className="text-right text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
          {devnet.mode === "devnet"
            ? `+${formatEarningsMoney(earned, currency)}`
            : `+${formatEarningsMoney(earned, currency)}`}
          {devnet.mode === "demo" && acceleratedAccrual ? <Badge variant="outline" className="mt-1">Ускоренный режим</Badge> : null}
        </span>
      </div>
      {devnet.mode === "devnet" ? (
        <label className="space-y-1.5 text-sm">
          <span>Долей к погашению</span>
          <Input
            type="number"
            min="0.000001"
            step="0.000001"
            max={availableShares}
            inputMode="decimal"
            value={sharesInput}
            onChange={(event) => setSharesInput(event.target.value)}
          />
          <span className="block text-xs text-muted-foreground">Оценка возврата: {formatMoney(payout, currency)}</span>
          {!validShares ? <span className="block text-xs text-destructive">Укажите сумму не больше доступного баланса.</span> : null}
        </label>
      ) : null}
      <Button
        variant="outline"
        className="w-full"
        onClick={() => onWithdraw(strategy, devnet.mode === "devnet" ? requestedShares : undefined)}
        disabled={processing || (devnet.mode === "devnet" && !validShares)}
      >
        <ArrowUpFromLine />{processing ? "Погашаем…" : `Вывести ${formatMoney(payout, currency)}`}
      </Button>
    </Card>
  );
}
