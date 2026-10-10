"use client";

import { useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import type { BridgeAsset } from "@/lib/assets";
import { useAuth } from "@/lib/useAuth";

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
  const { wallet } = useAuth();
  return <BuyAssetDrawerContents {...props} wallet={wallet} />;
}

function BuyAssetDrawerContents({
  open,
  onOpenChange,
  asset,
  wallet,
}: BuyAssetDrawerProps & { wallet: ReturnType<typeof useAuth>["wallet"] }) {
  const { cashUsd } = useAppStore();
  const devnet = useDevnet();
  const [amount, setAmount] = useState("10");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ signature: string; amount: number } | null>(null);
  const amountValue = Number(amount);
  const maximumAmount = Math.min(cashUsd, 1000);
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
          setProgress("Подписываем Devnet-перевод TEST QUOTE…");
          const payment = await wallet!.send(devnet.treasuryOwner, devnet.usdMint, String(purchaseAmount));
          if (!payment.hash) throw new Error("Кошелёк не вернул подпись перевода.");
          signature = payment.hash;
          setPendingPayment({ signature, amount: purchaseAmount });
        }
        setProgress("Подтверждаем Devnet-перевод…");
        const requestPurchase = async () => {
          const response = await fetch("/api/devnet/buy-asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
            stage?: unknown;
          };
          if (response.ok && typeof data.signature === "string" && typeof data.explorerUrl === "string") {
            return {
              signature: data.signature,
              explorerUrl: data.explorerUrl,
              units: typeof data.units === "number" ? data.units : undefined,
            };
          }
          const message = data.stage === "verify"
            ? "Не удалось подтвердить Devnet-перевод TEST QUOTE."
            : data.stage === "mint"
              ? "Devnet-перевод подтверждён, но выпуск тестового актива пока не завершён."
              : "Не удалось подтвердить выпуск тестового актива.";
          const failure = new Error(message) as Error & { stage?: unknown };
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
          throw new Error("Devnet-перевод подтверждён, но тестовый актив ещё не выпущен. Повторите подтверждение.", { cause: lastRequestError });
        }
        const purchasedUnits = typeof data.units === "number" ? data.units : units;
        setResult({ amount: purchaseAmount, units: purchasedUnits, explorerUrl: data.explorerUrl });
        setPendingPayment(null);
        void devnet.refreshPortfolio();
        toast.success("Тестовый актив выпущен");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "";
        const visibleMessage = message === "Кошелёк не вернул подпись перевода."
          || message.startsWith("Devnet-перевод")
          || message.startsWith("Не удалось подтвердить выпуск")
          ? message
          : "Не удалось выполнить Devnet-перевод TEST QUOTE. Проверьте кошелёк и повторите подтверждение.";
        setError(visibleMessage);
        toast.error(visibleMessage);
      } finally {
        setProcessing(false);
        setProgress(null);
      }
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title={`Получить тестовый актив · ${asset.ticker}`}
      description="DEVNET DEMO · NO MONETARY VALUE. OFFICE не даёт прав на недвижимость или денежную выплату."
    >
      {result ? (
        <DrawerSuccess
          amount={result.amount}
          amountLabel={`${formatQuantity(result.units, 0)} ${asset.ticker}`}
          sentence="Тестовый актив выпущен в Solana Devnet."
          note={result.note ?? "DEVNET DEMO · NO MONETARY VALUE. OFFICE не предоставляет прав на недвижимость или денежную выплату."}
          onDone={() => changeOpen(false)}
          secondaryHref="/assets"
          secondaryLabel="К активам"
          explorerUrl={result.explorerUrl}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="buy-amount" className="font-medium">Количество TEST QUOTE</label>
              <span className="text-muted-foreground">
                Доступно {formatQuantity(cashUsd)} TEST QUOTE
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
                TEST QUOTE
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              1 {asset.ticker} = 1 TEST QUOTE · будет выпущено {units > 0 ? formatQuantity(units, 0) : "0"} {asset.ticker}
            </p>
          </div>

          <Card className="gap-2 p-4">
            <p className="text-sm font-medium">Выпуск тестового актива</p>
            <p className="text-xs leading-5 text-muted-foreground">
              После подтверждённого Devnet-перевода приложение выпустит {asset.ticker} в ваш кошелёк. Это не покупка недвижимости, не инвестиция и не денежная операция.
            </p>
          </Card>
          {amountValue < 10 ? (
            <p className="text-xs text-destructive">Минимум — 10 TEST QUOTE.</p>
          ) : null}
          {amountValue > cashUsd ? (
            <p className="text-xs text-destructive">
              Недостаточно TEST QUOTE. <a href="/home" className="underline">Подготовьте тестовые единицы</a>.
            </p>
          ) : null}
          {amountValue > 1000 ? (
            <p className="text-xs text-destructive">Максимум — 1 000 TEST QUOTE.</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {progress ? <p className="text-center text-xs text-muted-foreground">{progress}</p> : null}
          <Button className="w-full" onClick={completePurchase} disabled={(!valid && !pendingPayment) || processing}>
            <ArrowDownToLine />{processing ? (progress ?? "Выпускаем тестовый актив…") : pendingPayment ? "Повторить подтверждение" : `Получить ${formatQuantity(amountValue || 0)} ${asset.ticker}`}
          </Button>
        </div>
      )}
    </DrawerFrame>
  );
}
