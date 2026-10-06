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
import { useAppStore } from "@/lib/store";
import { formatApy, formatMoney } from "@/lib/format";
import type { YieldStrategy } from "@/lib/yields";

export function InvestDrawer({
  open,
  onOpenChange,
  strategy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategy: YieldStrategy;
}) {
  const { cashUsd, displayCurrency, invest } = useAppStore();
  const [amount, setAmount] = useState("50");
  const [accepted, setAccepted] = useState(false);
  const [successAmount, setSuccessAmount] = useState<number | null>(null);
  const amountValue = Number(amount);
  const valid = Number.isFinite(amountValue) && amountValue > 0 && amountValue <= cashUsd;
  const earningsMonth = Math.max(0, amountValue) * strategy.demoApy / 12;
  const earningsYear = Math.max(0, amountValue) * strategy.demoApy;

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setSuccessAmount(null);
    if (nextOpen) setSuccessAmount(null);
    onOpenChange(nextOpen);
  };

  const handleInvest = () => {
    if (!accepted || !valid || !invest(strategy.id, amountValue)) return;
    setSuccessAmount(amountValue);
    toast.success("Вклад открыт");
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title={`Вложить · ${strategy.name}`}
      description={`${strategy.ticker} · ${formatApy(strategy.demoApy)} годовых по указанному ориентиру`}
    >
      {successAmount !== null ? (
        <DrawerSuccess
          amount={successAmount}
          sentence={`Вклад «${strategy.name}» открыт. Начисления показаны в демо-режиме.`}
          onDone={() => changeOpen(false)}
          secondaryHref="/home"
          secondaryLabel="Перейти к портфелю"
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
            <div className="flex justify-between">
              <p className="text-xs text-muted-foreground">
                ≈ {formatMoney(Number(amount) || 0, "KZT")} по демо-курсу 480 ₸
              </p>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setAmount(String(cashUsd))}
              >
                Вложить всё
              </Button>
            </div>
          </div>

          <Card className="gap-3 p-4">
            <p className="text-sm font-medium">Примерный доход</p>
            <EarningsLine label="За месяц" amount={earningsMonth} currency={displayCurrency} />
            <EarningsLine label="За год" amount={earningsYear} currency={displayCurrency} />
            <p className="text-xs text-muted-foreground">
              Расчёт по текущему ориентиру. Доход не гарантирован. В демо 1 секунда = 1 день.
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
              На балансе недостаточно средств. <Link href="/home" className="underline">Пополните баланс на Главной</Link>.
            </p>
          ) : null}
          {!accepted ? (
            <p className="text-xs text-muted-foreground">Отметьте согласие с условиями, чтобы продолжить.</p>
          ) : null}
          <Button className="w-full" onClick={handleInvest} disabled={!accepted || !valid}>
            <ArrowDownToLine />Вложить {formatMoney(amountValue || 0)}
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
        +{formatMoney(amount, currency)}
      </span>
    </div>
  );
}
