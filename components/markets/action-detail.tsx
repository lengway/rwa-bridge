"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Clock, Download, Loader2, ShieldCheck, Signature } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { entitlementsCsv, downloadText } from "@/lib/markets/csv";
import { formatDate, formatDateTime, formatRelative, formatSettlement, formatShare, formatUnits, isoDate } from "@/lib/markets/format";
import { KIND_LABEL, nextStep, stageLabel, type NextStep } from "@/lib/markets/lifecycle";
import { isPaymentAction } from "@/lib/markets/math";
import type { CorporateAction, EntitlementRow, EntitlementSheet, Instrument, TxResult } from "@/lib/markets/service";
import { useLedgerQuery, useMarkets } from "./markets-provider";
import { ActionTimeline, DateRail } from "./action-timeline";
import { EntitlementTable } from "./entitlement-table";
import { ChainRef, ErrorNote, KindIcon, Panel, Skeleton, Stat, StatusPill, pillButton, primaryButton } from "./primitives";

export function ActionDetail({ action, instrument, now }: { action: CorporateAction; instrument: Instrument; now: number }) {
  const sheetQuery = useLedgerQuery(`sheet:${action.id}`, (svc) => svc.getEntitlements(action.id));
  const sheet = sheetQuery.data ?? null;
  const step = nextStep(action, instrument, sheet);
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);

  return (
    <div className="space-y-4">
      <Panel aria-labelledby={`action-${action.seq}-title`}>
        <div className="flex flex-col gap-4 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-6">
          <div className="flex min-w-0 gap-3">
            <KindIcon kind={action.kind} className="size-11 rounded-2xl" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                Action #{action.seq} · {KIND_LABEL[action.kind]}
              </p>
              <h2 id={`action-${action.seq}-title`} className="mt-0.5 text-lg font-semibold tracking-tight text-balance">{action.title}</h2>
              <ChainRef value={action.id} kind="address" label="action account" className="mt-0.5" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill status={action.status} label={stageLabel(action)} />
            <Link href={`/verify/${action.id}`} className={pillButton}>
              <ShieldCheck className="size-4" aria-hidden="true" /> Verify
            </Link>
          </div>
        </div>

        <div className="px-5 pt-6 sm:px-6">
          <DateRail action={action} now={now} />
        </div>

        <div className="mt-6 border-t px-5 py-5 sm:px-6">
          <ActionTimeline action={action} now={now} />
        </div>

        <NextStepBar action={action} instrument={instrument} sheet={sheet} step={step} now={now} />
      </Panel>

      <Figures action={action} instrument={instrument} sheet={sheet} money={money} />

      <Panel aria-labelledby={`ent-${action.seq}`}>
        <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h3 id={`ent-${action.seq}`} className="font-semibold tracking-tight">{action.kind === "Vote" ? "Voting register" : "Entitlements"}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {sheet?.source === "snapshot"
                ? `From the record-date snapshot (slot ${action.snapshotSlot?.toLocaleString("en-US")}). Amounts recomputed from the terms.`
                : "Preview from the live register. Final figures are fixed when the snapshot is posted at the record date."}
            </p>
          </div>
          {sheet ? (
            <button
              type="button"
              className={pillButton}
              onClick={() => downloadText(`${instrument.symbol}-action-${action.seq}-${isoDate(action.paymentTs)}.csv`, entitlementsCsv(instrument, action, sheet))}
            >
              <Download className="size-4" aria-hidden="true" /> Export CSV
            </button>
          ) : null}
        </div>
        {sheetQuery.error ? (
          <div className="p-5"><ErrorNote error={sheetQuery.error} /></div>
        ) : sheet ? (
          <EntitlementTable
            instrument={instrument}
            params={action.params}
            sheet={sheet}
            caption={`Per-holder ${action.kind === "Vote" ? "voting weights" : "entitlements"} for action ${action.seq}`}
            rowAction={isPaymentAction(action.params) && (action.status === "Funded" || action.status === "Settling") ? (row) => <PayRowButton action={action} row={row} now={now} /> : undefined}
          />
        ) : (
          <div className="space-y-2 p-5 sm:p-6">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-11" />)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Figures({ action, instrument, sheet, money }: { action: CorporateAction; instrument: Instrument; sheet: EntitlementSheet | null; money: (v: bigint) => string }) {
  if (action.params.kind === "Vote") {
    const options = action.params.options;
    const tally = action.tally ?? options.map(() => BigInt(0));
    const cast = tally.reduce((n, t) => n + t, BigInt(0));
    const total = action.totalUnits ?? sheet?.totalUnits ?? BigInt(0);
    return (
      <Panel className="px-5 py-5 sm:px-6">
        <h3 className="font-semibold tracking-tight">Tally</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {formatUnits(cast)} of {formatUnits(total)} units voted ({formatShare(cast, total || BigInt(1))} turnout). Weight equals snapshot units.
        </p>
        <ul className="mt-4 space-y-3">
          {options.map((o, i) => (
            <li key={o}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{o}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatUnits(tally[i])} units · {formatShare(tally[i], total || BigInt(1))}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none", i === 0 ? "bg-emerald-500" : i === 1 ? "bg-red-500/80" : "bg-foreground/40")} style={{ width: total ? `${Number((tally[i] * BigInt(10_000)) / total) / 100}%` : "0%" }} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }
  const projected = sheet?.totalAmount ?? null;
  const onchain = action.totalEntitlement;
  const residue = onchain != null && projected != null ? onchain - projected : null;
  const owed = sheet ? sheet.rows.filter((r) => r.amount > BigInt(0)).length : null;
  const params = action.params;
  return (
    <Panel className="px-5 py-5 sm:px-6">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
        <Stat
          label={params.kind === "Coupon" ? "Coupon per unit" : "Payout per unit"}
          value={sheet ? money(sheet.perUnit) : "—"}
          sub={
            params.kind === "Coupon"
              ? `${params.couponBps / 100}% ÷ ${instrument.frequency} on ${money(instrument.faceValue)}`
              : params.kind === "PartialRedemption"
                ? `${params.redeemBps / 100}% of each holding at ${params.priceBps / 100}% of face`
                : `${params.priceBps / 100}% of face${params.includeCoupon ? " + last coupon" : ""}`
          }
        />
        <Stat label="Total entitlement" value={onchain != null ? money(onchain) : projected != null ? money(projected) : "—"} sub={onchain != null ? "On-chain, from total units" : "Projected from live register"} />
        <Stat
          label="Paying vault"
          value={money(action.fundedAmount)}
          sub={action.fundedAmount > BigInt(0) ? `Funded · ${money(action.fundedAmount - action.paidAmount)} remaining` : "Not funded yet"}
        />
        <Stat label="Paid" value={`${money(action.paidAmount)}`} sub={owed != null ? `${action.paidCount} of ${owed} holders${residue && residue > BigInt(0) ? ` · ${money(residue)} rounding residue` : ""}` : undefined} />
      </dl>
      {owed ? (
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Holders paid" aria-valuemin={0} aria-valuemax={owed} aria-valuenow={action.paidCount}>
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${(action.paidCount / owed) * 100}%` }} />
        </div>
      ) : null}
    </Panel>
  );
}

function NextStepBar({ action, instrument, sheet, step, now }: { action: CorporateAction; instrument: Instrument; sheet: EntitlementSheet | null; step: NextStep | null; now: number }) {
  // The dialog keeps the step it was opened for, so its confirmation survives the action moving on.
  const [opened, setOpened] = useState<NextStep | null>(null);
  const dialog = opened ? <ConfirmStep open onOpenChange={(o) => !o && setOpened(null)} action={action} instrument={instrument} sheet={sheet} step={opened} /> : null;
  if (!step) {
    const settledAt = action.transitions.at(-1)?.ts;
    return (
      <div className="flex items-center gap-3 rounded-b-3xl border-t bg-emerald-500/5 px-5 py-4 text-sm sm:px-6">
        <ShieldCheck className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <p>
          {action.kind === "Vote" ? "Tallied" : "Settled"}{settledAt ? ` ${formatDate(settledAt)}` : ""}. Nothing left to do —{" "}
          <Link href={`/verify/${action.id}`} className="font-medium underline underline-offset-4">anyone can re-derive it</Link>.
        </p>
        {dialog}
      </div>
    );
  }
  const waiting = step.opensAt != null && now < step.opensAt;
  return (
    <div className="flex flex-col gap-3 rounded-b-3xl border-t bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0 text-sm">
        <p className="font-medium">Next: {step.label}</p>
        <p className="mt-0.5 text-muted-foreground">
          {waiting ? (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" /> The program accepts this from {formatDateTime(step.opensAt!)} ({formatRelative(step.opensAt!, now)}).
            </span>
          ) : (
            <>Signed by the {step.signer.toLowerCase()}.</>
          )}
        </p>
      </div>
      <button type="button" className={cn(primaryButton, "whitespace-nowrap")} disabled={waiting || !!step.blocked} onClick={() => setOpened(step)}>
        {step.label.split(" · ")[0]} <ArrowRight className="size-4" aria-hidden="true" />
      </button>
      {dialog}
    </div>
  );
}

type RunState = { phase: "idle" } | { phase: "running"; done: number; total: number } | { phase: "done"; results: TxResult[] } | { phase: "error"; error: Error; results: TxResult[] };

function ConfirmStep({ open, onOpenChange, action, instrument, sheet, step }: { open: boolean; onOpenChange: (o: boolean) => void; action: CorporateAction; instrument: Instrument; sheet: EntitlementSheet | null; step: NextStep }) {
  const svc = useMarkets();
  const [run, setRun] = useState<RunState>({ phase: "idle" });
  const busy = run.phase === "running";

  const execute = async () => {
    const results: TxResult[] = [];
    try {
      if (step.op === "payAll") {
        const unpaid = (sheet?.rows ?? []).filter((r) => r.amount > BigInt(0) && !r.receipt);
        setRun({ phase: "running", done: 0, total: unpaid.length });
        for (const [i, r] of unpaid.entries()) {
          results.push(await svc.pay(action.id, r.holder));
          setRun({ phase: "running", done: i + 1, total: unpaid.length });
        }
      } else {
        setRun({ phase: "running", done: 0, total: 1 });
        results.push(await svc[step.op](action.id));
      }
      setRun({ phase: "done", results });
    } catch (error) {
      setRun({ phase: "error", error: error instanceof Error ? error : new Error(String(error)), results });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight">{step.label}</DialogTitle>
          <DialogDescription>
            {action.title} · {instrument.symbol}. Signed by the {step.signer.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        {run.phase === "done" ? (
          <div className="space-y-3" aria-live="polite">
            <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="size-5" aria-hidden="true" /> Confirmed {run.results.length > 1 ? `· ${run.results.length} transactions` : ""}
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-2xl border p-2">
              {run.results.map((r) => (
                <li key={r.signature} className="flex items-center justify-between gap-2 px-2 text-xs">
                  <span className="tabular-nums text-muted-foreground">Slot {r.slot.toLocaleString("en-US")}</span>
                  <ChainRef value={r.signature} kind="tx" label="transaction signature" size={6} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2.5 text-sm">
              {step.effects.map((e) => (
                <li key={e} className="flex gap-2.5">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/50" aria-hidden="true" />
                  <span className="leading-6 text-foreground/90">{e}</span>
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/50 p-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Program</dt>
                <dd><ChainRef value={instrument.programId} kind="address" label="program id" /></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Action account</dt>
                <dd><ChainRef value={action.id} kind="address" label="action account" /></dd>
              </div>
              {step.op === "fund" || step.op === "payAll" ? (
                <div>
                  <dt className="text-muted-foreground">Paying vault</dt>
                  <dd><ChainRef value={instrument.payingVault} kind="address" label="paying vault" /></dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Signer</dt>
                <dd><ChainRef value={step.signer === "Paying agent" ? instrument.payingAgent : instrument.issuer} kind="address" label="signer" /></dd>
              </div>
            </dl>
            {run.phase === "running" ? (
              <div aria-live="polite" className="space-y-2">
                <p className="flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {run.total > 1 ? `Sending ${Math.min(run.done + 1, run.total)} of ${run.total}…` : "Sending and waiting for confirmation…"}
                </p>
                {run.total > 1 ? (
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${(run.done / run.total) * 100}%` }} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {run.phase === "error" ? (
              <div className="space-y-2">
                <ErrorNote error={run.error} />
                {run.results.length ? <p className="text-xs text-muted-foreground">{run.results.length} transaction(s) confirmed before the error; they remain valid.</p> : null}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {run.phase === "done" ? (
            <button type="button" className={primaryButton} onClick={() => onOpenChange(false)}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className={pillButton} disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </button>
              <button type="button" className={primaryButton} disabled={busy} onClick={execute}>
                {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Signature className="size-4" aria-hidden="true" />}
                {run.phase === "error" ? "Try again" : "Sign and send"}
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayRowButton({ action, row, now }: { action: CorporateAction; row: EntitlementRow; now: number }) {
  const svc = useMarkets();
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  if (row.receipt || row.amount === BigInt(0)) return null;
  const early = now < action.paymentTs;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className={cn(pillButton, "h-8 px-3 text-xs")}
        disabled={state.busy || early}
        title={early ? `Payments open ${formatDateTime(action.paymentTs)}` : undefined}
        onClick={async () => {
          setState({ busy: true, error: null });
          try {
            await svc.pay(action.id, row.holder);
            setState({ busy: false, error: null });
          } catch (e) {
            setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
          }
        }}
      >
        {state.busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        Pay<span className="sr-only"> {row.label ?? row.holder}</span>
      </button>
      {state.error ? <span role="alert" className="max-w-[12rem] text-right text-[11px] text-red-600 dark:text-red-400">{state.error}</span> : null}
    </span>
  );
}
