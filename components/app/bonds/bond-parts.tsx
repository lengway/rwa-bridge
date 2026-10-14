"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, ExternalLink, Info, Minus, Plus, ShieldCheck, Vote } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBps, formatDate, formatDateTime, formatSettlement } from "@/lib/markets/format";
import type { BondActionView, BondOffering, BondPayment, BondPosition, BondVote, CalendarEntry } from "@/lib/markets/investor";
import { devnetTxUrl, refreshBonds, requestAllocation } from "@/lib/useBonds";
import { cn } from "@/lib/utils";

const unitsLabel = (n: string | number) => `${n} unit${String(n) === "1" ? "" : "s"}`;

export const money = (amount: string | bigint, decimals: number, symbol: string) => formatSettlement(typeof amount === "bigint" ? amount : BigInt(amount), decimals, symbol);

/** Estimates (accrued coupon) shown to the cent, rounded down. */
export const moneyCents = (amount: string, decimals: number, symbol: string) => {
  const unit = BigInt(10) ** BigInt(Math.max(0, decimals - 2));
  return formatSettlement((BigInt(amount) / unit) * unit, decimals, symbol);
};

const FREQUENCY: Record<number, string> = { 1: "Annual", 2: "Semi-annual", 4: "Quarterly", 12: "Monthly" };
export const frequencyLabel = (f: number) => FREQUENCY[f] ?? `${f}× a year`;

export function TestFundsNote({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 text-xs leading-5 text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children ?? "Solana devnet test tokens. No real money is paid or received."}</span>
    </p>
  );
}

