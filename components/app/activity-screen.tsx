"use client";

import { ArrowDownToLine, ArrowUpFromLine, Building2, CreditCard } from "lucide-react";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatActivityDay, formatMoney } from "@/lib/format";
import { useAppStore, type ActivityItem } from "@/lib/store";
import { useNow } from "@/lib/useNow";

export function ActivityScreen() {
  const { activity, displayCurrency, hydrated } = useAppStore();
  const now = useNow();

  if (!hydrated || now === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }

  const grouped = new Map<string, ActivityItem[]>();
  for (const item of activity) {
    const day = formatActivityDay(item.at, now);
    const group = grouped.get(day) ?? [];
    group.push(item);
    grouped.set(day, group);
  }

  if (activity.length === 0) {
    return (
      <Card className="items-center gap-3 rounded-2xl p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Activity className="size-5 text-muted-foreground" />
        </span>
        <div>
          <h2 className="font-semibold">Пока нет операций</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Пополнения, вклады, выводы и покупки появятся здесь.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {[...grouped.entries()].map(([day, items]) => (
        <section key={day} className="space-y-2">
          <h2 className="px-1 text-sm font-semibold text-muted-foreground">{day}</h2>
          <div className="space-y-2">
            {items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                currency={displayCurrency}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ActivityRow({
  item,
  currency,
}: {
  item: ActivityItem;
  currency: "USD" | "KZT";
}) {
  const isInflow = item.type === "topup" || (item.type === "withdraw" && item.title.startsWith("Вывод:"));
  const Icon = item.type === "topup"
    ? CreditCard
    : item.type === "invest"
      ? ArrowDownToLine
      : item.type === "withdraw"
        ? ArrowUpFromLine
        : Building2;
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(item.at);

  return (
    <Card className="flex-row items-start gap-3 rounded-2xl p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {time}{item.method ? ` · ${methodLabel(item.method)}` : ""}
        </p>
        {item.note ? <p className="mt-1 text-xs text-muted-foreground">{item.note}</p> : null}
        {item.explorerUrl ? (
          <a
            href={item.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex text-xs underline underline-offset-4"
          >
            Открыть подтверждение
          </a>
        ) : null}
      </div>
      <span className={`shrink-0 text-sm font-medium tabular-nums ${isInflow ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`}>
        {isInflow ? "+" : "−"}{formatMoney(item.amountUsd, currency)}
      </span>
    </Card>
  );
}

function methodLabel(method: string) {
  const labels: Record<string, string> = {
    "devnet-faucet": "Кран",
    moonpay: "Карта · MoonPay",
    transak: "Карта · Transak",
    crossmint: "Карта · Crossmint",
    "bank-embed": "Со счёта в банке",
  };
  return labels[method] ?? method;
}
