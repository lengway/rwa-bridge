"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import type { YieldStrategy } from "@/lib/yields";
import { useAuth } from "@/lib/useAuth";
import {
  GatewayDisclosureBadges,
  canInvestInStrategy,
  getGatewayInfo,
} from "@/components/app/earn-detail-parts";

type InvestDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: YieldStrategy;
};

export function InvestDrawer(props: InvestDrawerProps) {
  const { wallet } = useAuth();
  return <InvestDrawerContents {...props} wallet={wallet} />;
}

function InvestDrawerContents({
  open,
  onOpenChange,
  strategy,
  wallet,
}: InvestDrawerProps & { wallet: ReturnType<typeof useAuth>["wallet"] }) {
  const { cashUsd } = useAppStore();
  const gateway = getGatewayInfo(strategy);
  const canInvest = canInvestInStrategy(strategy);
  const apyBps = gateway.yield.apyBps;
  const hasIllustrativeApy = gateway.yieldKind === "ILLUSTRATIVE"
    && typeof apyBps === "number"
    && Number.isFinite(apyBps);
  const apy = hasIllustrativeApy ? apyBps / 10_000 : Number.NaN;
  const devnet = useDevnet();
  const [amount, setAmount] = useState("50");
  const [accepted, setAccepted] = useState(false);
  const [success, setSuccess] = useState<{ amount: number; shares?: number; shareTicker?: string; explorerUrl?: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const amountValue = Number(amount);
  const canonicalAmount = canonicalDecimalAmount(amount);
  const valid = canInvest
    && Number.isFinite(amountValue)
    && amountValue > 0
    && amountValue <= cashUsd
    && amountValue >= 1
    && amountValue <= 1000
    && canonicalAmount !== null;
  const illustrativeMonth = hasIllustrativeApy ? Math.max(0, amountValue) * apy / 12 : Number.NaN;
  const illustrativeYear = hasIllustrativeApy ? Math.max(0, amountValue) * apy : Number.NaN;

  const changeOpen = (nextOpen: boolean) => {
    setSuccess(null);
    setError(null);
    onOpenChange(nextOpen);
  };

  const handleInvest = async () => {
    if (!canInvest) {
      setError("Эта стратегия недоступна для нового Devnet-пополнения.");
      return;
    }
    if (!accepted || (!valid && !pendingSignature) || processing) return;
    if (!canonicalAmount) {
      setError("Укажите сумму тестовых единиц в корректном десятичном формате.");
      return;
    }
    setError(null);
    if (!devnet.treasuryOwner) {
      setError("Сеть Solana Devnet не настроена. Выполните node scripts/setup-devnet.mjs.");
      return;
    }
    if (!devnet.walletAddress || !devnet.usdMint || (!wallet && !pendingSignature)) {
      setError("Не удалось подключить Solana-кошелёк. Перезайдите в аккаунт.");
      return;
    }
    setProcessing(true);
    try {
      let signature = pendingSignature;
      if (!signature) {
        setProgress("Подписываем перевод тестового токена…");
        const transaction = await wallet!.send(devnet.treasuryOwner, devnet.usdMint, canonicalAmount);
        if (!transaction.hash) throw new Error("Кошелёк не вернул подпись перевода.");
        signature = transaction.hash;
        setPendingSignature(signature);
      }
      setProgress("Подтверждаем тестовый перевод в Devnet…");
      const response = await fetch("/api/devnet/invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: devnet.walletAddress,
          productId: strategy.id,
          amount: canonicalAmount,
          amountUsd: amountValue,
          signature,
        }),
      });
      const result = await response.json() as {
        ok?: unknown;
        sharesMinted?: unknown;
        mintSignature?: unknown;
        explorerUrl?: unknown;
        error?: unknown;
      };
      if (!response.ok || result.ok !== true || typeof result.explorerUrl !== "string"
        || typeof result.sharesMinted !== "number" || typeof result.mintSignature !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось подтвердить тестовый перевод.");
      }
      setSuccess({ amount: amountValue, shares: result.sharesMinted, shareTicker: strategy.ticker, explorerUrl: result.explorerUrl });
      setPendingSignature(null);
      void devnet.refreshPortfolio();
      toast.success("Тестовые доли выпущены в Solana Devnet");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось подтвердить тестовый перевод. Проверьте соединение и повторите подтверждение.");
    } finally {
      setProcessing(false);
      setProgress(null);
    }
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title={`Devnet-демо · ${strategy.name}`}
      description="SIMULATED FUNDING · тестовые токены и доли не имеют денежной стоимости."
    >
      {!canInvest ? (
        <Card className="gap-3 rounded-2xl p-4">
          <GatewayDisclosureBadges strategy={strategy} includeAvailability />
          <div>
            <p className="font-medium">Пополнение недоступно</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Эта исследовательская карточка не поддерживает новые действия. Мы не подготовим перевод или выпуск долей,
              пока совместимая Devnet-стратегия не будет подтверждена.
            </p>
          </div>
        </Card>
      ) : success ? (
        <DrawerSuccess
          amount={success.amount}
          amountLabel={`${formatQuantity(success.shares ?? Number.NaN)} ${success.shareTicker ?? "тестовых долей"}`}
          sentence="Подтверждён перевод тестового токена в Solana Devnet; тестовые доли выпущены в кошелёк."
          note="ILLUSTRATIVE YIELD не начисляется на эту операцию. NO MONETARY VALUE."
          onDone={() => changeOpen(false)}
          secondaryHref="/home"
          secondaryLabel="Перейти к тестовому портфелю"
          explorerUrl={success.explorerUrl}
        />
      ) : (
        <div className="space-y-5">
          <GatewayDisclosureBadges strategy={strategy} />
          <p className="text-xs leading-5 text-muted-foreground">
            SIMULATED FUNDING: доступный баланс и сумма ниже — только тестовые единицы. NO MONETARY VALUE.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="invest-amount" className="font-medium">Сумма тестовых единиц</label>
              <span className="text-muted-foreground">
                Доступно {formatQuantity(cashUsd)} TEST QUOTE
              </span>
            </div>
            <div className="relative">
              <Input
                id="invest-amount"
                type="number"
                min="1"
                max={Math.min(cashUsd, 1000)}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={processing || Boolean(pendingSignature)}
                className="h-12 pr-28 text-xl font-semibold tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                TEST QUOTE
              </span>
            </div>
            <div className="flex items-start justify-end">
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setAmount(String(cashUsd))}
                disabled={processing || Boolean(pendingSignature)}
              >
                Использовать все тестовые единицы
              </Button>
            </div>
          </div>

          <Card className="gap-3 p-4">
            <p className="text-sm font-medium">Иллюстративный результат</p>
            {hasIllustrativeApy ? (
              <>
                <IllustrativeLine label="Пример за месяц" amount={illustrativeMonth} />
                <IllustrativeLine label="Пример за год" amount={illustrativeYear} />
              </>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">Числовая иллюстративная ставка не задана, поэтому пример не рассчитывается.</p>
            )}
            <p className="text-xs text-muted-foreground">
              ILLUSTRATIVE YIELD: он не является фактическим доходом и не начисляется на тестовые доли.
            </p>
            <p className="text-xs text-muted-foreground">{gateway.yield.sourceNote}</p>
            <p className="text-xs text-muted-foreground">Источник / режим: {gateway.sourceLabel}.</p>
          </Card>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5">
            <Checkbox
              checked={accepted}
              onCheckedChange={(checked) => setAccepted(checked === true)}
              className="mt-0.5"
            />
            <span>Понимаю: это DEVNET DEMO, SIMULATED FUNDING и NO MONETARY VALUE; доходность только иллюстративна.</span>
          </label>
          {amountValue > cashUsd ? (
            <p className="text-xs text-destructive">
              Недостаточно тестовых единиц. <Link href="/home" className="underline">Подготовьте демо-баланс на Главной</Link>.
            </p>
          ) : null}
          {!accepted ? (
            <p className="text-xs text-muted-foreground">Отметьте согласие с условиями демо, чтобы продолжить.</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {progress ? <p className="text-center text-xs text-muted-foreground">{progress}</p> : null}
          <Button className="w-full" onClick={handleInvest} disabled={!accepted || (!valid && !pendingSignature) || processing}>
            <ArrowDownToLine />{processing ? (progress ?? "Обрабатываем…") : pendingSignature ? "Повторить подтверждение" : "Подтвердить тестовый перевод"}
          </Button>
        </div>
      )}
    </DrawerFrame>
  );
}

function IllustrativeLine({
  label,
  amount,
}: {
  label: string;
  amount: number;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
        +{formatQuantity(amount)} TEST QUOTE
      </span>
    </div>
  );
}

function canonicalDecimalAmount(value: string): string | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction] = normalized.split(".");
  if (fraction === undefined) return whole;
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}
