"use client";

import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/markets/format";
import type { BondOffering, InvestorOverview } from "@/lib/markets/investor";
import { useBondsOverview } from "@/lib/useBonds";
import { AllocationButton, CouponCalendar, PaymentList, SectionTitle, TestFundsNote, VoteCard, YieldFigure, frequencyLabel, money, moneyCents } from "./bond-parts";

type Ready = Extract<InvestorOverview, { available: true }>;

export function BondsScreen() {
  const { data, error, refresh } = useBondsOverview();

  if (!data) {
    if (error) return <LoadError message={error} onRetry={() => void refresh()} />;
    return (
      <div className="space-y-3" aria-label="Loading bonds">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </div>
    );
  }
  if (!data.available) {
    return (
      <Card className="items-center gap-3 rounded-2xl p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted"><Landmark className="size-5 text-muted-foreground" /></span>
        <div>
          <h2 className="font-semibold">No bond offerings</h2>
          <p className="mt-1 text-sm text-muted-foreground">{data.reason}</p>
        </div>
      </Card>
    );
  }
  return <Overview data={data} />;
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}

function Overview({ data }: { data: Ready }) {
  const held = new Map(data.positions.map((p) => [p.mint, BigInt(p.units)]));
  const openVotes = data.votes.filter((v) => v.open);
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Bonds that pay a fixed coupon to your Plain wallet. Every payment is recorded on Solana and can be verified.</p>
      </div>

      {data.positions.length ? <PositionsSummary data={data} /> : null}

      {openVotes.length ? (
        <section className="space-y-3">
          <SectionTitle title="Votes" aside={`${openVotes.length} open`} />
          {openVotes.map((v) => <VoteCard key={v.actionId} vote={v} />)}
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionTitle title="Offerings" aside={String(data.offerings.length)} />
        {data.offerings.length === 0 ? <p className="text-sm text-muted-foreground">No bonds are open right now.</p> : null}
        {data.offerings.map((o) => <OfferingCard key={o.mint} offering={o} heldUnits={held.get(o.mint) ?? BigInt(0)} />)}
      </section>

      {data.positions.length ? (
        <section className="space-y-3">
          <SectionTitle title="Upcoming dates" />
          <Card className="rounded-2xl p-5"><CouponCalendar entries={data.calendar} limit={6} showSymbol /></Card>
        </section>
      ) : null}

      {data.payments.length ? (
        <section className="space-y-3">
          <SectionTitle title="Received" />
          <Card className="rounded-2xl p-5"><PaymentList payments={data.payments.slice(0, 5)} /></Card>
        </section>
      ) : null}

      <TestFundsNote>{data.note} Fiat settlement is simulated; allocations and coupons use test tokens on Solana devnet.</TestFundsNote>
    </div>
  );
}

function PositionsSummary({ data }: { data: Ready }) {
  const cash = data.settlement.find((s) => BigInt(s.amount) > BigInt(0)) ?? data.settlement[0];
  return (
    <Card className="gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Your bonds</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {data.positions.length === 1 ? money(data.positions[0].faceValue, data.positions[0].settlementDecimals, data.positions[0].settlementSymbol) : `${data.positions.length} bonds`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Face value</p>
        </div>
        {cash ? (
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Test {cash.symbol} balance</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{money(cash.amount, cash.decimals, cash.symbol)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Coupons paid to your wallet</p>
          </div>
        ) : null}
      </div>
      <ul className="divide-y border-t">
        {data.positions.map((p) => (
          <li key={p.mint}>
            <Link href={`/bonds/${p.mint}`} className="flex items-center gap-3 py-3 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.symbol} · {p.units} units</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Accrued {moneyCents(p.accrued, p.settlementDecimals, p.settlementSymbol)} · next coupon {p.nextCouponTs ? formatDate(p.nextCouponTs) : "—"}
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OfferingCard({ offering, heldUnits }: { offering: BondOffering; heldUnits: bigint }) {
  const d = offering.settlementDecimals;
  const s = offering.settlementSymbol;
  return (
    <Card className="gap-4 rounded-2xl p-5">
      <Link href={`/bonds/${offering.mint}`} className="block space-y-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View ${offering.name}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="font-semibold">{offering.name}</h3>
            <p className="text-sm text-muted-foreground">{offering.symbol} · matures {formatDate(offering.maturityTs)}</p>
          </div>
          <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
        </div>
        <YieldFigure offering={offering} />
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Face value</dt><dd className="mt-0.5 font-medium tabular-nums">{money(offering.faceValue, d, s)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Pays</dt><dd className="mt-0.5 font-medium">{frequencyLabel(offering.frequency)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Next coupon</dt><dd className="mt-0.5 font-medium tabular-nums">{offering.nextCouponTs ? formatDate(offering.nextCouponTs) : "—"}</dd></div>
        </dl>
      </Link>
      <div className="space-y-2 border-t pt-4">
        {heldUnits > BigInt(0) ? <p className="text-xs text-muted-foreground">You hold {heldUnits.toString()} units.</p> : null}
        <AllocationButton offering={offering} heldUnits={heldUnits} className="w-full" />
      </div>
    </Card>
  );
}
