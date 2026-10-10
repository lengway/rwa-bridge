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
import { formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { ALL_YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { formatAtomicToDecimal, parseDecimalToAtomic } from "@/lib/earn-gateway";
import { useDevnet } from "@/lib/useDevnet";
import { useAuth } from "@/lib/useAuth";
import {
  GatewayDisclosureBadges,
  canRedeemStrategy,
  getGatewayInfo,
} from "@/components/app/earn-detail-parts";

type CompletedWithdrawal = {
  amount: number;
  currency?: "USD" | "KZT";
  shares?: number;
  shareTicker?: string;
  explorerUrl?: string;
  note?: string;
  isCardWithdrawal?: boolean;
  sentence?: string;
  amountLabel?: string;
};

type WithdrawDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMoney?: () => void;
};

/** Existing portfolio data is numeric presentation data; normalize it before a new exact action. */
function displayShareAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return formatAtomicToDecimal(BigInt(Math.round(value * 1_000_000)), 6);
}

export function WithdrawDrawer(props: WithdrawDrawerProps) {
  const { wallet } = useAuth();
  return <WithdrawDrawerContents {...props} wallet={wallet} />;
}

function WithdrawDrawerContents({
  open,
  onOpenChange,
  onAddMoney,
  wallet,
}: WithdrawDrawerProps & { wallet: ReturnType<typeof useAuth>["wallet"] }) {
  const {
    positions,
    displayCurrency,
    cashUsd,
  } = useAppStore();
  const devnet = useDevnet();
  const [completed, setCompleted] = useState<CompletedWithdrawal | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pendingRedemption, setPendingRedemption] = useState<{
    productId: string;
    signature: string;
    sharesAtomic: string;
    sharesDecimal: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"yield" | "card" | "tenge">("yield");
  const [tengeAmount, setTengeAmount] = useState("10000");
  const [cardEnding, setCardEnding] = useState("");
  const [pendingKzte, setPendingKzte] = useState<{ signature: string; amount: number } | null>(null);
  const [cardAmount, setCardAmount] = useState("50");
  const [cardAmountTouched, setCardAmountTouched] = useState(false);
  const cardWithdrawalRecorded = useRef(false);
  const active = ALL_YIELD_STRATEGIES.filter((strategy) => positions[strategy.id]);
  const legacyExternalPayoutAvailable = false;
  const cardAmountValue = Number(cardAmount);
  const validCardAmount = Number.isFinite(cardAmountValue)
    && cardAmountValue >= 20
    && cardAmountValue <= cashUsd
    && cardAmountValue <= 1000;
  const kzteBalance = devnet.portfolio?.holdings.find((holding) => holding.kind === "kzte")?.balance ?? 0;
  const tengeAmountValue = Number(tengeAmount);
  const validTengeAmount = Number.isFinite(tengeAmountValue) && tengeAmountValue > 0 && tengeAmountValue <= kzteBalance;
  const pendingKzteMatches = Boolean(pendingKzte && Math.abs(pendingKzte.amount - tengeAmountValue) < 0.000001);

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

  const withdrawPosition = async (strategy: YieldStrategy, requestedShares?: string) => {
    if (processingId) return;
    setError(null);
    if (!canRedeemStrategy(strategy)) {
      setError("TEST-TOKEN REDEMPTION не поддерживается для этой позиции. Новая операция не была подготовлена.");
      return;
    }
    const position = positions[strategy.id];
    if (!position || !devnet.walletAddress) return;
    let redemption: { atomic: string; decimal: string };
    try {
      const decimal = requestedShares ?? displayShareAmount(position.shares ?? 0);
      const atomic = parseDecimalToAtomic(decimal, 6, "shares");
      if (atomic <= BigInt(0)) throw new Error("Количество долей должно быть положительным.");
      redemption = { atomic: atomic.toString(10), decimal: formatAtomicToDecimal(atomic, 6) };
    } catch {
      setError("Укажите количество тестовых долей с точностью до 6 знаков после запятой.");
      return;
    }
    const shares = redemption.decimal;
    const vaultMint = strategy.id === "ondo-usdy" ? devnet.vaultUsdyMint : devnet.vaultKzgbMint;
    const retryPending = pendingRedemption?.productId === strategy.id && pendingRedemption.sharesAtomic === redemption.atomic;
    if (pendingRedemption && !retryPending) {
      setError("Сначала повторите подтверждение предыдущего вывода.");
      return;
    }
    if ((!wallet && !retryPending) || !devnet.treasuryOwner || !vaultMint) {
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
        setPendingRedemption({
          productId: strategy.id,
          signature,
          sharesAtomic: redemption.atomic,
          sharesDecimal: shares,
        });
      }
      setProgress("Подтверждаем в сети…");
      const response = await fetch("/api/devnet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: devnet.walletAddress,
          productId: strategy.id,
          signature,
          sharesAtomic: redemption.atomic,
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
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось подтвердить погашение тестовых долей.");
      }
      setCompleted({
        amount: result.amountUsd,
        amountLabel: `${formatQuantity(result.sharesRedeemed)} ${strategy.ticker}`,
        shares: result.sharesRedeemed,
        shareTicker: strategy.ticker,
        explorerUrl: result.explorerUrl,
        note: "DEVNET DEMO · TEST-TOKEN REDEMPTION · NO MONETARY VALUE. Это не денежная выплата.",
      });
      setPendingRedemption(null);
      void devnet.refreshPortfolio();
      toast.success("Тестовые доли погашены в Solana Devnet");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось подтвердить вывод. Проверьте соединение и повторите подтверждение.");
    } finally {
      setProcessingId(null);
      setProgress(null);
    }
  };

  const redeemKzte = async () => {
    const pendingMatches = pendingKzteMatches;
    if (processingId || (!validTengeAmount && !pendingMatches) || cardEnding.length !== 4 || !devnet.walletAddress || !devnet.treasuryOwner || !devnet.kzteMint) return;
    if (pendingKzte && !pendingMatches) {
      setError("Сначала повторите подтверждение предыдущего вывода KZTE.");
      return;
    }
    if (!wallet && !pendingMatches) {
      setError("Не удалось подключить кошелёк KZTE.");
      return;
    }
    setProcessingId("kzte");
    setError(null);
    try {
      let signature = pendingMatches ? pendingKzte?.signature ?? null : null;
      if (!signature) {
        setProgress("Подписываем перевод KZTE…");
        const transfer = await wallet!.send(devnet.treasuryOwner, devnet.kzteMint, String(tengeAmountValue));
        if (!transfer.hash) throw new Error("Кошелёк не вернул подпись перевода KZTE.");
        signature = transfer.hash;
        setPendingKzte({ signature, amount: tengeAmountValue });
      }
      setProgress("Возвращаем KZTE в резерв Intebix…");
      const response = await fetch("/api/devnet/kzte/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      const result = await response.json() as { amountKzt?: unknown; explorerUrl?: unknown; error?: unknown };
      if (!response.ok || typeof result.amountKzt !== "number" || typeof result.explorerUrl !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось вывести KZTE.");
      }
      setCompleted({
        amount: result.amountKzt,
        currency: "KZT",
        amountLabel: result.amountKzt.toLocaleString("ru-RU") + " ₸",
        sentence: "Выплата " + result.amountKzt.toLocaleString("ru-RU") + " ₸ на карту ·· " + cardEnding + " через Intebix; KZTE возвращены в резерв Intebix.",
        note: "Операция проведена в сети Solana devnet. Квитанция будет отправлена на email аккаунта.",
        explorerUrl: result.explorerUrl,
      });
      setPendingKzte(null);
      void devnet.refreshPortfolio();
      toast.success("KZTE возвращены в резерв Intebix");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось подтвердить вывод KZTE. Проверьте соединение и повторите попытку.");
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
      description={method === "card" ? "Внешний адаптер недоступен в Universal Earn Devnet demo." : method === "tenge" ? "Внешний адаптер недоступен в Universal Earn Devnet demo." : "DEVNET TEST-TOKEN REDEMPTION: отправьте тестовые доли на погашение; тестовые токены вернутся в кошелёк."}
    >
      {completed ? (
        <DrawerSuccess
          amount={completed.amount}
          currency={completed.currency ?? displayCurrency}
          amountLabel={completed.amountLabel}
          sentence={completed.sentence ?? (completed.isCardWithdrawal
            ? "Перевод в MoonPay подтверждён в сети Solana devnet."
            : `Погашено ${formatQuantity(completed.shares ?? Number.NaN)} ${completed.shareTicker ?? "тестовых долей"}; тестовые токены возвращены в кошелёк Devnet. Это не денежная выплата.`)}
          note={completed.note}
          onDone={() => changeOpen(false)}
          secondaryHref="/activity"
          secondaryLabel="История операций"
          explorerUrl={completed.explorerUrl}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Способ вывода">
            <button
              type="button"
              role="tab"
              aria-selected={method === "yield"}
              disabled={Boolean(processingId || pendingRedemption || pendingKzte)}
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
              disabled
              onClick={() => {
                resetCardAmount();
                setError(null);
                setMethod("card");
              }}
              className="rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              На карту · недоступно
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "tenge"}
              disabled
              onClick={() => { setError(null); setMethod("tenge"); }}
              className="rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              KZTE · недоступно
            </button>
          </div>
          <Card className="gap-2 border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-medium">DEVNET DEMO · NO MONETARY VALUE</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Внешние адаптеры карты, KZTE и Intebix — необязательные будущие интеграции и не входят в эту
              Devnet-стратегию. Они не создают денежную выплату или банковский перевод.
            </p>
          </Card>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {method === "yield" && active.length > 0 ? (
            <div className="space-y-2">
              {active.map((strategy) => (
                <WithdrawPosition
                  key={strategy.id}
                  strategy={strategy}
                  position={positions[strategy.id]!}
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
          {method === "card" && legacyExternalPayoutAvailable ? (
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
          {method === "card" && legacyExternalPayoutAvailable ? (
            <MoonPaySellPath
              amount={cardAmountValue || 0}
              validAmount={validCardAmount}
              onWithdrawal={completeCardWithdrawal}
              onSelectAnotherMethod={() => setMethod("yield")}
            />
          ) : null}
          {method === "tenge" && legacyExternalPayoutAvailable ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="intebix-withdraw-amount" className="text-sm font-medium">Сумма вывода</label>
                <span className="text-xs text-muted-foreground">Доступно {formatQuantity(kzteBalance)} KZTE</span>
              </div>
              <div className="flex items-center gap-2">
                <Input id="intebix-withdraw-amount" type="number" min="0.000001" step="any" max={kzteBalance} inputMode="decimal" value={tengeAmount} onChange={(event) => setTengeAmount(event.target.value)} disabled={Boolean(processingId || pendingKzte)} className="h-11 text-lg tabular-nums" />
                <span className="text-sm font-medium">KZTE</span>
              </div>
              <label htmlFor="intebix-withdraw-card" className="block text-sm font-medium">Последние 4 цифры карты</label>
              <Input id="intebix-withdraw-card" type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={cardEnding} onChange={(event) => setCardEnding(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" disabled={Boolean(processingId)} className="h-11" />
              <p className="text-xs text-muted-foreground">Выплата в сети Solana devnet.</p>
              {kzteBalance <= 0 ? <p className="text-xs text-muted-foreground">На кошельке пока нет KZTE.</p> : null}
              {!validTengeAmount && kzteBalance > 0 ? <p className="text-xs text-destructive">Укажите сумму не больше доступного баланса.</p> : null}
              {cardEnding.length > 0 && cardEnding.length !== 4 ? <p className="text-xs text-destructive">Введите последние 4 цифры карты.</p> : null}
              <Button className="w-full" onClick={() => void redeemKzte()} disabled={Boolean(processingId) || (!validTengeAmount && !pendingKzteMatches) || cardEnding.length !== 4 || Boolean(pendingKzte && !pendingKzteMatches)}>
                {processingId === "kzte" ? (progress ?? "Выводим…") : pendingKzte ? "Повторить подтверждение" : "Вывести"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </DrawerFrame>
  );
}

function WithdrawPosition({
  strategy,
  position,
  processing,
  processingLabel,
  pending,
  blocked,
  onWithdraw,
}: {
  strategy: YieldStrategy;
  position: { principal: number; earnedCarryUsd?: number; shares?: number; priceUsd?: number; valueUsd?: number };
  processing: boolean;
  processingLabel: string | null;
  pending: boolean;
  blocked: boolean;
  onWithdraw: (strategy: YieldStrategy, shares?: string) => void;
}) {
  const gateway = getGatewayInfo(strategy);
  const canRedeem = canRedeemStrategy(strategy);
  const availableShares = position.shares ?? position.principal;
  const [sharesInput, setSharesInput] = useState(displayShareAmount(availableShares));
  const requestedShares = Number(sharesInput);
  const validShares = Number.isFinite(requestedShares) && requestedShares > 0 && requestedShares <= availableShares;
  const earned = position.earnedCarryUsd ?? 0;
  const redemptionEstimate = requestedShares * (position.priceUsd ?? 1);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{strategy.name}</p>
          <p className="text-xs text-muted-foreground">{formatQuantity(availableShares)} {strategy.ticker} · {formatQuantity(position.valueUsd ?? position.principal + earned)} TEST QUOTE</p>
        </div>
        <span className="text-right text-xs tabular-nums text-muted-foreground">
          Illustrative change: {formatQuantity(earned)} TEST QUOTE
        </span>
      </div>
      <GatewayDisclosureBadges strategy={strategy} />
      <p className="text-xs leading-5 text-muted-foreground">
        DEVNET TEST-TOKEN REDEMPTION: это возврат настроенной стоимости тестовых долей, а не денежная выплата.
      </p>
      {!canRedeem ? (
        <p className="text-xs leading-5 text-destructive">
          Выход недоступен: {gateway.availabilityReason ?? "для этой стратегии не настроен подтверждённый путь TEST-TOKEN REDEMPTION."}
        </p>
      ) : null}
      <label className="space-y-1.5 text-sm">
          <span>Тестовых долей к погашению</span>
          <Input
            type="number"
            min="0.000001"
            step="0.000001"
            max={availableShares}
            inputMode="decimal"
            value={sharesInput}
            onChange={(event) => setSharesInput(event.target.value)}
            disabled={processing || pending || !canRedeem}
          />
          <span className="block text-xs text-muted-foreground">Оценка возврата: {formatQuantity(redemptionEstimate)} TEST QUOTE · NO MONETARY VALUE</span>
          {!validShares ? <span className="block text-xs text-destructive">Укажите сумму не больше доступного баланса.</span> : null}
      </label>
      <Button
        variant="outline"
        className="w-full"
            onClick={() => onWithdraw(strategy, sharesInput)}
        disabled={processing || blocked || !canRedeem || (!validShares && !pending)}
      >
        <ArrowUpFromLine />{processing ? (processingLabel ?? "Погашаем тестовые доли…") : pending ? "Повторить подтверждение" : canRedeem ? "Погасить тестовые доли" : "Выход недоступен"}
      </Button>
    </Card>
  );
}
