"use client";

import { ExternalLink, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WithTip } from "@/components/markets/disclosure";
import { Skeleton } from "@/components/ui/skeleton";
import { useBondDetail } from "@/lib/useBonds";
import type { BondDetail } from "@/lib/markets/investor";
import { BuyButton, purchaseBlock } from "./bond-purchase";
import { ActionCard, CouponCalendar, InlineNote, PositionCard, SectionTitle, TermsGrid, TestFundsNote, VoteCard, YieldFigure } from "./bond-parts";

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
      <div className="space-y-6" aria-label="Loading bond">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }
  return <Detail data={data} />;
}

function Detail({ data }: { data: BondDetail }) {
  const { offering, position, settlement } = data;
  const held = position ? BigInt(position.units) : BigInt(0);
  const blocked = purchaseBlock(offering, held);
  const openVotes = data.votes.filter((v) => v.open);
  const received = data.actions.reduce((sum, a) => sum + (a.mine?.payment ? BigInt(a.mine.payment.amount) : BigInt(0)), BigInt(0));

  return (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">{offering.symbol} · Bond</p>
            {offering.status !== "Active" ? <Badge variant="outline">{offering.status}</Badge> : null}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{offering.name}</h2>
        </div>
        <YieldFigure offering={offering} />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <BuyButton offering={offering} heldUnits={held} balanceAtomic={settlement?.amount ?? null} />
            {offering.explorerUrl ? (
              <WithTip tip="View on Solana Explorer">
                <Button variant="ghost" size="icon" className="size-11 text-muted-foreground" aria-label="View on Solana Explorer" nativeButton={false} render={<a href={offering.explorerUrl} target="_blank" rel="noopener noreferrer" />}>
                  <ExternalLink />
                </Button>
              </WithTip>
            ) : null}
          </div>
          {blocked ? <InlineNote>{blocked}</InlineNote> : null}
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Terms" />
        <Card className="rounded-2xl p-5">
          <TermsGrid offering={offering} />
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle title="Your position" />
        {position ? (
          <PositionCard position={position} received={received} cash={settlement} />
        ) : (
          <Card className="flex-row items-center gap-3 rounded-2xl p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Landmark className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">No units yet</p>
              <p className="text-xs text-muted-foreground">Coupons go to units held at the record date.</p>
            </div>
            <BuyButton offering={offering} heldUnits={held} balanceAtomic={settlement?.amount ?? null} label="Buy" className="h-9 px-3" />
          </Card>
        )}
      </section>

      {openVotes.length ? (
        <section className="space-y-3">
          <SectionTitle title="Votes" aside={`${openVotes.length} open`} />
          {openVotes.map((v) => <VoteCard key={v.actionId} vote={v} />)}
        </section>
      ) : null}

      {position && data.calendar.length ? (
        <section className="space-y-3">
          <SectionTitle title="Upcoming dates" />
          <Card className="rounded-2xl p-5"><CouponCalendar entries={data.calendar} limit={6} /></Card>
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionTitle title="Corporate actions" aside={data.actions.length ? String(data.actions.length) : undefined} />
        {data.actions.length === 0 ? <p className="text-sm text-muted-foreground">The issuer has not announced any action yet.</p> : null}
        <div className="space-y-3">
          {data.actions.map((a) => <ActionCard key={a.id} action={a} offering={offering} />)}
        </div>
      </section>

      <TestFundsNote>{data.note} Coupons are paid by the issuer&apos;s paying agent straight to your wallet; you don&apos;t need to sign anything.</TestFundsNote>
    </div>
  );
}
