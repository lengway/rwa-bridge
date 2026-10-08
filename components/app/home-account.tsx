"use client";

import Link from "next/link";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { ChartNoAxesCombined, CircleUserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isCrossmintConfigured } from "@/lib/config";
import { formatEarningsMoney, formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { MarketDataNote } from "@/components/app/market-data-note";

export function AccountGreeting() {
  if (!isCrossmintConfigured) return <GreetingContents />;
  return <GreetingWithAccount />;
}

function GreetingWithAccount() {
  const { user, status } = useCrossmintAuth();
  const { wallet } = useWallet();
  const loggedIn = status === "logged-in" && Boolean(user?.email && wallet?.address);
  return <GreetingContents email={user?.email} loggedIn={loggedIn} />;
}

function GreetingContents({ email, loggedIn = false }: { email?: string; loggedIn?: boolean }) {
  const name = email?.split("@")[0];

  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xl font-semibold tracking-tight">
            Привет{name ? `, ${name}` : ""}
          </p>
          {!loggedIn ? <Badge variant="secondary">Демо</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Ваш капитал в одном месте</p>
      </div>
      <Button
        variant="ghost"
        size="icon-lg"
        nativeButton={false}
        render={<Link href="/portfolio" />}
        aria-label="Открыть профиль"
        className="rounded-full"
      >
        <CircleUserRound />
      </Button>
    </div>
  );
}

export function BalanceCard({
  total,
  cashUsd,
  earnings,
  currency,
  hydrated,
  onCurrencyChange,
  mode,
}: {
  total: number;
  cashUsd: number;
  earnings: number;
  currency: "USD" | "KZT";
  hydrated: boolean;
  onCurrencyChange: (currency: "USD" | "KZT") => void;
  mode: "devnet" | "demo";
}) {
  const { marketData, acceleratedAccrual } = useAppStore();
  return (
    <Card className="gap-5 rounded-2xl border-emerald-600/20 bg-card p-5 ring-1 ring-emerald-600/10 dark:border-emerald-400/20 dark:ring-emerald-400/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Общая стоимость</p>
          {hydrated ? (
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
              {formatMoney(total, currency)}
            </p>
          ) : <Skeleton className="mt-2 h-10 w-44" />}
          <Badge variant={mode === "devnet" ? "outline" : "secondary"} className="mt-2">
            {mode === "devnet" ? "Тестовая сеть Solana" : "Демо"}
          </Badge>
        </div>
        <div
          role="group"
          aria-label="Валюта отображения"
          className="flex rounded-full bg-muted p-1"
        >
          {(["USD", "KZT"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={value === currency ? "default" : "ghost"}
              className="h-7 rounded-full px-3 text-xs"
              aria-label={`Показать в ${value}`}
              aria-pressed={value === currency}
              onClick={() => onCurrencyChange(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t pt-4 text-sm">
        <span className="text-muted-foreground">Доступно</span>
        {hydrated ? (
          <span className="font-medium tabular-nums">{formatMoney(cashUsd, currency)}</span>
        ) : <Skeleton className="h-4 w-20" />}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        В пересчёте в тенге — по курсу НБ РК.
      </p>
      <MarketDataNote
        data={marketData.availability.rate ? marketData.rate : null}
        loadingText="Загружаем курс…"
      />
      {hydrated && earnings !== 0 ? (
        <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <ChartNoAxesCombined className="size-4" />
          <span>+{formatEarningsMoney(earnings, currency)} доход за всё время</span>
          {acceleratedAccrual ? <Badge variant="outline">Ускоренный режим</Badge> : null}
        </div>
      ) : !hydrated ? <Skeleton className="h-4 w-40" /> : null}
    </Card>
  );
}
