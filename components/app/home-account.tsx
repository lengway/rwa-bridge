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
        <p className="mt-1 text-sm text-muted-foreground">Ваши активы в Solana Devnet</p>
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
          <p className="text-sm text-muted-foreground">Локальная сводка Devnet</p>
          {hydrated ? (
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
              {formatQuantity(total)} DEVNET UNITS
            </p>
          ) : <Skeleton className="mt-2 h-10 w-44" />}
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">SOLANA DEVNET</span>
      </div>
      <div className="flex items-center justify-between gap-4 border-t pt-4 text-sm">
        <span className="text-muted-foreground">Доступно в Solana Devnet</span>
        {hydrated ? (
          <span className="font-medium tabular-nums">{formatQuantity(cashUsd)} DEVNET UNITS</span>
        ) : <Skeleton className="h-4 w-20" />}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        SOLANA DEVNET · NO MONETARY VALUE. Позиция Kamino Lend использует переменную ставку протокола и отображается в карточке стратегии после подписи транзакции.
      </p>
      {hydrated && earnings !== 0 ? <p className="text-xs text-muted-foreground">Исторический локальный показатель не включён в эту сводку.</p> : !hydrated ? <Skeleton className="h-4 w-40" /> : null}
    </Card>
  );
}
