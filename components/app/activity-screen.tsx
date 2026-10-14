"use client";

import { ArrowDownToLine, ArrowUpFromLine, Building2, CreditCard, Landmark } from "lucide-react";
import { PaymentLinks, money, paymentLabel } from "@/components/app/bonds/bond-parts";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { presentDevnetCopy } from "@/components/app/earn-detail-parts";
import { formatQuantity } from "@/lib/format";
import { useAppStore, type ActivityItem } from "@/lib/store";
import { useNow } from "@/lib/useNow";
import type { BondPayment } from "@/lib/markets/investor";
import { useBondsOverview } from "@/lib/useBonds";

export function ActivityScreen() {
  const { activity, hydrated } = useAppStore();
  const bonds = useBondsOverview();
  const bondPayments = bonds.data?.available ? bonds.data.payments : [];
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

  // Bond payments come from the chain (receipts of the paying agent), not from the local store.
  const rows: Row[] = [
    ...activity.map((item) => ({ key: item.id, at: item.at, item })),
    ...bondPayments.map((payment) => ({ key: `bond:${payment.actionId}`, at: payment.ts * 1000, payment })),
  ].sort((a, b) => b.at - a.at);
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const day = formatActivityDay(row.at, now);
    const group = grouped.get(day) ?? [];
    group.push(row);
    grouped.set(day, group);
  }

  if (rows.length === 0) {
    return (
      <Card className="items-center gap-3 rounded-2xl p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Activity className="size-5 text-muted-foreground" />
        </span>
        <div>
          <h2 className="font-semibold">No activity yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Top-ups, deposits, withdrawals, asset purchases and bond coupons will appear here.
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
            {items.map((row) => ("item" in row ? <ActivityRow key={row.key} item={row.item} /> : <BondPaymentRow key={row.key} payment={row.payment} />))}
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
        {item.note ? <p className="mt-1 text-xs text-muted-foreground">{presentDevnetCopy(item.note)}</p> : null}
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
        {isInflow ? "+" : "−"}{formatQuantity(item.amountUsd)} {primary ? "USDC" : "test units"}
      </span>
    </Card>
  );
}

type Row = { key: string; at: number } & ({ item: ActivityItem } | { payment: BondPayment });

function BondPaymentRow({ payment }: { payment: BondPayment }) {
  const time = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(payment.ts * 1000);
  return (
    <Card className="flex-row items-start gap-3 rounded-2xl p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
        <Landmark className="size-4 text-amber-700 dark:text-amber-300" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{paymentLabel(payment)} · {payment.symbol}</p>
        <p className="mt-1 text-xs text-muted-foreground">{time} · {payment.title} · {payment.units} units · test {payment.settlementSymbol}</p>
        <PaymentLinks payment={payment} />
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
        +{money(payment.amount, payment.settlementDecimals, payment.settlementSymbol)}
      </span>
    </Card>
  );
}

function methodLabel(method: string) {
  const labels: Record<string, string> = {
    "devnet-faucet": "Test issuer",
    moonpay: "MoonPay · past",
    transak: "Transak · past",
    crossmint: "Crossmint · past",
    "bank-embed": "Partner embed · past",
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
    "Transfer from the Intebix reserve": "Transfer from Intebix reserve",
    "KZTE returned to the Intebix reserve · exchange KZTE → $": "KZTE returned to Intebix reserve · KZTE → $ exchange",
    "Transfer from the Intebix reserve · exchange $ → KZTE": "Transfer from Intebix reserve · $ → KZTE exchange",
    "KZTE returned to the Intebix reserve · payout in tenge": "KZTE returned to Intebix reserve · payout in KZT",
  };
  if (historicTitles[title]) return historicTitles[title];

  const typeLabels: Record<string, string> = {
    "Deposit": "Deposit",
    "Share purchase": "Asset purchase",
    "Withdrawal from deposit": "Withdrawal",
    "Top-up": "Top-up",
    "Share movement": "Position movement",
    "Asset operation": "Asset transaction",
  };
  return title.replace(/^(Deposit|Share purchase|Withdrawal from deposit|Top-up|Share movement|Asset operation)(?=\s|·|$)/, (label) => typeLabels[label] ?? label);
}
