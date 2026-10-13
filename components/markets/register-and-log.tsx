"use client";

import { useState } from "react";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatRelative, formatSettlement, formatShare, formatUnits } from "@/lib/markets/format";
import type { CorporateAction, Instrument, MarketEventName } from "@/lib/markets/service";
import { useLedgerQuery } from "./markets-provider";
import { ChainRef, ErrorNote, Panel, PanelHeader, Skeleton, Stat, focusRing } from "./primitives";

const CUSTODY: Record<string, string> = { self: "Self-custody", "smart-wallet": "Plain smart wallet", custodian: "Custodian" };

export function RegisterView({ instrument, now }: { instrument: Instrument; now: number }) {
  const q = useLedgerQuery(`register:${instrument.mint}`, (s) => s.getRegister(instrument.mint));
  const locked = now < instrument.lockUntil;
  return (
    <div className="space-y-4">
      <Panel className="px-5 py-5 sm:px-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
          <Stat label="Outstanding" value={`${formatUnits(instrument.supply)} units`} sub={`${formatUnits(instrument.issuedUnits - instrument.supply)} redeemed of ${formatUnits(instrument.issuedUnits)} issued`} />
          <Stat label="Holders" value={q.data ? String(q.data.entries.length) : "—"} sub={instrument.allowlist ? "Allowlisted wallets only" : "Open transfers"} />
          <Stat label="Register as of" value={q.data ? `Slot ${q.data.slot.toLocaleString("en-US")}` : "—"} sub={q.data ? formatDateTime(q.data.ts) : undefined} />
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Transfers</dt>
            <dd className={cn("mt-1 inline-flex items-center gap-1.5 text-base font-semibold tracking-tight", locked ? "text-violet-700 dark:text-violet-300" : "")}>
              {locked ? <Lock className="size-4" aria-hidden="true" /> : <LockOpen className="size-4" aria-hidden="true" />}
              {locked ? "Locked" : "Open"}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground">{locked ? `Ex-date lock until ${formatDateTime(instrument.lockUntil)}` : "No record date in progress"}</dd>
          </div>
        </dl>
      </Panel>

      <Panel aria-labelledby="register-title">
        <PanelHeader id="register-title" title="Bondholder register" description="Token-2022 balances of the bond mint. Names are the issuer's off-chain directory; the chain only knows wallets." />
        {q.error ? (
          <div className="p-5"><ErrorNote error={q.error} /></div>
        ) : !q.data ? (
          <div className="space-y-2 p-5 sm:p-6">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <caption className="sr-only">Current holders of {instrument.symbol}</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">Holder</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Custody</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Units</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Face value</th>
                  <th scope="col" className="w-48 px-5 py-2.5 font-medium sm:px-6">Share of supply</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {q.data.entries
                  .slice()
                  .sort((a, b) => (b.units > a.units ? 1 : b.units < a.units ? -1 : 0))
                  .map((e) => (
                    <tr key={e.holder} className="transition-colors hover:bg-muted/40">
                      <td className="max-w-[16rem] px-5 py-3 sm:px-6">
                        <p className="truncate font-medium">{e.label ?? "Holder"}</p>
                        <ChainRef value={e.holder} kind="address" label="holder address" />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{e.custody ? CUSTODY[e.custody] : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatUnits(e.units)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatSettlement(e.units * instrument.faceValue, instrument.settlementDecimals, instrument.settlementSymbol)}</td>
                      <td className="px-5 py-3 sm:px-6">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-700 motion-reduce:transition-none" style={{ width: formatShare(e.units, q.data!.supply) }} />
                          </div>
                          <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{formatShare(e.units, q.data!.supply)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="flex items-start gap-2 px-1 text-xs leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        The bond mint&apos;s transfer hook is the Plain Markets program: it rejects transfers during an ex-date lock and to wallets outside the allowlist. Redemptions burn units through the program&apos;s permanent-delegate authority.
      </p>
    </div>
  );
}

const EVENT_LABEL: Record<MarketEventName, string> = {
  InstrumentCreated: "Instrument created",
  UnitsIssued: "Units issued",
  ActionCancelled: "Cancelled",
  InstrumentMatured: "Matured",
  InstrumentRedeemed: "Fully redeemed",
  ActionAnnounced: "Announced",
  RecordLocked: "Record locked",
  SnapshotPosted: "Snapshot posted",
  ActionFunded: "Funded",
  EntitlementPaid: "Paid",
  UnitsRedeemed: "Redeemed",
  VoteCast: "Vote cast",
  ActionSettled: "Settled",
};

export function AuditLog({ instrument, actions, now }: { instrument: Instrument; actions: CorporateAction[]; now: number }) {
  const [filter, setFilter] = useState<number | null>(null);
  const q = useLedgerQuery(`events:${instrument.mint}`, (s) => s.listEvents(instrument.mint));
  const events = (q.data ?? []).filter((e) => filter == null || e.actionSeq === filter);
  return (
    <Panel aria-labelledby="log-title">
      <PanelHeader
        id="log-title"
        title="Event log"
        description="Every state change emits a program event. Newest first."
        actions={
          <div role="group" aria-label="Filter by action" className="flex flex-wrap gap-1.5">
            {[null, ...actions.map((a) => a.seq).sort((a, b) => a - b)].map((seq) => (
              <button
                key={seq ?? "all"}
                type="button"
                aria-pressed={filter === seq}
                onClick={() => setFilter(seq)}
                className={cn("h-8 rounded-full border px-3 text-xs font-medium transition-colors", filter === seq ? "border-foreground bg-foreground text-background" : "hover:bg-muted", focusRing)}
              >
                {seq == null ? "All" : `#${seq}`}
              </button>
            ))}
          </div>
        }
      />
      {q.error ? (
        <div className="p-5"><ErrorNote error={q.error} /></div>
      ) : !q.data ? (
        <div className="space-y-2 p-5 sm:p-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <ol className="divide-y">
          {events.map((e) => (
            <li key={e.signature} className="grid gap-1 px-5 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[9.5rem_1fr_auto] sm:items-center sm:gap-4 sm:px-6">
              <div className="text-xs tabular-nums text-muted-foreground">
                <time dateTime={new Date(e.ts * 1000).toISOString()} title={formatDateTime(e.ts)}>{formatDateTime(e.ts).replace(" UTC", "")}</time>
                <span className="block">{formatRelative(e.ts, now)} · slot {e.slot.toLocaleString("en-US")}</span>
              </div>
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{EVENT_LABEL[e.name]}</span>
                  {e.actionSeq != null ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">#{e.actionSeq}</span> : null}
                  <code className="hidden font-mono text-[11px] text-muted-foreground md:inline">{e.name}</code>
                </p>
                <p className="mt-0.5 truncate text-muted-foreground" title={e.detail}>{e.detail}</p>
              </div>
              <ChainRef value={e.signature} kind="tx" label={`${EVENT_LABEL[e.name]} transaction`} size={5} />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
