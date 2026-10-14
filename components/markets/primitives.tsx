"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check, CircleDashed, Copy, Landmark, Percent, Vote, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddress } from "@/lib/markets/format";
import type { ActionKind, ActionStatus, CheckStatus } from "@/lib/markets/service";
import { useMarkets } from "./markets-provider";

export const focusRing = "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function Panel({ className, children, ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={cn("rounded-3xl border bg-card text-card-foreground", className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, description, actions, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <h2 id={id} className="font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium uppercase tracking-wider text-muted-foreground", className)}>{children}</p>;
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-base font-semibold tabular-nums tracking-tight">{value}</dd>
      {sub ? <dd className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

const STATUS_TONE: Record<ActionStatus, string> = {
  Announced: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20",
  RecordLocked: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20",
  SnapshotPosted: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-indigo-500/20",
  Funded: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
  Settling: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
  Settled: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  Cancelled: "bg-muted text-muted-foreground ring-border",
};

export function StatusPill({ status, label, className }: { status: ActionStatus; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", STATUS_TONE[status], className)}>
      {status === "Settled" ? <Check className="size-3" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {label}
    </span>
  );
}

const KIND_ICON: Record<ActionKind, typeof Landmark> = {
  Coupon: Percent,
  PartialRedemption: Undo2,
  FinalRedemption: Landmark,
  Vote: Vote,
};

export function KindIcon({ kind, className }: { kind: ActionKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground", className)}>
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_400);
        } catch {
          setCopied(false);
        }
      }}
      className={cn("inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", focusRing, className)}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
    >
      {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

/** Address or signature with copy, and an explorer link when the ledger has one. */
export function ChainRef({ value, kind, label, size = 4, className }: { value: string; kind: "address" | "tx"; label: string; size?: number; className?: string }) {
  const svc = useMarkets();
  const url = kind === "tx" ? svc.explorerTxUrl(value) : svc.explorerAddressUrl(value);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-0.5", className)}>
      <span className="truncate font-mono text-xs text-muted-foreground" title={value}>{shortAddress(value, size)}</span>
      <CopyButton value={value} label={label} />
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={cn("inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", focusRing)}>
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Open {label} in Solana Explorer (new tab)</span>
        </a>
      ) : null}
    </span>
  );
}

export function CheckIcon({ status, className }: { status: CheckStatus; className?: string }) {
  if (status === "pass") {
    return (
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", className)}>
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        <span className="sr-only">Passed</span>
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-600 dark:text-red-400", className)}>
        <span aria-hidden="true" className="text-sm font-bold leading-none">×</span>
        <span className="sr-only">Failed</span>
      </span>
    );
  }
  return (
    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", className)}>
      <CircleDashed className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Pending</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-xl bg-muted motion-reduce:animate-none", className)} />;
}

export function ErrorNote({ error }: { error: Error }) {
  return (
    <p role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">
      {error.message}
    </p>
  );
}

export const pillButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border bg-background px-3.5 text-sm font-medium transition-[background-color,transform,opacity] hover:bg-muted active:translate-y-px disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none " +
  focusRing;

export const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,transform,box-shadow,opacity] hover:bg-primary/85 hover:shadow-md active:translate-y-px disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none " +
  focusRing;

/** Marks a register row that belongs to a Plain retail investor (email sign-in, smart wallet). */
export function PlainInvestorBadge({ className }: { className?: string }) {
  return (
    <span
      title="Retail investor who signed in to Plain with email. Units sit in their Plain smart wallet; coupons are pushed by the paying agent."
      className={cn("inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300", className)}
    >
      Plain investor
    </span>
  );
}
