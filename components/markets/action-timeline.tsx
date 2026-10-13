"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatRelative } from "@/lib/markets/format";
import { stagesFor } from "@/lib/markets/lifecycle";
import type { CorporateAction } from "@/lib/markets/service";
import { stageIndex } from "@/lib/markets/derive";
import { ChainRef } from "./primitives";

/** Six-stage (five for votes) lifecycle stepper. Vertical on small screens, horizontal from md. */
export function ActionTimeline({ action, now }: { action: CorporateAction; now: number }) {
  const stages = stagesFor(action);
  const current = stageIndex(action.status);
  const byStatus = new Map(action.transitions.map((t) => [t.status, t]));
  return (
    <ol className="grid gap-0 md:grid-flow-col md:auto-cols-fr" aria-label="Lifecycle">
      {stages.map((stage, i) => {
        const t = byStatus.get(stage.status);
        const done = !!t || stageIndex(stage.status) < current;
        const isCurrent = stage.status === action.status;
        const isNext = !done && stages.findIndex((s) => !byStatus.has(s.status)) === i;
        const last = i === stages.length - 1;
        return (
          <li key={stage.status} className="relative flex gap-3 pb-5 md:flex-col md:gap-0 md:pb-0 md:pr-3" aria-current={isCurrent ? "step" : undefined}>
            {/* connector */}
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-px md:left-6 md:top-[11px] md:h-px md:w-[calc(100%-1.5rem)]",
                  done && byStatus.has(stages[i + 1]?.status) ? "bg-emerald-500/60" : "bg-border",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors duration-300",
                done ? "border-emerald-500 bg-emerald-500 text-white dark:text-emerald-950" : isNext ? "border-foreground/60 bg-background text-foreground" : "bg-background text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : i + 1}
              {isNext ? <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full border border-foreground/30 motion-reduce:hidden" /> : null}
            </span>
            <div className="min-w-0 md:mt-3">
              <p className={cn("text-sm font-medium", !done && !isNext && "text-muted-foreground")}>
                {stage.label}
                <span className="sr-only">{done ? " (completed)" : isNext ? " (next)" : " (upcoming)"}</span>
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{stage.hint}</p>
              {t ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs">
                  <time dateTime={new Date(t.ts * 1000).toISOString()} title={formatDateTime(t.ts)} className="tabular-nums text-foreground/80">{formatDate(t.ts)}</time>
                  <ChainRef value={t.signature} kind="tx" label={`${stage.label} transaction`} size={3} />
                </div>
              ) : stage.dueTs ? (
                <p className="mt-1 text-xs tabular-nums">
                  <span className="text-foreground/80">Due {formatDate(stage.dueTs)}</span>
                  <span className="text-muted-foreground"> · {formatRelative(stage.dueTs, now)}</span>
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Announce → record → payment → deadline on one axis, with the ex-date lock window shaded and "now" marked. */
export function DateRail({ action, now }: { action: CorporateAction; now: number }) {
  const start = action.announcedTs;
  const end = Math.max(action.claimDeadlineTs, action.paymentTs + 1);
  const span = end - start;
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%`;
  const vote = action.kind === "Vote";
  const marks = [
    { ts: action.announcedTs, label: "Announced" },
    { ts: action.recordTs, label: "Record date" },
    { ts: action.paymentTs, label: vote ? "Voting closes" : "Payment date" },
    ...(vote || action.claimDeadlineTs === action.paymentTs ? [] : [{ ts: action.claimDeadlineTs, label: "Claim deadline" }]),
  ];
  const showNow = now > start && now < end;
  return (
    <div>
      <div className="relative h-2 rounded-full bg-muted" aria-hidden="true">
        <div className="absolute inset-y-0 rounded-full bg-violet-500/35" style={{ left: pos(action.recordTs), width: `calc(${pos(action.paymentTs)} - ${pos(action.recordTs)})` }} />
        {marks.map((m) => (
          <span key={m.label} className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground/70" style={{ left: pos(m.ts) }} />
        ))}
        {showNow ? (
          <span className="absolute -top-1.5 h-5 w-0.5 -translate-x-1/2 rounded-full bg-emerald-500" style={{ left: pos(now) }}>
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">now</span>
          </span>
        ) : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {marks.map((m) => (
          <div key={m.label}>
            <dt className="text-xs text-muted-foreground">{m.label}</dt>
            <dd className="mt-0.5 text-sm font-medium tabular-nums">
              <time dateTime={new Date(m.ts * 1000).toISOString()} title={formatDateTime(m.ts)}>{formatDate(m.ts)}</time>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-5 rounded-full bg-violet-500/35" aria-hidden="true" />
        Ex-date lock: bond transfers are rejected from the record date until {vote ? "voting closes" : "the payment date"}.
      </p>
    </div>
  );
}
