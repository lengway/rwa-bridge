"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isCrossmintConfigured } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { BridgeAsset } from "@/lib/assets";

type BuyResult = {
  amount: number;
  units: number;
  note?: string;
  explorerUrl?: string;
};

export function BuyAssetDrawer({
  open,
  onOpenChange,
  asset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: BridgeAsset;
}) {
  const { cashUsd, displayCurrency, buy } = useAppStore();
  const [amount, setAmount] = useState("10");
  const [processing, setProcessing] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const amountValue = Number(amount);
  const valid = Number.isFinite(amountValue) && amountValue >= 10 && amountValue <= cashUsd;
  const units = amountValue;

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setResult(null);
    if (nextOpen) setResult(null);
    onOpenChange(nextOpen);
  };

  const completePurchase = async () => {
    if (!valid || processing) return;
    setProcessing(true);
    let signature: string | undefined;
    let explorerUrl: string | undefined;
    let note: string | undefined;

    if (asset.buyFlow === "spl-demo-mint" && walletAddress) {
      try {
        const response = await fetch("/api/mint-demo-asset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipientAddress: walletAddress }),
        });
        const data = await response.json();
        if (!response.ok || !data.signature) {
          throw new Error(data.error ?? "Выпуск токена недоступен");
        }
        signature = data.signature;
        explorerUrl = data.explorer;
        note = amountValue === asset.demoPriceUsd
          ? "Демо-токен ICT-DEMO отправлен."
          : `Тестовый выпуск фиксирован: отправлено ${asset.demoPriceUsd} ICT-DEMO независимо от суммы покупки.`;
      } catch {
        note = "Токен не отправлен: демо-режим.";
      }
    } else {
      note = "Токен не отправлен: демо-режим.";
    }

    const purchased = buy(asset.id, amountValue, {
      units,
      title: asset.name,
      ...(signature ? { signature } : {}),
      ...(explorerUrl ? { explorerUrl } : {}),
      ...(note ? { note } : {}),
    });
    setProcessing(false);
    if (!purchased) return;
    setResult({ amount: amountValue, units, note, explorerUrl });
    toast.success("Покупка завершена");
  };

  return (
    <>
      {isCrossmintConfigured ? (
        <WalletAddressWatcher onAddress={setWalletAddress} />
      ) : null}
      <DrawerFrame
        open={open}
        onOpenChange={changeOpen}
        title={`Купить · ${asset.name}`}
        description="Укажите сумму в долларах. Покупка показана в демо-режиме."
      >
        {result ? (
          <DrawerSuccess
            amount={result.amount}
            currency={displayCurrency}
            sentence={`Покупка завершена: ${result.units.toLocaleString("ru-RU")} долей ${asset.ticker}.`}
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
                  max={cashUsd}
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="h-12 pr-16 text-xl font-semibold tabular-nums"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  USD
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                1 {asset.ticker} = $1 доли · {units > 0 ? units.toLocaleString("ru-RU") : "0"} долей
              </p>
              <p className="text-xs text-muted-foreground">
                ≈ {formatMoney(Number(amount) || 0, "KZT")} по демо-курсу 480 ₸ за $1.
              </p>
            </div>

            <Card className="gap-2 p-4">
              <p className="text-sm font-medium">Покупка в демо-режиме</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Сумма спишется только с демо-баланса. Доля не даёт права собственности на реальный объект.
              </p>
            </Card>
            {amountValue < 10 ? (
              <p className="text-xs text-destructive">Минимальная сумма — $10.</p>
            ) : null}
            {amountValue > cashUsd ? (
              <p className="text-xs text-destructive">На балансе недостаточно средств.</p>
            ) : null}
            <Button
              className="w-full"
              onClick={completePurchase}
              disabled={!valid || processing}
            >
              <ShoppingBag />
              {processing ? "Оформляем покупку…" : `Купить на ${formatMoney(amountValue || 0)}`}
            </Button>
            {asset.buyFlow === "spl-demo-mint" && walletAddress ? (
              <p className="text-center text-xs text-muted-foreground">
                <ArrowUpRight className="mr-1 inline size-3" />
                После покупки попробуем отправить тестовый токен.
              </p>
            ) : null}
          </div>
        )}
      </DrawerFrame>
    </>
  );
}

function WalletAddressWatcher({ onAddress }: { onAddress: (address: string | null) => void }) {
  const { wallet } = useWallet();
  useEffect(() => {
    onAddress(wallet?.address ?? null);
  }, [onAddress, wallet?.address]);
  return null;
}
