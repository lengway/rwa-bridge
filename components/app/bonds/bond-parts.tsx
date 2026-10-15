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
import type { BondActionView, BondOffering, BondPayment, BondPosition, BondVote, CalendarEntry, NextCoupon, SettlementBalance } from "@/lib/markets/investor";
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

export function YieldFigure({ offering, size = "lg" }: { offering: BondOffering; size?: "lg" | "md" }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className={cn("font-semibold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400", size === "lg" ? "text-5xl" : "text-3xl")}>
          {formatBps(offering.couponBps)}
        </p>
        <p className="text-sm text-muted-foreground">coupon</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {offering.ytmBps != null ? `${formatBps(offering.ytmBps)} yield to maturity at par` : "Yield unavailable"} · {frequencyLabel(offering.frequency).toLowerCase()} payments
      </p>
    </div>
  );
}

/** "14 Oct 2026" plus whether the issuer has announced it or it only follows the terms' calendar. */
export function nextCouponHint(next: NextCoupon | null, total?: number) {
  if (!next) return { date: "—", hint: "No coupons left" };
  const of = total ? ` of ${total}` : "";
  return next.source === "announced"
    ? { date: formatDate(next.ts), hint: `Coupon ${next.period}${of} · announced` }
    : { date: formatDate(next.ts), hint: `Coupon ${next.period}${of} · scheduled` };
}

export function TermsGrid({ offering }: { offering: BondOffering }) {
  const d = offering.settlementDecimals;
  const s = offering.settlementSymbol;
  const next = nextCouponHint(offering.nextCoupon, offering.couponCount);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
      <Fact label="Face value" value={money(offering.faceValue, d, s)} sub="Per unit" />
      <Fact label="Coupon" value={`${money(offering.couponPerUnit, d, s)}`} sub={`Per unit, ${frequencyLabel(offering.frequency).toLowerCase()}`} />
      <Fact label="Yield to maturity" value={offering.ytmBps != null ? formatBps(offering.ytmBps) : "—"} sub={`At par, compounded ${offering.frequency}× a year`} />
      <Fact label="Next coupon" value={next.date} sub={next.hint} />
      <Fact label="Maturity" value={formatDate(offering.maturityTs)} sub={`Issued ${formatDate(offering.issueTs)}`} />
      <Fact label="Settlement" value={`Test ${s}`} sub="Solana devnet token" />
    </dl>
  );
}

