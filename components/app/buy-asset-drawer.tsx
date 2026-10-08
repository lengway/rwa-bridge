"use client";

import { useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isCrossmintConfigured } from "@/lib/config";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import type { BridgeAsset } from "@/lib/assets";
import { KztEstimate } from "@/components/app/kzt-estimate";

type BuyAssetDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: BridgeAsset;
};

type BuyResult = {
  amount: number;
  units: number;
  note?: string;
  explorerUrl?: string;
};

export function BuyAssetDrawer(props: BuyAssetDrawerProps) {
  if (!isCrossmintConfigured) return <BuyAssetDrawerContents {...props} wallet={null} jwt={null} />;
  return <BuyAssetDrawerWithWallet {...props} />;
}

function BuyAssetDrawerWithWallet(props: BuyAssetDrawerProps) {
  const { jwt } = useCrossmintAuth();
  const { wallet } = useWallet();
  return <BuyAssetDrawerContents {...props} wallet={wallet ?? null} jwt={jwt ?? null} />;
}

function BuyAssetDrawerContents({
  open,
  onOpenChange,
  asset,
  wallet,
  jwt,
}: BuyAssetDrawerProps & { wallet: ReturnType<typeof useWallet>["wallet"] | null; jwt: string | null }) {
  const { cashUsd, displayCurrency, buy } = useAppStore();
  const devnet = useDevnet();
  const [amount, setAmount] = useState("10");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ signature: string; amount: number } | null>(null);
  const amountValue = Number(amount);
  const maximumAmount = devnet.mode === "devnet" ? Math.min(cashUsd, 1000) : cashUsd;
  const valid = Number.isFinite(amountValue) && amountValue >= 10 && amountValue <= maximumAmount;
  const purchaseAmount = pendingPayment?.amount ?? amountValue;
  const units = purchaseAmount;

  const changeOpen = (nextOpen: boolean) => {
    setResult(null);
    setError(null);
    onOpenChange(nextOpen);
  };

  const completePurchase = async () => {
    if ((!valid && !pendingPayment) || processing) return;
    setProcessing(true);
    setError(null);

    if (devnet.mode === "devnet") {
      if (!devnet.treasuryOwner) {
        const message = "Сеть Solana devnet не настроена. Выполните node scripts/setup-devnet.mjs.";
        setError(message);
        toast.error(message);
        setProcessing(false);
        return;
      }
      if ((!wallet && !pendingPayment) || !devnet.walletAddress || !devnet.usdMint) {
        const message = "Не удалось подключить Solana-кошелёк. Перезайдите в аккаунт.";
        setError(message);
        toast.error(message);
        setProcessing(false);
        return;
      }
      try {
        let signature = pendingPayment?.signature;
        if (!signature) {
          setProgress("Подписываем перевод…");
          const payment = await wallet!.send(devnet.treasuryOwner, devnet.usdMint, String(purchaseAmount));
          if (!payment.hash) throw new Error("Кошелёк не вернул подпись перевода.");
          signature = payment.hash;
          setPendingPayment({ signature, amount: purchaseAmount });
        }
        setProgress("Подтверждаем в сети…");
        const requestPurchase = async () => {
          const response = await fetch("/api/devnet/buy-asset", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
            body: JSON.stringify({
              walletAddress: devnet.walletAddress,
              assetId: asset.id,
              amountUsd: purchaseAmount,
              signature,
            }),
          });
          const data = await response.json() as {
            signature?: unknown;
            explorerUrl?: unknown;
            units?: unknown;
            error?: unknown;
            stage?: unknown;
          };
          if (response.ok && typeof data.signature === "string" && typeof data.explorerUrl === "string") {
            return {
              signature: data.signature,
              explorerUrl: data.explorerUrl,
              units: typeof data.units === "number" ? data.units : undefined,
            };
          }
          const failure = new Error(typeof data.error === "string" ? data.error : "Не удалось подтвердить покупку.") as Error & { stage?: unknown };
          failure.stage = data.stage;
          throw failure;
        };

        let data: Awaited<ReturnType<typeof requestPurchase>> | null = null;
        let lastRequestError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            data = await requestPurchase();
            break;
          } catch (requestError) {
            lastRequestError = requestError;
            const stage = (requestError as { stage?: unknown }).stage;
            if (stage !== "mint" && stage !== undefined) throw requestError;
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
          }
        }
        if (!data) {
          throw new Error("Оплата прошла, но доля не выдана. Мы повторим автоматически.", { cause: lastRequestError });
        }
        const purchasedUnits = typeof data.units === "number" ? data.units : units;
        setResult({ amount: purchaseAmount, units: purchasedUnits, explorerUrl: data.explorerUrl });
        setPendingPayment(null);
        void devnet.refreshPortfolio();
        toast.success("Покупка завершена");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "";
        const visibleMessage = /[А-Яа-яЁё]/.test(message)
          ? message
          : "Не удалось подтвердить покупку. Проверьте соединение и повторите подтверждение.";
        setError(visibleMessage);
        toast.error(visibleMessage);
      } finally {
        setProcessing(false);
        setProgress(null);
      }
      return;
    }

    const purchased = buy(asset.id, amountValue, {
      units,
      title: asset.name,
      note: "Демо: перевод не отправлен",
    });
    setProcessing(false);
    if (!purchased) return;
    setResult({ amount: amountValue, units, note: "Демо: перевод не отправлен" });
    toast.success("Покупка завершена");
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title={`Купить · ${asset.name}`}
      description={devnet.mode === "devnet"
        ? "Оплата тестовыми долларами в Solana devnet."
        : "Укажите сумму в долларах. Покупка показана в демо-режиме."}
    >
      {result ? (
        <DrawerSuccess
          amount={result.amount}
          currency={displayCurrency}
          sentence={`Покупка завершена: ${formatQuantity(result.units, 0)} долей ${asset.ticker}.`}
          note={result.note}
          onDone={() => changeOpen(false)}
          secondaryHref="/assets"
          secondaryLabel="К активам"
          explorerUrl={result.explorerUrl}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="buy-amount" className="font-medium">Сумма покупки</label>
              <span className="text-muted-foreground">
                Доступно {formatMoney(cashUsd, displayCurrency)}
              </span>
            </div>
            <div className="relative">
              <Input
                id="buy-amount"
                type="number"
                min="10"
                max={maximumAmount}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={processing || Boolean(pendingPayment)}
                className="h-12 pr-16 text-xl font-semibold tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                USD
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              1 {asset.ticker} = $1 доли · {units > 0 ? formatQuantity(units, 0) : "0"} долей
            </p>
            <KztEstimate usd={Number(amount) || 0} />
          </div>

          <Card className="gap-2 p-4">
            <p className="text-sm font-medium">{devnet.mode === "devnet" ? "Покупка в Solana devnet" : "Покупка в демо-режиме"}</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {devnet.mode === "devnet"
                ? "Тестовые доллары поступят в казначейство, а OFFICE-DEMO будет выпущен в ваш кошелёк."
                : "Сумма спишется только с демо-баланса. Доля не даёт права собственности на реальный объект."}
            </p>
          </Card>
          {amountValue < 10 ? (
            <p className="text-xs text-destructive">Минимальная сумма — $10.</p>
          ) : null}
          {amountValue > cashUsd ? (
            <p className="text-xs text-destructive">
              Недостаточно средств. {devnet.mode === "devnet"
                ? <a href="/home" className="underline">Пополнить через тестовый банкомат</a>
                : "Пополните демо-баланс."}
            </p>
          ) : null}
          {devnet.mode === "devnet" && amountValue > 1000 ? (
            <p className="text-xs text-destructive">Максимальная сумма — $1 000.</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {progress ? <p className="text-center text-xs text-muted-foreground">{progress}</p> : null}
          <Button className="w-full" onClick={completePurchase} disabled={(!valid && !pendingPayment) || processing}>
            <ShoppingBag />{processing ? (progress ?? "Оформляем покупку…") : pendingPayment ? "Повторить подтверждение" : `Купить на ${formatMoney(amountValue || 0)}`}
          </Button>
          {devnet.mode !== "devnet" && asset.buyFlow === "spl-demo-mint" ? (
            <p className="text-center text-xs text-muted-foreground">
              <ArrowUpRight className="mr-1 inline size-3" />
              Демо-режим не отправляет токены в кошелёк.
            </p>
          ) : null}
        </div>
      )}
    </DrawerFrame>
  );
}
