"use client";

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
            Hello{name ? `, ${name}` : ""}
          </p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Your money, working for you</p>
      </div>
    </div>
  );
}

export function BalanceCard({
  total,
  cashUsd,
  earnings,
  hydrated,
  unavailable = false,
}: {
  total: number;
  cashUsd: number;
  earnings: number;
  hydrated: boolean;
  unavailable?: boolean;
}) {
  return (
    <Card className="gap-5 rounded-2xl border-emerald-600/20 bg-card p-5 ring-1 ring-emerald-600/10 dark:border-emerald-400/20 dark:ring-emerald-400/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Estimated portfolio value</p>
          {unavailable ? <p className="mt-2 text-xl font-medium">Balance unavailable</p> : hydrated ? (
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
              ${formatQuantity(total)}
            </p>
          ) : <Skeleton className="mt-2 h-10 w-44" />}
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">USD estimate</span>
      </div>
      <div className="flex items-center justify-between gap-4 border-t pt-4 text-sm">
        <span className="text-muted-foreground">Available balance</span>
        {unavailable ? <span className="text-muted-foreground">Unavailable</span> : hydrated ? (
          <span className="font-medium tabular-nums">{formatQuantity(cashUsd)} USDC</span>
        ) : <Skeleton className="h-4 w-20" />}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Available USDC plus the estimated value of your positions. Kamino Lend has a variable rate and protocol risk.
      </p>
      {unavailable ? <p className="text-xs text-muted-foreground">The network read failed. Your wallet and positions have not been changed.</p> : hydrated && earnings !== 0 ? <p className="text-xs text-muted-foreground">Historic local earnings are not included in this summary.</p> : !hydrated ? <Skeleton className="h-4 w-40" /> : null}
    </Card>
  );
}
