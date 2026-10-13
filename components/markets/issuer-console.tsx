"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ChevronRight, FastForward, Loader2, Lock, Plus, RotateCcw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatBps, formatDate, formatDateTime, formatRelative, formatSettlement, formatUnits } from "@/lib/markets/format";
import { KIND_LABEL, couponPeriods, progress, stageLabel, upcomingEvents } from "@/lib/markets/lifecycle";
import type { CorporateAction, Instrument } from "@/lib/markets/service";
import { ActionDetail } from "./action-detail";
import { MarketsProvider, useLedgerNow, useLedgerQuery, useMarkets } from "./markets-provider";
import { NewActionDialog } from "./new-action-dialog";
import { ChainRef, ErrorNote, Eyebrow, KindIcon, Panel, Skeleton, StatusPill, focusRing, pillButton, primaryButton } from "./primitives";
import { AuditLog, RegisterView } from "./register-and-log";

export function IssuerConsole() {
  return (
    <MarketsProvider>
      <Console />
    </MarketsProvider>
  );
}

type Tab = "actions" | "register" | "log";

function Console() {
  const instruments = useLedgerQuery("instruments", (s) => s.listInstruments());
  const instrument = instruments.data?.[0];
  const actions = useLedgerQuery(instrument ? `actions:${instrument.mint}` : null, (s) => s.listActions(instrument!.mint));
  const now = useLedgerNow();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const tab = (["actions", "register", "log"].includes(params.get("tab") ?? "") ? params.get("tab") : "actions") as Tab;
  const list = actions.data ?? [];
  // Pin the default once, so the view does not jump to another action when this one settles.
  const [pinned, setPinned] = useState<string | null>(null);
  if (pinned == null && list.length > 0) setPinned(defaultSelection(list, now)?.id ?? null);
  const selectedId = params.get("action") ?? pinned;
  const selected = list.find((a) => a.id === selectedId) ?? null;

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v == null) sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const select = (id: string) => {
    setParams({ action: id, tab: null });
    if (window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  if (instruments.error) return <Shell><ErrorNote error={instruments.error} /></Shell>;
  if (!instrument) return <ConsoleSkeleton />;

  return (
    <>
      <InstrumentHeader instrument={instrument} actions={list} now={now} onNew={() => setNewOpen(true)} onSelect={select} />
      <Shell>
        <SimulationBar actions={list} now={now} />
        <Tabs value={tab} onValueChange={(v) => setParams({ tab: v === "actions" ? null : String(v) })} className="gap-5">
          <TabsList variant="line" className="h-10 w-full justify-start gap-4 overflow-x-auto rounded-none border-b px-0 [scrollbar-width:none]" aria-label="Console sections">
            <TabsTrigger value="actions" className="flex-none px-1">Corporate actions <Count n={list.length} /></TabsTrigger>
            <TabsTrigger value="register" className="flex-none px-1">Register</TabsTrigger>
            <TabsTrigger value="log" className="flex-none px-1">Event log</TabsTrigger>
          </TabsList>

          <TabsContent value="actions" className="min-w-0">
            {actions.error ? (
              <ErrorNote error={actions.error} />
            ) : !actions.data ? (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-3xl" />)}</div>
                <Skeleton className="h-[32rem] rounded-3xl" />
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <nav aria-label="Corporate actions" className="lg:sticky lg:top-20">
                  <ul className="space-y-2.5">
                    {list.map((a) => (
                      <li key={a.id}>
                        <ActionListItem action={a} selected={a.id === selected?.id} now={now} onSelect={() => select(a.id)} />
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => setNewOpen(true)} className={cn("mt-2.5 flex w-full items-center justify-center gap-2 rounded-3xl border border-dashed px-4 py-4 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground", focusRing)}>
                    <Plus className="size-4" aria-hidden="true" /> New corporate action
                  </button>
                </nav>
                <div ref={detailRef} className="scroll-mt-20">
                  {selected ? (
                    <div key={selected.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300">
                      <ActionDetail action={selected} instrument={instrument} now={now} />
                    </div>
                  ) : (
                    <Panel className="p-8 text-center text-sm text-muted-foreground">No corporate actions yet. Announce the first one.</Panel>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
          <TabsContent value="register" className="min-w-0">
            <RegisterView instrument={instrument} now={now} />
          </TabsContent>
          <TabsContent value="log" className="min-w-0">
            <AuditLog instrument={instrument} actions={list} now={now} />
          </TabsContent>
        </Tabs>
      </Shell>
      {actions.data ? (
        <NewActionDialog open={newOpen} onOpenChange={setNewOpen} instrument={instrument} actions={list} now={now} onCreated={(id) => setParams({ action: id, tab: null })} />
      ) : null}
    </>
  );
}

function defaultSelection(list: CorporateAction[], now: number) {
  // Prefer an action the operator can move forward right now, then the one with the nearest date.
  const actionable = (a: CorporateAction) =>
    a.status === "RecordLocked" ||
    (a.status === "Announced" && now >= a.recordTs) ||
    (a.status === "SnapshotPosted" && a.kind !== "Vote") ||
    ((a.status === "Funded" || a.status === "Settling") && now >= a.paymentTs);
  const open = list.filter((a) => a.status !== "Settled");
  const nextDate = (a: CorporateAction) => (a.status === "Announced" ? a.recordTs : a.paymentTs);
  return open.find(actionable) ?? open.sort((a, b) => nextDate(a) - nextDate(b))[0] ?? list[0];
}

function Count({ n }: { n: number }) {
  return <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{n}</span>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl space-y-5 px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</div>;
}

function InstrumentHeader({ instrument, actions, now, onNew, onSelect }: { instrument: Instrument; actions: CorporateAction[]; now: number; onNew: () => void; onSelect: (id: string) => void }) {
  const svc = useMarkets();
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
  const next = upcomingEvents(actions, now)[0];
  const locked = now < instrument.lockUntil;
  const periods = couponPeriods(instrument);
  const coupons = Array.from({ length: periods }, (_, i) => {
    const d = new Date(instrument.issueTs * 1000);
    d.setUTCMonth(d.getUTCMonth() + (i + 1) * (12 / instrument.frequency));
    const action = actions.find((a) => a.params.kind === "Coupon" && a.params.period === i + 1) ?? (i + 1 === periods ? actions.find((a) => a.params.kind === "FinalRedemption" && a.params.includeCoupon) : undefined);
    return { period: i + 1, ts: Math.floor(d.getTime() / 1000), action };
  });
  return (
    <section aria-labelledby="instrument-title" className="relative isolate overflow-hidden border-b">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_70%_at_90%_0%,rgb(16_185_129/0.10),transparent_70%),radial-gradient(45%_60%_at_0%_100%,rgb(139_92_246/0.08),transparent_70%)]" />
      <div className="mx-auto max-w-6xl px-4 pb-8 pt-10 sm:px-6 sm:pt-12 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <Eyebrow>Plain Markets · Issuer console</Eyebrow>
            <div className="flex flex-wrap items-center gap-3">
              <h1 id="instrument-title" className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{instrument.name}</h1>
              <span className="rounded-lg border px-2 py-0.5 font-mono text-xs">{instrument.symbol}</span>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", instrument.status === "Active" ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" : "bg-muted text-muted-foreground ring-border")}>
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                {instrument.status}
              </span>
              {locked ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-500/20 dark:text-violet-300">
                  <Lock className="size-3" aria-hidden="true" /> Transfers locked until {formatDate(instrument.lockUntil)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">Mint <ChainRef value={instrument.mint} kind="address" label="bond mint" /></span>
              <span className="inline-flex items-center gap-1">Issuer <ChainRef value={instrument.issuer} kind="address" label="issuer" /></span>
              <span>Token-2022 · Solana {svc.source.cluster}</span>
            </div>
          </div>
          <button type="button" className={cn(primaryButton, "h-11 self-start whitespace-nowrap px-6 lg:self-auto")} onClick={onNew}>
            <Plus className="size-4" aria-hidden="true" /> New corporate action
          </button>
        </div>

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel className="px-5 py-5 sm:px-6">
            <h2 className="sr-only">Terms</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
              <Term label="Face value" value={money(instrument.faceValue)} sub="per unit" />
              <Term label="Coupon" value={formatBps(instrument.couponBps)} sub={instrument.frequency === 2 ? "Semi-annual" : `${instrument.frequency}× a year`} />
              <Term label="Issued" value={formatDate(instrument.issueTs)} sub={`${formatUnits(instrument.issuedUnits)} units`} />
              <Term label="Maturity" value={formatDate(instrument.maturityTs)} sub={formatRelative(instrument.maturityTs, now)} />
              <Term label="Outstanding" value={`${formatUnits(instrument.supply)} units`} sub={`${money(instrument.supply * instrument.faceValue)} face`} />
              <Term label="Settlement" value="Test USD" sub={`${instrument.settlementDecimals} decimals · devnet`} />
              <Term label="Transfer rules" value={instrument.allowlist ? "Allowlist" : "Open"} sub="+ ex-date lock hook" />
              <Term label="Actions" value={String(instrument.actionCount)} sub={`${actions.filter((a) => a.status !== "Settled").length} open`} />
            </dl>
            <div className="mt-6 border-t pt-4">
              <p className="text-xs text-muted-foreground">Coupon schedule</p>
              <ol className="mt-2 grid grid-cols-4 gap-2">
                {coupons.map((c) => {
                  const settled = c.action?.status === "Settled";
                  const active = c.action && !settled;
                  const content = (
                    <>
                      <span className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>C{c.period}</span>
                        <span className={cn("size-1.5 rounded-full", settled ? "bg-emerald-500" : active ? "bg-amber-500" : "bg-border")} aria-hidden="true" />
                      </span>
                      <span className="mt-1 block text-xs font-medium tabular-nums">{formatDate(c.ts).replace(/ \d{4}$/, "")}</span>
                      <span className="block text-[11px] text-muted-foreground">{settled ? "Paid" : active ? stageLabel(c.action!) : "Scheduled"}</span>
                    </>
                  );
                  return (
                    <li key={c.period}>
                      {c.action ? (
                        <button type="button" onClick={() => onSelect(c.action!.id)} className={cn("w-full rounded-xl border px-2.5 py-2 text-left transition-colors hover:bg-muted/50", focusRing)}>{content}</button>
                      ) : (
                        <div className="rounded-xl border border-dashed px-2.5 py-2">{content}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </Panel>
          <Panel className="flex flex-col justify-between px-5 py-5 sm:px-6">
            <div>
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="size-4" aria-hidden="true" /> Next event</p>
              {next ? (
                <>
                  <p className="mt-3 text-2xl font-semibold tracking-tight">{formatRelative(next.ts, now)}</p>
                  <p className="mt-1 text-sm">
                    {next.label} · <span className="font-medium">{next.action.title}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{formatDateTime(next.ts)}</p>
                </>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No scheduled dates. Announce the next corporate action.</p>
              )}
            </div>
            {next ? (
              <button type="button" onClick={() => onSelect(next.action.id)} className={cn(pillButton, "mt-5 self-start")}>
                Open action <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            <ul className="mt-5 space-y-1.5 border-t pt-4 text-sm">
              {upcomingEvents(actions, now).slice(1, 4).map((e) => (
                <li key={`${e.action.id}:${e.label}`} className="flex justify-between gap-3">
                  <span className="truncate text-muted-foreground">{e.label} · #{e.action.seq}</span>
                  <span className="shrink-0 tabular-nums">{formatDate(e.ts)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </section>
  );
}

function Term({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-semibold tabular-nums tracking-tight">{value}</dd>
      {sub ? <dd className="truncate text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

function ActionListItem({ action, selected, now, onSelect }: { action: CorporateAction; selected: boolean; now: number; onSelect: () => void }) {
  const p = progress(action);
  const keyDate = action.status === "Settled" ? action.transitions.at(-1)!.ts : action.status === "Announced" ? action.recordTs : action.paymentTs;
  const keyLabel = action.status === "Settled" ? "Settled" : action.status === "Announced" ? "Record" : action.kind === "Vote" ? "Closes" : "Pays";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group w-full rounded-3xl border bg-card p-4 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        selected && "border-foreground/40 shadow-md ring-1 ring-foreground/10",
        focusRing,
      )}
    >
      <div className="flex items-start gap-3">
        <KindIcon kind={action.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">#{action.seq} · {KIND_LABEL[action.kind]}</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-5">{action.title}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <StatusPill status={action.status} label={stageLabel(action)} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {keyLabel} {formatDate(keyDate)}
          {action.status !== "Settled" ? <span className="sr-only">, {formatRelative(keyDate, now)}</span> : null}
        </span>
      </div>
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {Array.from({ length: p.total }, (_, i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-500", i < p.done ? (action.status === "Settled" ? "bg-emerald-500" : "bg-foreground/70") : "bg-muted")} />
        ))}
      </div>
    </button>
  );
}

function SimulationBar({ actions, now }: { actions: CorporateAction[]; now: number }) {
  const svc = useMarkets();
  const [busy, setBusy] = useState<"advance" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // The simulated clock lives in browser storage; render it only after hydration.
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (!svc.simulation || !mounted) return null;
  const sim = svc.simulation;
  const next = upcomingEvents(actions, now).find((e) => e.label !== "Claim deadline") ?? upcomingEvents(actions, now)[0];
  const run = async (kind: "advance" | "reset", fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-muted-foreground">
        <span className="font-medium text-foreground">Simulated ledger</span> · clock {formatDateTime(now)}. Same rules as the program; time moves when you advance it.
        {error ? <span role="alert" className="block text-red-600 dark:text-red-400">{error}</span> : null}
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        {next ? (
          <button type="button" className={pillButton} disabled={!!busy} onClick={() => run("advance", () => sim.advanceTo(next.ts))}>
            {busy === "advance" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FastForward className="size-4" aria-hidden="true" />}
            Advance to {formatDate(next.ts)}
            <span className="hidden text-muted-foreground sm:inline">· {next.label.toLowerCase()} #{next.action.seq}</span>
          </button>
        ) : null}
        <button type="button" className={pillButton} disabled={!!busy} onClick={() => run("reset", () => sim.reset())} aria-label="Reset the simulated ledger to its initial state">
          {busy === "reset" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
          Reset
        </button>
      </div>
    </div>
  );
}

export function ConsoleSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-12 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading issuer console">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-10 w-2/3" />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
      <Skeleton className="h-96 rounded-3xl" />
    </div>
  );
}
