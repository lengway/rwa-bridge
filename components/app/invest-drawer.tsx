"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { isCrossmintConfigured } from "@/lib/config";
import { formatApy, formatEarningsMoney, formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import type { YieldStrategy } from "@/lib/yields";
import { getStrategyApy } from "@/lib/market-data";
import { KztEstimate } from "@/components/app/kzt-estimate";
import { MarketDataNote } from "@/components/app/market-data-note";

type InvestDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: YieldStrategy;
};

export function InvestDrawer(props: InvestDrawerProps) {
  if (!isCrossmintConfigured) return <InvestDrawerContents {...props} wallet={null} />;
  return <InvestDrawerWithWallet {...props} />;
}

function InvestDrawerWithWallet(props: InvestDrawerProps) {
  const { wallet } = useWallet();
  return <InvestDrawerContents {...props} wallet={wallet ?? null} />;
}

function InvestDrawerContents({
  open,
  onOpenChange,
  strategy,
  wallet,
}: InvestDrawerProps & { wallet: ReturnType<typeof useWallet>["wallet"] | null }) {
  const { cashUsd, displayCurrency, invest, marketData, acceleratedAccrual } = useAppStore();
  const apy = getStrategyApy(strategy.id, marketData.yields);
  const apyData = strategy.id === "ondo-usdy" ? marketData.yields.usdy : marketData.yields.kaseGov;
  const devnet = useDevnet();
  const [amount, setAmount] = useState("50");
  const [accepted, setAccepted] = useState(false);
  const [success, setSuccess] = useState<{ amount: number; explorerUrl?: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const amountValue = Number(amount);
  const valid = Number.isFinite(amountValue)
    && amountValue > 0
    && amountValue <= cashUsd
    && (devnet.mode !== "devnet" || (amountValue >= 1 && amountValue <= 1000));
  const earningsMonth = Math.max(0, amountValue) * apy / 12;
  const earningsYear = Math.max(0, amountValue) * apy;

  const changeOpen = (nextOpen: boolean) => {
    setSuccess(null);
    setError(null);
    onOpenChange(nextOpen);
  };

  const handleInvest = async () => {
    if (!accepted || !valid || processing) return;
    setError(null);
    if (devnet.mode === "devnet") {
      if (!devnet.treasuryOwner) {
        setError("Сеть Solana devnet не настроена. Выполните node scripts/setup-devnet.mjs.");
        return;
      }
      if (!wallet || !devnet.walletAddress || !devnet.usdMint) {
        setError("Не удалось подключить Solana-кошелёк. Перезайдите в аккаунт.");
        return;
      }
      setProcessing(true);
      try {
        setProgress("Подписываем перевод…");
        const transaction = await wallet.send(devnet.treasuryOwner, devnet.usdMint, String(amountValue));
        const signature = transaction.hash;
        setProgress("Проверяем в сети…");
        const response = await fetch("/api/devnet/invest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: devnet.walletAddress,
            productId: strategy.id,
            amountUsd: amountValue,
            signature,
          }),
        });
        const result = await response.json() as { ok?: unknown; explorerUrl?: unknown; error?: unknown };
        if (!response.ok || result.ok !== true || typeof result.explorerUrl !== "string") {
          throw new Error(typeof result.error === "string" ? result.error : "Не удалось подтвердить перевод.");
        }
        invest(strategy.id, amountValue, { onchain: true, signature, explorerUrl: result.explorerUrl });
        setSuccess({ amount: amountValue, explorerUrl: result.explorerUrl });
        void devnet.refresh();
        toast.success("Вклад открыт");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "";
        setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось выполнить перевод. Проверьте баланс тестовых долларов и попробуйте ещё раз.");
      } finally {
        setProcessing(false);
        setProgress(null);
      }
      return;
    }

    if (!invest(strategy.id, amountValue)) return;
    setSuccess({ amount: amountValue });
    toast.success("Вклад открыт");
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title={`Вложить · ${strategy.name}`}
      description={`${strategy.ticker} · ${formatApy(apy)} годовых по указанному ориентиру`}
    >
      {success ? (
        <DrawerSuccess
          amount={success.amount}
          sentence={devnet.mode === "devnet"
            ? `Перевод тестовых долларов во вклад «${strategy.name}» подтверждён.`
            : `Вклад «${strategy.name}» открыт. Начисления показаны в демо-режиме.`}
          onDone={() => changeOpen(false)}
          secondaryHref="/home"
          secondaryLabel="Перейти к портфелю"
          explorerUrl={success.explorerUrl}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="invest-amount" className="font-medium">Сумма</label>
              <span className="text-muted-foreground">
                Доступно {formatMoney(cashUsd, displayCurrency)}
              </span>
            </div>
            <div className="relative">
              <Input
                id="invest-amount"
                type="number"
                min="1"
                max={devnet.mode === "devnet" ? Math.min(cashUsd, 1000) : cashUsd}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-12 pr-16 text-xl font-semibold tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                USD
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
              <KztEstimate usd={Number(amount) || 0} />
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setAmount(String(cashUsd))}
              >
                Вложить всё
              </Button>
              </div>
              <MarketDataNote data={apyData} />
            </div>
          </div>

          <Card className="gap-3 p-4">
            <p className="text-sm font-medium">Примерный доход</p>
            <EarningsLine label="За месяц" amount={earningsMonth} currency={displayCurrency} />
            <EarningsLine label="За год" amount={earningsYear} currency={displayCurrency} />
            <p className="text-xs text-muted-foreground">
              Расчёт по текущему ориентиру. Доход не гарантирован. {acceleratedAccrual
                ? "Ускоренный режим: 1 секунда = 1 день."
                : "Начисление идёт в реальном времени."}
            </p>
          </Card>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5">
            <Checkbox
              checked={accepted}
              onCheckedChange={(checked) => setAccepted(checked === true)}
              className="mt-0.5"
            />
            <span>Понимаю, что доход не гарантирован и это не банковский депозит.</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Не банковский вклад, не застраховано фондом гарантирования депозитов.
          </p>
          {amountValue > cashUsd ? (
            <p className="text-xs text-destructive">
              Недостаточно средств. {devnet.mode === "devnet"
                ? <Link href="/home" className="underline">Пополнить через тестовый банкомат</Link>
                : <Link href="/home" className="underline">Пополните баланс на Главной</Link>}.
            </p>
          ) : null}
          {!accepted ? (
            <p className="text-xs text-muted-foreground">Отметьте согласие с условиями, чтобы продолжить.</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {progress ? <p className="text-center text-xs text-muted-foreground">{progress}</p> : null}
          <Button className="w-full" onClick={handleInvest} disabled={!accepted || !valid || processing}>
            <ArrowDownToLine />{processing ? (progress ?? "Обрабатываем…") : `Вложить ${formatMoney(amountValue || 0)}`}
          </Button>
        </div>
      )}
    </DrawerFrame>
  );
}

function EarningsLine({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  currency: "USD" | "KZT";
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
        +{formatEarningsMoney(amount, currency)}
      </span>
    </div>
  );
}
