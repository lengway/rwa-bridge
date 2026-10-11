"use client";

import { ArrowDownToLine, ArrowUpFromLine, Building2, CreditCard } from "lucide-react";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { presentDevnetCopy } from "@/components/app/earn-detail-parts";
import { formatQuantity } from "@/lib/format";
import { useAppStore, type ActivityItem } from "@/lib/store";
import { useNow } from "@/lib/useNow";

export function ActivityScreen() {
  const { activity, hydrated } = useAppStore();
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
          <h2 className="font-semibold">No activity yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Top-ups, deposits, withdrawals, and asset purchases will appear here.
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
              <ActivityRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ActivityRow({
  item,
}: {
  item: ActivityItem;
}) {
  const isInflow = item.type === "topup" || item.type === "withdraw";
  const primary = item.title.startsWith("Kamino Lend ·");
  const Icon = item.type === "topup"
    ? CreditCard
    : item.type === "invest"
      ? ArrowDownToLine
      : item.type === "withdraw"
        ? ArrowUpFromLine
        : Building2;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(item.at);

  return (
    <Card className="flex-row items-start gap-3 rounded-2xl p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{activityTitle(item)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {time}{item.method ? ` · ${presentDevnetCopy(methodLabel(item.method))}` : ""}
        </p>
        {!primary || item.note ? <p className="mt-1 text-xs text-muted-foreground">{presentDevnetCopy(item.note ?? "Historic test-token activity")}</p> : null}
        {item.explorerUrl ? (
          <a
            href={item.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-11 items-center rounded px-2 text-xs underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            View transaction
          </a>
        ) : null}
      </div>
      <span className={`shrink-0 text-sm font-medium tabular-nums ${isInflow ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"}`}>
        {isInflow ? "+" : "−"}{formatQuantity(item.amountUsd)} {primary ? "USDC" : "TEST QUOTE"}
      </span>
    </Card>
  );
}

function methodLabel(method: string) {
  const labels: Record<string, string> = {
    "devnet-faucet": "Devnet test issuer",
    moonpay: "Legacy adapter · disabled by default",
    transak: "Legacy adapter · disabled by default",
    crossmint: "Legacy adapter · disabled by default",
    "bank-embed": "Legacy adapter · disabled by default",
  };
  return labels[method] ?? method;
}

function formatActivityDay(timestamp: number, now: number) {
  const date = new Date(timestamp);
  const today = new Date(now);
  const sameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" }).format(date);
}

function activityTitle(item: ActivityItem) {
  const title = presentDevnetCopy(item.title);
  const historicTitles: Record<string, string> = {
    "Перевод из резерва Intebix": "Transfer from Intebix reserve",
    "KZTE возвращены в резерв Intebix · обмен KZTE → $": "KZTE returned to Intebix reserve · KZTE → $ exchange",
    "Перевод из резерва Intebix · обмен $ → KZTE": "Transfer from Intebix reserve · $ → KZTE exchange",
    "KZTE возвращены в резерв Intebix · выплата в тенге": "KZTE returned to Intebix reserve · payout in KZT",
  };
  if (historicTitles[title]) return historicTitles[title];

  const typeLabels: Record<string, string> = {
    "Вклад": "Deposit",
    "Покупка доли": "Asset purchase",
    "Вывод из вклада": "Withdrawal",
    "Пополнение": "Top-up",
    "Движение долей": "Position movement",
    "Операция с активом": "Asset transaction",
  };
  return title.replace(/^(Вклад|Покупка доли|Вывод из вклада|Пополнение|Движение долей|Операция с активом)(?=\s|·|$)/, (label) => typeLabels[label] ?? label);
}
