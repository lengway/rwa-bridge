"use client";

import Link from "next/link";
import { CircleUserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatQuantity } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";

export function AccountGreeting() {
  const { email } = useAuth();
  return <GreetingContents email={email ?? undefined} />;
}

function GreetingContents({ email }: { email?: string }) {
  const name = email?.split("@")[0];

  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-xl font-semibold tracking-tight">
            Привет{name ? `, ${name}` : ""}
          </p>
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
  hydrated,
}: {
  total: number;
  cashUsd: number;
  earnings: number;
  hydrated: boolean;
}) {
  return (
    <Card className="gap-5 rounded-2xl border-emerald-600/20 bg-card p-5 ring-1 ring-emerald-600/10 dark:border-emerald-400/20 dark:ring-emerald-400/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Тестовый баланс портфеля</p>
          {hydrated ? (
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
              {formatQuantity(total)} TEST QUOTE
            </p>
          ) : <Skeleton className="mt-2 h-10 w-44" />}
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">TEST QUOTE</span>
      </div>
      <div className="flex items-center justify-between gap-4 border-t pt-4 text-sm">
        <span className="text-muted-foreground">Доступно для Devnet-демо</span>
        {hydrated ? (
          <span className="font-medium tabular-nums">{formatQuantity(cashUsd)} TEST QUOTE</span>
        ) : <Skeleton className="h-4 w-20" />}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        DEVNET DEMO · NO MONETARY VALUE. ILLUSTRATIVE YIELD не добавляется к балансу.
      </p>
      {hydrated && earnings !== 0 ? <p className="text-xs text-muted-foreground">Показатель доходности в этом демо не учитывается.</p> : !hydrated ? <Skeleton className="h-4 w-40" /> : null}
    </Card>
  );
}
