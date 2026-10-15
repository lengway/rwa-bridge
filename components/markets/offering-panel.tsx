"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatSettlement, formatUnits } from "@/lib/markets/format";
import type { DevnetMarketsService, OfferingPurchase, OfferingState } from "@/lib/markets/devnet-service";
import type { Instrument, MarketsService } from "@/lib/markets/service";
import { useLedgerNow, useLedgerQuery, useMarkets } from "./markets-provider";
import { ChainRef, ErrorNote, Panel, PanelHeader, PlainInvestorBadge, Skeleton, Stat, pillButton, primaryButton } from "./primitives";

/** True when the console runs on the real program (offerings exist only on devnet). */
export function hasOfferings(svc: MarketsService): svc is DevnetMarketsService {
  return "getOffering" in svc && typeof (svc as Partial<DevnetMarketsService>).getOffering === "function";
}

type Buyer = { buyer: string; units: bigint; amount: bigint; purchases: OfferingPurchase[] };

function buyers(o: OfferingState): Buyer[] {
  const map = new Map<string, Buyer>();
  for (const p of o.purchases) {
    const b = map.get(p.buyer) ?? { buyer: p.buyer, units: BigInt(0), amount: BigInt(0), purchases: [] };
    b.units += p.units;
    b.amount += p.amount;
    b.purchases.push(p);
    map.set(p.buyer, b);
  }
  return [...map.values()].sort((x, y) => (y.units > x.units ? 1 : y.units < x.units ? -1 : 0));
}

/** Primary offering: sales, proceeds in the vault, buyers with their payment transactions, issuer actions. */
export function OfferingPanel({ instrument }: { instrument: Instrument }) {
  const svc = useMarkets();
  const now = useLedgerNow();
  const query = useLedgerQuery(hasOfferings(svc) ? `offering:${instrument.mint}` : null, (s) => (s as DevnetMarketsService).getOffering(instrument.mint));
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);

  if (!hasOfferings(svc)) return <Panel className="p-8 text-center text-sm text-muted-foreground">Primary offerings run on the devnet program only.</Panel>;
  if (query.error) return <ErrorNote error={query.error} />;
  if (query.data === undefined) return <Skeleton className="h-72 rounded-3xl" />;
  const o = query.data;
  if (!o) {
    return (
      <div className="space-y-4">
        <Panel className="p-8 text-center text-sm text-muted-foreground">This bond has no primary offering. Units reach holders through issuer allocations only.</Panel>
        <IssuerAllocation instrument={instrument} />
      </div>
    );
  }
  const inVault = o.proceeds - o.withdrawn;
  const open = !o.closed && o.startTs <= now && now < o.endTs;
  const list = buyers(o);
  const pct = o.capUnits > BigInt(0) ? Number((o.soldUnits * BigInt(10_000)) / o.capUnits) / 100 : 0;
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Primary offering"
          description={`Delivery versus payment: buyers pay ${money(o.issuePrice)} per unit into the proceeds vault and receive the units in the same transaction.`}
          actions={<span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", open ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" : "bg-muted text-muted-foreground ring-border")}>{o.closed ? "Closed" : open ? "Open" : now < o.startTs ? "Not open yet" : "Ended"}</span>}
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5 px-5 py-5 sm:grid-cols-4 sm:px-6">
          <Stat label="Units sold" value={`${formatUnits(o.soldUnits)} / ${formatUnits(o.capUnits)}`} sub={`${pct}% · ${o.purchases.length} purchase${o.purchases.length === 1 ? "" : "s"}`} />
          <Stat label="Proceeds" value={money(o.proceeds)} sub={`${list.length} buyer${list.length === 1 ? "" : "s"}`} />
          <Stat label="In vault" value={money(inVault)} sub={o.withdrawn > BigInt(0) ? `${money(o.withdrawn)} withdrawn` : "Nothing withdrawn yet"} />
          <Stat label="Window" value={`${formatDate(o.startTs)} – ${formatDate(o.endTs)}`} sub={`Max ${formatUnits(o.perHolderCap)} units per wallet`} />
        </dl>
        <div className="h-1.5 overflow-hidden border-t bg-muted" aria-hidden="true"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} /></div>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
          <WithdrawProceeds instrument={instrument} amount={inVault} money={money} />
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">Vault <ChainRef value={o.proceedsVault} kind="address" label="proceeds vault" /></span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">Offering <ChainRef value={o.address} kind="address" label="offering account" /></span>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Buyers" description="Decoded from the program's UnitsSubscribed events. Each payment links to its transaction." />
        {list.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6">No purchases yet.</p>
        ) : (
          <ul className="divide-y">
            {list.map((b) => (
              <li key={b.buyer} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex min-w-0 items-center gap-2">
                  <ChainRef value={b.buyer} kind="address" label="buyer" size={6} />
                  <PlainInvestorBadge />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
                  <span>{formatUnits(b.units)} units</span>
                  <span className="font-medium">{money(b.amount)}</span>
                  <span className="flex flex-wrap gap-2">
                    {b.purchases.map((p) => <ChainRef key={p.signature} value={p.signature} kind="tx" label={`payment ${p.signature}`} />)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <IssuerAllocation instrument={instrument} />
    </div>
  );
}

function WithdrawProceeds({ instrument, amount, money }: { instrument: Instrument; amount: bigint; money: (v: bigint) => string }) {
  const svc = useMarkets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!hasOfferings(svc)) return null;
  const withdraw = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await svc.withdrawProceeds(instrument.mint);
      setDone(r.signature);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={primaryButton} disabled={busy || amount === BigInt(0)} onClick={() => void withdraw()}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Withdraw {money(amount)}
      </button>
      {done ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">Sent to the issuer <ChainRef value={done} kind="tx" label="withdrawal" /></span> : null}
      {error ? <span role="alert" className="text-xs text-red-700 dark:text-red-300">{error.message}</span> : null}
    </div>
  );
}

/** Issuer action, not an investor flow: units issued with no payment, under Plain's per-wallet caps. */
function IssuerAllocation({ instrument }: { instrument: Instrument }) {
  const svc = useMarkets();
  const [holder, setHolder] = useState("");
  const [units, setUnits] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!hasOfferings(svc)) return null;
  const valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(holder.trim()) && units >= 1;
  const submit = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await svc.issuerAllocate(instrument.mint, holder.trim(), units);
      setDone(r.signature);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel>
      <PanelHeader title="Issuer allocation" description="Issuer action: issues units to a wallet with no payment (placements, demo custody). Investors buy through the offering." />
      <form className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end sm:px-6" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void submit(); }}>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Wallet
          <input value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Solana address" className="h-9 rounded-full border bg-background px-3.5 font-mono text-sm text-foreground" />
        </label>
        <label className="flex w-28 flex-col gap-1 text-xs text-muted-foreground">
          Units
          <input type="number" min={1} value={units} onChange={(e) => setUnits(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="h-9 rounded-full border bg-background px-3.5 text-sm text-foreground tabular-nums" />
        </label>
        <button type="submit" className={pillButton} disabled={!valid || busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Issue units
        </button>
      </form>
      {done || error ? (
        <p className="border-t px-5 py-3 text-xs sm:px-6">
          {done ? <span className="inline-flex items-center gap-1 text-muted-foreground">Issued <ChainRef value={done} kind="tx" label="issue" /></span> : null}
          {error ? <span role="alert" className="text-red-700 dark:text-red-300">{error.message}</span> : null}
        </p>
      ) : null}
    </Panel>
  );
}