export function SectionTitle({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">{title}</h2>
      {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
    </div>
  );
}

export function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-semibold tabular-nums">{value}</dd>
      {sub ? <dd className="mt-0.5 text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

export function YieldFigure({ offering, size = "lg" }: { offering: BondOffering; size?: "lg" | "sm" }) {
  return (
    <div>
      <p className={cn("font-semibold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400", size === "lg" ? "text-3xl" : "text-xl")}>
        {formatBps(offering.couponBps)}
      </p>
      <p className="text-xs text-muted-foreground">
        Coupon · {offering.ytmBps != null ? `${formatBps(offering.ytmBps)} yield to maturity at par` : "yield unavailable"}
      </p>
    </div>
  );
}

export function TermsGrid({ offering }: { offering: BondOffering }) {
  const d = offering.settlementDecimals;
  const s = offering.settlementSymbol;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
      <Fact label="Face value" value={money(offering.faceValue, d, s)} sub="per unit" />
      <Fact label="Coupon" value={formatBps(offering.couponBps)} sub={`${frequencyLabel(offering.frequency)} · ${money(offering.couponPerUnit, d, s)} per unit`} />
      <Fact label="Yield to maturity" value={offering.ytmBps != null ? formatBps(offering.ytmBps) : "—"} sub={`At par, compounded ${offering.frequency}× a year`} />
      <Fact label="Next coupon" value={offering.nextCouponTs ? formatDate(offering.nextCouponTs) : "—"} sub={`${offering.couponCount} coupons in total`} />
      <Fact label="Maturity" value={formatDate(offering.maturityTs)} sub={`Issued ${formatDate(offering.issueTs)}`} />
      <Fact label="Settlement" value={`Test ${s}`} sub="Solana devnet token" />
    </dl>
  );
}

// ---- allocation -------------------------------------------------------------------------------------

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `alloc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AllocationButton({ offering, heldUnits, className }: { offering: BondOffering; heldUnits: bigint; className?: string }) {
  const [open, setOpen] = useState(false);
  const room = Math.max(0, offering.allocation.capUnits - Number(heldUnits));
  const max = Math.min(offering.allocation.maxPerRequest, room);
  const disabled = !offering.allocation.open || max < 1;
  return (
    <>
      <Button className={className} size="lg" disabled={disabled} onClick={() => setOpen(true)}>
        Get allocation
      </Button>
      {disabled ? (
        <p className="text-xs text-muted-foreground">{!offering.allocation.open ? offering.allocation.reason : `You hold the maximum of ${offering.allocation.capUnits} units.`}</p>
      ) : null}
      {open ? <AllocationDrawer offering={offering} max={max} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AllocationDrawer({ offering, max, onClose }: { offering: BondOffering; max: number; onClose: () => void }) {
  const [units, setUnits] = useState(1);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ signature: string; units: string } | null>(null);
  const d = offering.settlementDecimals;
  const s = offering.settlementSymbol;
  const n = BigInt(units);

  const change = (next: number) => {
    setUnits(Math.min(max, Math.max(1, next)));
    // A different request needs a new idempotency key.
    setKey(newKey());
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const receipt = await requestAllocation(offering.mint, units, key);
      setDone({ signature: receipt.signature, units: receipt.units });
      toast.success(`${unitsLabel(receipt.units)} of ${offering.symbol} in your wallet`);
      void refreshBonds();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The allocation didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DrawerFrame open onOpenChange={(o) => !o && !busy && onClose()} title={`Get ${offering.symbol}`} description={offering.name}>
      {done ? (
        <div className="space-y-4 py-2 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Check className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">{unitsLabel(done.units)} issued to your wallet</p>
            <p className="mt-1 text-sm text-muted-foreground">The issuer signed the issue transaction on Solana devnet. Coupons will be paid to this wallet automatically.</p>
          </div>
          <a href={devnetTxUrl(done.signature)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm underline underline-offset-4">
            View transaction <ExternalLink className="size-3.5" />
          </a>
          <Button className="w-full" size="lg" variant="outline" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border p-4">
            <div>
              <p className="text-sm font-medium">Units</p>
              <p className="text-xs text-muted-foreground">Up to {max} now · {money(offering.faceValue, d, s)} face each</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Fewer units" disabled={busy || units <= 1} onClick={() => change(units - 1)}><Minus /></Button>
              <output aria-live="polite" className="w-10 text-center text-xl font-semibold tabular-nums">{units}</output>
              <Button variant="outline" size="icon" aria-label="More units" disabled={busy || units >= max} onClick={() => change(units + 1)}><Plus /></Button>
            </div>
          </div>
          <dl className="space-y-2 text-sm">
            <Row label="Face value" value={money(n * BigInt(offering.faceValue), d, s)} />
            <Row label={`Coupon every ${offering.frequency === 12 ? "month" : offering.frequency === 4 ? "quarter" : offering.frequency === 2 ? "six months" : "year"}`} value={money(n * BigInt(offering.couponPerUnit), d, s)} />
            <Row label="Yield to maturity" value={offering.ytmBps != null ? formatBps(offering.ytmBps) : "—"} />
            <Row label="Next coupon date" value={offering.nextCouponTs ? formatDate(offering.nextCouponTs) : "—"} />
            <Row label="You pay" value="Nothing (test allocation)" />
          </dl>
          <TestFundsNote>Devnet test allocation: no payment is taken. The issuer issues test bond units to your Plain wallet on Solana devnet, and coupons arrive in a test USD token.</TestFundsNote>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" size="lg" disabled={busy} onClick={() => void submit()}>
            {busy ? "Issuing on Solana devnet…" : `Get ${units} unit${units === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </DrawerFrame>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

// ---- positions, calendar, payments --------------------------------------------------------------------

export function PositionFacts({ position }: { position: BondPosition }) {
  const d = position.settlementDecimals;
  const s = position.settlementSymbol;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
      <Fact label="Units" value={position.units} />
      <Fact label="Face value" value={money(position.faceValue, d, s)} />
      <Fact label="Accrued coupon" value={moneyCents(position.accrued, d, s)} sub="Estimate for the current period" />
      <Fact label="Next coupon" value={money(position.nextCouponAmount, d, s)} sub={position.nextCouponTs ? `Expected ${formatDate(position.nextCouponTs)}` : undefined} />
    </dl>
  );
}

const CAL_LABEL: Record<CalendarEntry["kind"], string> = { record: "Record date", payment: "Payment", "vote-close": "Vote closes", scheduled: "Scheduled" };

export function CouponCalendar({ entries, limit, showSymbol }: { entries: CalendarEntry[]; limit?: number; showSymbol?: boolean }) {
  const shown = limit ? entries.slice(0, limit) : entries;
  if (!shown.length) return <p className="text-sm text-muted-foreground">No upcoming dates.</p>;
  return (
    <ol className="divide-y">
      {shown.map((e) => (
        <li key={`${e.mint}:${e.kind}:${e.ts}:${e.actionId ?? ""}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", e.kind === "scheduled" ? "bg-muted text-muted-foreground" : "bg-sky-500/10 text-sky-700 dark:text-sky-300")}>
            <CalendarClock className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{showSymbol ? `${e.symbol} · ` : ""}{e.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {CAL_LABEL[e.kind]} · {e.kind === "scheduled" ? formatDate(e.ts) : formatDateTime(e.ts)}
              {e.kind === "scheduled" ? " · not announced yet" : ""}
            </p>
          </div>
          {e.amount ? <span className="shrink-0 text-sm font-medium tabular-nums">{money(e.amount, e.settlementDecimals, e.settlementSymbol)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function PaymentLinks({ payment }: { payment: Pick<BondPayment, "explorerUrl" | "verifyUrl"> }) {
  return (
    <span className="mt-1 flex flex-wrap gap-x-1">
      {payment.explorerUrl ? (
        <a href={payment.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Transaction <ExternalLink className="size-3" />
        </a>
      ) : null}
      <Link href={payment.verifyUrl} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ShieldCheck className="size-3" /> Verify
      </Link>
    </span>
  );
}

const MODE: Record<BondPayment["mode"], string> = { push: "Paid by the paying agent", claim: "Claimed" };

export function paymentLabel(p: BondPayment) {
  return p.kind === "Coupon" ? "Coupon received" : p.kind === "FinalRedemption" ? "Bond redeemed" : "Partial redemption";
}

export function PaymentList({ payments }: { payments: BondPayment[] }) {
  if (!payments.length) return <p className="text-sm text-muted-foreground">No payments yet. Coupons appear here once the paying agent pays them.</p>;
  return (
    <ul className="divide-y">
      {payments.map((p) => (
        <li key={`${p.actionId}:${p.signature}`} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.symbol} · {p.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(p.ts)} · {p.units} units · {MODE[p.mode]}</p>
            <PaymentLinks payment={p} />
          </div>
          <span className="shrink-0 text-sm font-medium tabular-nums text-emerald-700 dark:text-emerald-400">+{money(p.amount, p.settlementDecimals, p.settlementSymbol)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- votes -----------------------------------------------------------------------------------------

export function VoteCard({ vote }: { vote: BondVote }) {
  const tally = vote.tally?.map((t) => BigInt(t)) ?? null;
  const total = tally?.reduce((a, b) => a + b, BigInt(0)) ?? BigInt(0);
  return (
    <Card className="gap-3 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300">
          <Vote className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{vote.symbol} · Bondholder vote</p>
            <Badge variant={vote.open ? "secondary" : "outline"}>{vote.open ? (vote.status === "Announced" || vote.status === "RecordLocked" ? "Upcoming" : "Open") : "Closed"}</Badge>
          </div>
          <p className="mt-1 text-sm">{vote.question}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Record date {formatDateTime(vote.recordTs)} · {vote.open ? "closes" : "closed"} {formatDateTime(vote.closesTs)}
          </p>
        </div>
      </div>
      {tally ? (
        <ul className="space-y-1.5">
          {vote.options.map((o, i) => (
            <li key={o} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className={cn(vote.winningOption === i && "font-semibold")}>{o}{vote.winningOption === i ? " · carried" : ""}{vote.choice === i ? " · your vote" : ""}</span>
                <span className="tabular-nums text-muted-foreground">{tally[i]?.toString() ?? "0"} units</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-violet-500/70" style={{ width: total > BigInt(0) ? `${Number((tally[i] ?? BigInt(0)) * BigInt(1000) / total) / 10}%` : "0%" }} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {vote.weight ? `Your voting weight: ${vote.weight} units from the record-date snapshot.` : "Your weight is fixed by your units at the record date."}{" "}
        Voting from Plain needs a wallet signature, which is coming next. For now you can follow the tally here.
      </p>
      <Link href={vote.verifyUrl} className="inline-flex min-h-11 items-center gap-1 self-start rounded text-xs underline underline-offset-4">
        <ShieldCheck className="size-3" /> Verify the tally
      </Link>
    </Card>
  );
}

// ---- corporate actions ------------------------------------------------------------------------------

const STAGES = ["Announced", "RecordLocked", "SnapshotPosted", "Funded", "Settling", "Settled"] as const;

function stageName(kind: BondActionView["kind"], s: (typeof STAGES)[number] | "Cancelled") {
  if (kind === "Vote") return ({ Announced: "Announced", RecordLocked: "Register locked", SnapshotPosted: "Voting open", Funded: "Funded", Settling: "Votes cast", Settled: "Closed", Cancelled: "Cancelled" } as const)[s];
  return ({ Announced: "Announced", RecordLocked: "Register locked", SnapshotPosted: "Snapshot posted", Funded: "Funded", Settling: "Paying", Settled: "Settled", Cancelled: "Cancelled" } as const)[s];
}

export function ActionStatusBadge({ action }: { action: Pick<BondActionView, "kind" | "status"> }) {
  const done = action.status === "Settled";
  return <Badge variant={done ? "outline" : "secondary"}>{stageName(action.kind, action.status)}</Badge>;
}

export function ActionCard({ action, offering }: { action: BondActionView; offering: BondOffering }) {
  const stages = STAGES.filter((s) => !(action.kind === "Vote" && s === "Funded"));
  const reached = new Map(action.transitions.map((t) => [t.status, t]));
  const current = stages.indexOf(action.status as (typeof STAGES)[number]);
  const d = offering.settlementDecimals;
  const s = offering.settlementSymbol;
  return (
    <Card className="gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{action.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Record {formatDateTime(action.recordTs)} · {action.kind === "Vote" ? "closes" : "pays"} {formatDateTime(action.paymentTs)}
          </p>
        </div>
        <ActionStatusBadge action={action} />
      </div>
      <ol className="grid gap-2 sm:grid-cols-3" aria-label="Status timeline">
        {stages.map((stage, i) => {
          const t = reached.get(stage);
          const done = current >= i || action.status === "Settled";
          return (
            <li key={stage} className="flex items-start gap-2 text-xs">
              <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", done ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500" : "border-muted-foreground/40")}>
                {done ? <Check className="size-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className={cn("block", done ? "font-medium" : "text-muted-foreground")}>{stageName(action.kind, stage)}</span>
                {t?.ts ? (
                  t.explorerUrl ? (
                    <a href={t.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-2">{formatDateTime(t.ts)}</a>
                  ) : (
                    <span className="text-muted-foreground">{formatDateTime(t.ts)}</span>
                  )
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="space-y-1 border-t pt-3 text-sm">
        {action.mine ? (
          action.kind === "Vote" ? (
            <p>Your voting weight: <span className="font-medium tabular-nums">{action.mine.units} units</span></p>
          ) : action.mine.payment ? (
            <p className="text-emerald-700 dark:text-emerald-400">
              You received <span className="font-medium tabular-nums">{money(action.mine.payment.amount, d, s)}</span> for {action.mine.units} units.
            </p>
          ) : (
            <p>
              Your entitlement: <span className="font-medium tabular-nums">{money(action.mine.amount, d, s)}</span> for {action.mine.units} units
              {action.status === "Funded" || action.status === "Settling" ? ", paying now." : ", paid on the payment date."}
            </p>
          )
        ) : (
          <p className="text-muted-foreground">
            {action.status === "Announced" || action.status === "RecordLocked"
              ? "Units you hold at the record date are included."
              : "Your wallet was not in this record-date snapshot."}
          </p>
        )}
        <div className="flex flex-wrap gap-x-1">
          {action.mine?.payment?.explorerUrl ? (
            <a href={action.mine.payment.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded text-xs underline underline-offset-4">
              Payment transaction <ExternalLink className="size-3" />
            </a>
          ) : null}
          <Link href={action.verifyUrl} className="ml-auto inline-flex min-h-11 items-center gap-1 rounded text-xs underline underline-offset-4">
            <ShieldCheck className="size-3" /> Verify on-chain
          </Link>
        </div>
      </div>
    </Card>
  );
}
