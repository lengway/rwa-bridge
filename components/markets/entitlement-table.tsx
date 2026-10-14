"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatSettlement, formatShare, formatUnits } from "@/lib/markets/format";
import type { ActionParams, EntitlementRow, EntitlementSheet, Instrument } from "@/lib/markets/service";
import { ChainRef, PlainInvestorBadge } from "./primitives";

type Props = {
  instrument: Instrument;
  params: ActionParams;
  sheet: EntitlementSheet;
  /** Extra per-row control (e.g. "Pay" for the paying agent). */
  rowAction?: (row: EntitlementRow) => ReactNode;
  showStatus?: boolean;
  /** Narrow layout for side panels: no share column, tighter padding. */
  compact?: boolean;
  caption: string;
};

export function EntitlementTable({ instrument, params, sheet, rowAction, showStatus = true, compact = false, caption }: Props) {
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
  const vote = params.kind === "Vote";
  const redemption = params.kind === "PartialRedemption" || params.kind === "FinalRedemption";
  const options = params.kind === "Vote" ? params.options : [];
  return (
    <div className="relative -mx-px overflow-x-auto">
      <table className={cn("w-full text-sm", compact ? "min-w-[340px]" : "min-w-[640px]")}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">Holder</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Units</th>
            {compact ? null : <th scope="col" className="px-3 py-2.5 text-right font-medium">Share</th>}
            {redemption ? <th scope="col" className="px-3 py-2.5 text-right font-medium">Redeemed</th> : null}
            <th scope="col" className="px-3 py-2.5 text-right font-medium">{vote ? "Voting weight" : "Entitlement"}</th>
            {showStatus ? <th scope="col" className="px-3 py-2.5 font-medium">Status</th> : null}
            {rowAction ? <th scope="col" className="px-5 py-2.5 sm:px-6"><span className="sr-only">Actions</span></th> : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sheet.rows.map((r) => (
            <tr key={r.holder} className="transition-colors hover:bg-muted/40">
              <td className={cn("px-5 py-3 sm:px-6", compact ? "max-w-[8.5rem] pr-2 sm:px-4" : "max-w-[16rem]")}>
                <p className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium" title={r.label}>{r.label ?? "Holder"}</span>
                  {r.plainInvestor ? <PlainInvestorBadge /> : null}
                </p>
                {compact ? <p className="truncate font-mono text-[11px] text-muted-foreground">{r.holder.slice(0, 4)}…{r.holder.slice(-4)}</p> : <ChainRef value={r.holder} kind="address" label="holder address" />}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{formatUnits(r.units)}</td>
              {compact ? null : <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{formatShare(r.units, sheet.totalUnits)}</td>}
              {redemption ? <td className="px-3 py-3 text-right tabular-nums">{formatUnits(r.redeemUnits)}</td> : null}
              <td className="px-3 py-3 text-right font-medium tabular-nums">{vote ? formatUnits(r.weight) : money(r.amount)}</td>
              {showStatus ? (
                <td className="px-3 py-3">
                  <RowStatus row={r} options={options} vote={vote} />
                </td>
              ) : null}
              {rowAction ? <td className="px-5 py-2 text-right sm:px-6">{rowAction(r)}</td> : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t bg-muted/30 font-medium">
            <th scope="row" className="px-5 py-3 text-left sm:px-6">{compact ? "Total" : `Total · ${sheet.rows.length} holders`}</th>
            <td className="px-3 py-3 text-right tabular-nums">{formatUnits(sheet.totalUnits)}</td>
            {compact ? null : <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">100%</td>}
            {redemption ? <td className="px-3 py-3 text-right tabular-nums">{formatUnits(sheet.totalRedeemUnits)}</td> : null}
            <td className="px-3 py-3 text-right tabular-nums">{vote ? formatUnits(sheet.totalUnits) : money(sheet.totalAmount)}</td>
            {showStatus ? <td /> : null}
            {rowAction ? <td /> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RowStatus({ row, options, vote }: { row: EntitlementRow; options: string[]; vote: boolean }) {
  if (row.receipt) {
    return (
      <span className="flex flex-wrap items-center gap-x-1">
        <Tag tone="ok">{row.receipt.mode === "push" ? "Paid" : "Claimed"}</Tag>
        <ChainRef value={row.receipt.signature} kind="tx" label="payment transaction" size={3} />
      </span>
    );
  }
  if (row.vote) {
    return (
      <span className="flex flex-wrap items-center gap-x-1">
        <Tag tone="ok">{options[row.vote.choice] ?? `Option ${row.vote.choice + 1}`}</Tag>
        <ChainRef value={row.vote.signature} kind="tx" label="vote transaction" size={3} />
      </span>
    );
  }
  if (!vote && row.amount === BigInt(0)) return <Tag tone="muted">Nothing owed</Tag>;
  return <Tag tone="muted">{vote ? "Not voted" : "Unpaid"}</Tag>;
}

function Tag({ tone, children }: { tone: "ok" | "muted"; children: ReactNode }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tone === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
      {children}
    </span>
  );
}
