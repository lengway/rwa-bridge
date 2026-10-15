"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBondDetail } from "@/lib/useBonds";
import type { BondDetail } from "@/lib/markets/investor";
import { BuyButton } from "./bond-purchase";
import { ActionCard, CouponCalendar, PositionFacts, SectionTitle, TermsGrid, TestFundsNote, VoteCard, YieldFigure, money } from "./bond-parts";

export function BondDetailScreen({ mint }: { mint: string }) {
  const { data, error, refresh } = useBondDetail(mint);
  if (!data) {
    if (error) {
      return (
        <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p>{error}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>Try again</Button>
        </div>
      );
    }
    return (
      <div className="space-y-3" aria-label="Loading bond">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }
  return <Detail data={data} />;
}

function Detail({ data }: { data: BondDetail }) {
  const { offering, position, settlement } = data;
  const held = position ? BigInt(position.units) : BigInt(0);
  const openVotes = data.votes.filter((v) => v.open);
  return (
    <div className="space-y-8">
      <Card className="gap-5 rounded-2xl p-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{offering.symbol}{offering.status !== "Active" ? ` · ${offering.status}` : ""}</p>
          <h2 className="text-xl font-semibold tracking-tight">{offering.name}</h2>
        </div>
        <YieldFigure offering={offering} />
        <TermsGrid offering={offering} />
        <div className="space-y-2 border-t pt-4">
          <BuyButton offering={offering} heldUnits={held} balanceAtomic={settlement?.amount ?? null} className="w-full sm:w-auto" />
          {offering.explorerUrl ? (
            <a href={offering.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs underline underline-offset-4">
              Bond token on Solana Explorer <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </Card>

      <section className="space-y-3">
        <SectionTitle title="Your position" />
        <Card className="gap-4 rounded-2xl p-5">
          {position ? (
            <>
              <PositionFacts position={position} />
              {settlement ? (
                <p className="border-t pt-3 text-sm">
                  Test {settlement.symbol} in your wallet: <span className="font-medium tabular-nums">{money(settlement.amount, settlement.decimals, settlement.symbol)}</span>
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">You don&apos;t hold this bond yet. Units you hold at a record date receive that coupon automatically.</p>
          )}
        </Card>
      </section>

      {openVotes.length ? (
        <section className="space-y-3">
          <SectionTitle title="Votes" />
          {openVotes.map((v) => <VoteCard key={v.actionId} vote={v} />)}
        </section>
      ) : null}

      {position ? (
        <section className="space-y-3">
          <SectionTitle title="Upcoming dates" />
          <Card className="rounded-2xl p-5"><CouponCalendar entries={data.calendar} limit={8} /></Card>
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionTitle title="Corporate actions" aside={String(data.actions.length)} />
        {data.actions.length === 0 ? <p className="text-sm text-muted-foreground">The issuer has not announced any action yet.</p> : null}
        {data.actions.map((a) => <ActionCard key={a.id} action={a} offering={offering} />)}
      </section>

      <TestFundsNote>{data.note} Coupons are paid by the issuer&apos;s paying agent straight to your wallet; you don&apos;t need to sign anything.</TestFundsNote>
    </div>
  );
}
