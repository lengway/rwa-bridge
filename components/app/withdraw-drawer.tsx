"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { ArrowUpFromLine, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { MoonPaySellPath } from "@/components/app/moonpay-paths";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatEarningsMoney, formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { useDevnet } from "@/lib/useDevnet";

type CompletedWithdrawal = {
  amount: number;
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
  const { jwt } = useCrossmintAuth();
  const { wallet } = useWallet();
  return <WithdrawDrawerContents {...props} wallet={wallet ?? null} jwt={jwt ?? null} />;
}

function WithdrawDrawerContents({
  open,
  onOpenChange,
  onAddMoney,
  wallet,
  jwt,
}: WithdrawDrawerProps & { wallet: ReturnType<typeof useWallet>["wallet"] | null; jwt: string | null }) {
  const {
    positions,
    displayCurrency,
    cashUsd,
  } = useAppStore();
  const devnet = useDevnet();
  const [completed, setCompleted] = useState<CompletedWithdrawal | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pendingRedemption, setPendingRedemption] = useState<{ productId: string; signature: string; shares: number } | null>(null);
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

  const completeCardWithdrawal = (amount: number, details: { signature: string; explorerUrl: string; note: string }) => {
    if (cardWithdrawalRecorded.current) return false;
    cardWithdrawalRecorded.current = true;
    setError(null);
    setCompleted({
      amount,
      explorerUrl: details.explorerUrl,
      note: details.note,
      isCardWithdrawal: true,
    });
    void devnet.refreshPortfolio();
    toast.success("Перевод в MoonPay подтверждён");
    return true;
  };

  const withdrawPosition = async (strategy: YieldStrategy, requestedShares?: number) => {
    if (processingId) return;
    setError(null);
    const position = positions[strategy.id];
    if (!position || !devnet.walletAddress) return;
    const shares = requestedShares ?? position.shares ?? 0;
    const vaultMint = strategy.id === "ondo-usdy" ? devnet.vaultUsdyMint : devnet.vaultKzgbMint;
    const retryPending = pendingRedemption?.productId === strategy.id && pendingRedemption.shares === shares;
    if (pendingRedemption && !retryPending) {
      setError("Сначала повторите подтверждение предыдущего вывода.");
      return;
    }
    if ((!wallet && !retryPending) || !devnet.treasuryOwner || !vaultMint || shares <= 0) {
      setError("Не удалось подключить кошелёк или токен доли.");
      return;
    }
    setProcessingId(strategy.id);
    try {
      let signature = retryPending ? pendingRedemption.signature : null;
      if (!signature) {
        setProgress("Подписываем перевод…");
        const transfer = await wallet!.send(devnet.treasuryOwner, vaultMint, String(shares));
        if (!transfer.hash) throw new Error("Кошелёк не вернул подпись перевода долей.");
        signature = transfer.hash;
        setPendingRedemption({ productId: strategy.id, signature, shares });
      }
      setProgress("Подтверждаем в сети…");
      const response = await fetch("/api/devnet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ walletAddress: devnet.walletAddress, productId: strategy.id, signature, shares }),
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
        shares: result.sharesRedeemed,
        shareTicker: strategy.ticker,
        explorerUrl: result.explorerUrl,
      });
      setPendingRedemption(null);
      void devnet.refreshPortfolio();
      toast.success("Доли погашены, средства отправлены на кошелёк");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось подтвердить вывод. Проверьте соединение и повторите подтверждение.");
    } finally {
      setProcessingId(null);
      setProgress(null);
    }
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="Вывести средства"
      description={method === "card" ? "Перевод в MoonPay в сети devnet." : "Отправьте доли на погашение. Казначейство вернёт USD по текущей цене доли."}
    >
      {completed ? (
        <DrawerSuccess
          amount={completed.amount}
          currency={displayCurrency}
          sentence={completed.isCardWithdrawal
            ? "Перевод в MoonPay подтверждён в сети Solana devnet."
            : `Погашено ${formatQuantity(completed.shares ?? Number.NaN)} ${completed.shareTicker ?? "долей"}; USD отправлены в ваш кошелёк.`}
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
              disabled={Boolean(processingId || pendingRedemption)}
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
              disabled={Boolean(processingId || pendingRedemption)}
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
                  currency={displayCurrency}
                  processing={processingId === strategy.id}
                  processingLabel={progress}
                  pending={pendingRedemption?.productId === strategy.id}
                  blocked={Boolean(pendingRedemption && pendingRedemption.productId !== strategy.id)}
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
  currency,
  processing,
  processingLabel,
  pending,
  blocked,
  onWithdraw,
}: {
  strategy: YieldStrategy;
  position: { principal: number; earnedCarryUsd?: number; shares?: number; priceUsd?: number; valueUsd?: number };
  currency: "USD" | "KZT";
  processing: boolean;
  processingLabel: string | null;
  pending: boolean;
  blocked: boolean;
  onWithdraw: (strategy: YieldStrategy, shares?: number) => void;
}) {
  const availableShares = position.shares ?? position.principal;
  const [sharesInput, setSharesInput] = useState(String(availableShares));
  const requestedShares = Number(sharesInput);
  const validShares = Number.isFinite(requestedShares) && requestedShares > 0 && requestedShares <= availableShares;
  const earned = position.earnedCarryUsd ?? 0;
  const payout = requestedShares * (position.priceUsd ?? 1);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{strategy.name}</p>
          <p className="text-xs text-muted-foreground">{formatQuantity(availableShares)} {strategy.ticker} · {formatMoney(position.valueUsd ?? position.principal + earned, currency)}</p>
        </div>
        <span className="text-right text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
          +{formatEarningsMoney(earned, currency)}
        </span>
      </div>
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
            disabled={processing || pending}
          />
          <span className="block text-xs text-muted-foreground">Оценка возврата: {formatMoney(payout, currency)}</span>
          {!validShares ? <span className="block text-xs text-destructive">Укажите сумму не больше доступного баланса.</span> : null}
      </label>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => onWithdraw(strategy, requestedShares)}
        disabled={processing || blocked || (!validShares && !pending)}
      >
        <ArrowUpFromLine />{processing ? (processingLabel ?? "Погашаем…") : pending ? "Повторить подтверждение" : `Вывести ${formatMoney(payout, currency)}`}
      </Button>
    </Card>
  );
}