// ---- allocation -------------------------------------------------------------------------------------

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `alloc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Why "Get allocation" is unavailable for this wallet, or null when it is available. */
export function allocationBlock(offering: BondOffering, heldUnits: bigint) {
  const room = Math.max(0, offering.allocation.capUnits - Number(heldUnits));
  const max = Math.min(offering.allocation.maxPerRequest, room);
  if (!offering.allocation.open) return { max, reason: offering.allocation.reason ?? "Allocations are paused." };
  if (max < 1) return { max, reason: `You hold the maximum of ${offering.allocation.capUnits} units.` };
  return { max, reason: null };
}

/** The "Get allocation" button and its drawer. The reason it is disabled is rendered by the caller. */
export function AllocationButton({ offering, heldUnits, className, size = "lg", label = "Get allocation" }: { offering: BondOffering; heldUnits: bigint; className?: string; size?: "lg" | "sm"; label?: string }) {
  const [open, setOpen] = useState(false);
  const { max, reason } = allocationBlock(offering, heldUnits);
  return (
    <>
      <Button className={cn(size === "lg" ? "h-11 px-5" : "h-9 px-3", className)} disabled={reason != null} onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
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

export function PositionCard({ position, received, cash }: { position: BondPosition; received: bigint; cash: SettlementBalance | null }) {
  const d = position.settlementDecimals;
  const s = position.settlementSymbol;
  const next = nextCouponHint(position.nextCoupon);
  return (
    <Card className="gap-5 rounded-2xl p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">You hold</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{unitsLabel(position.units)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Face value</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{money(position.faceValue, d, s)}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 border-t pt-4 sm:grid-cols-3">
        <Fact label="Next coupon" value={position.nextCoupon ? money(position.nextCouponAmount, d, s) : "—"} sub={position.nextCoupon ? `${next.date} · ${position.nextCoupon.source === "announced" ? "announced" : "scheduled"}` : next.hint} />
        <Fact label="Accrued coupon" value={moneyCents(position.accrued, d, s)} sub="Estimate, current period" />
        <Fact label="Coupons received" value={money(received, d, s)} sub={cash ? `Test ${cash.symbol} in wallet: ${money(cash.amount, cash.decimals, cash.symbol)}` : undefined} />
      </dl>
    </Card>
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
    <span className="-ml-2.5 mt-1 flex flex-wrap">
      {payment.explorerUrl ? (
        <a href={payment.explorerUrl} target="_blank" rel="noopener noreferrer" className={ghostLink}>
          <ExternalLink className="size-3.5" /> Transaction
        </a>
      ) : null}
      <Link href={payment.verifyUrl} className={ghostLink}>
        <ShieldCheck className="size-3.5" /> Verify
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
      <Link href={vote.verifyUrl} className={cn(ghostLink, "-ml-2.5 self-start")}>
        <ShieldCheck className="size-3.5" /> Verify the tally
      </Link>
    </Card>
  );
}

// ---- corporate actions ------------------------------------------------------------------------------

const STAGES = ["Announced", "RecordLocked", "SnapshotPosted", "Funded", "Settling", "Settled"] as const;
type Stage = (typeof STAGES)[number];

function stageName(kind: BondActionView["kind"], s: Stage | "Cancelled") {
  if (kind === "Vote") return ({ Announced: "Announced", RecordLocked: "Register locked", SnapshotPosted: "Voting open", Funded: "Funded", Settling: "Votes cast", Settled: "Closed", Cancelled: "Cancelled" } as const)[s];
  return ({ Announced: "Announced", RecordLocked: "Register locked", SnapshotPosted: "Snapshot posted", Funded: "Funded", Settling: "Paying", Settled: "Settled", Cancelled: "Cancelled" } as const)[s];
}

export function ActionStatusBadge({ action }: { action: Pick<BondActionView, "kind" | "status"> }) {
  const done = action.status === "Settled";
  return <Badge variant={done ? "outline" : "secondary"} className="shrink-0">{stageName(action.kind, action.status)}</Badge>;
}

const shortDateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/**
 * Six-step status stepper: vertical on phones, horizontal from the desktop breakpoint. Each step is
 * an icon, a label and a muted UTC date; the transaction opens from a small icon next to the date.
 */
export function ActionStepper({ action }: { action: BondActionView }) {
  const stages = STAGES.filter((s) => !(action.kind === "Vote" && s === "Funded"));
  const reached = new Map(action.transitions.map((t) => [t.status, t]));
  const settled = action.status === "Settled";
  const current = settled ? stages.length : stages.indexOf(action.status as Stage);
  return (
    <ol aria-label="Status" className={cn("flex flex-col lg:grid", stages.length === 6 ? "lg:grid-cols-6" : "lg:grid-cols-5")}>
      {stages.map((stage, i) => {
        const t = reached.get(stage);
        const done = i <= current;
        const isCurrent = i === current && !settled;
        const last = i === stages.length - 1;
        return (
          <li key={stage} className="relative flex items-center gap-3 pb-3 last:pb-0 lg:flex-col lg:items-start lg:gap-2 lg:pb-0 lg:pr-2">
            {!last ? (
              <span aria-hidden="true" className={cn("absolute left-[9px] top-[22px] bottom-[1px] w-px lg:left-7 lg:right-1 lg:top-[9px] lg:bottom-auto lg:h-px lg:w-auto", i < current ? "bg-emerald-600/60 dark:bg-emerald-500/60" : "bg-border")} />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-[19px] shrink-0 items-center justify-center rounded-full",
                done && !isCurrent ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950" : isCurrent ? "bg-background ring-2 ring-emerald-600 dark:ring-emerald-500" : "bg-background ring-1 ring-border",
              )}
            >
              {done && !isCurrent ? <Check className="size-3" strokeWidth={3} /> : isCurrent ? <span className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500" /> : null}
            </span>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2 leading-tight lg:block">
              <p className={cn("text-xs", done ? "font-medium text-foreground" : "text-muted-foreground")}>{stageName(action.kind, stage)}</p>
              {t?.ts ? (
                <p className="flex h-5 items-center gap-1 text-[11px] tabular-nums text-muted-foreground lg:mt-0.5">
                  <span>{shortDateTime.format(t.ts * 1000)}</span>
                  {t.explorerUrl ? (
                    <a
                      href={t.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${stageName(action.kind, stage)} transaction on Solana Explorer`}
                      title="View transaction"
                      className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    <span aria-hidden="true" className="size-5 lg:hidden" />
                  )}
                </p>
              ) : (
                <p className="flex h-5 items-center text-[11px] text-muted-foreground/70 lg:mt-0.5">{isCurrent ? "In progress" : "Pending"}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function InlineNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function ActionOutcome({ action, offering }: { action: BondActionView; offering: BondOffering }) {
  const d = offering.settlementDecimals;
  const s = offering.settlementSymbol;
  const mine = action.mine;
  if (!mine) {
    return (
      <InlineNote>
        {action.status === "Announced" || action.status === "RecordLocked" ? "Units you hold at the record date are included." : "Your wallet was not in this record-date snapshot."}
      </InlineNote>
    );
  }
  if (action.kind === "Vote") return <p className="text-sm">Your voting weight <span className="font-medium tabular-nums">{unitsLabel(mine.units)}</span></p>;
  if (mine.payment) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">You received </span>
        <span className="font-medium tabular-nums text-emerald-700 dark:text-emerald-400">{money(mine.payment.amount, d, s)}</span>
        <span className="text-muted-foreground"> for {unitsLabel(mine.units)}</span>
      </p>
    );
  }
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Your entitlement </span>
      <span className="font-medium tabular-nums">{money(mine.amount, d, s)}</span>
      <span className="text-muted-foreground"> for {unitsLabel(mine.units)}{action.status === "Funded" || action.status === "Settling" ? " · paying now" : ""}</span>
    </p>
  );
}

const ghostLink = "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ActionCard({ action, offering }: { action: BondActionView; offering: BondOffering }) {
  return (
    <Card className="gap-5 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{action.title}</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            <span className="whitespace-nowrap">Record {shortDateTime.format(action.recordTs * 1000)}</span> ·{" "}
            <span className="whitespace-nowrap">{action.kind === "Vote" ? "closes" : "pays"} {shortDateTime.format(action.paymentTs * 1000)} UTC</span>
          </p>
        </div>
        <ActionStatusBadge action={action} />
      </div>
      <ActionStepper action={action} />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-4">
        <div className="min-w-0 flex-1">
          <ActionOutcome action={action} offering={offering} />
        </div>
        <div className="-mr-2.5 flex items-center">
          {action.mine?.payment?.explorerUrl ? (
            <a href={action.mine.payment.explorerUrl} target="_blank" rel="noopener noreferrer" className={ghostLink}>
              <ExternalLink className="size-3.5" /> Payment
            </a>
          ) : null}
          <Link href={action.verifyUrl} className={ghostLink}>
            <ShieldCheck className="size-3.5" /> Verify
          </Link>
        </div>
      </div>
    </Card>
  );
}
