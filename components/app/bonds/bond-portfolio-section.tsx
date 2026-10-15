"use client";

import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/markets/format";
import { useBondsOverview } from "@/lib/useBonds";
import { CouponCalendar, TestFundsNote, money, moneyCents } from "./bond-parts";

/** Portfolio: bond positions, the coupon calendar and the settlement-token balance. */
export function BondPortfolioSection() {
  const { data, error } = useBondsOverview();
  if (!data || !data.available) {
    return error && !data ? <p className="text-xs text-muted-foreground">Bond positions are unavailable right now.</p> : null;
  }
  const cash = data.settlement.filter((s) => BigInt(s.amount) > BigInt(0));

  if (!data.positions.length && !cash.length) {
    if (!data.offerings.some((o) => o.allocation.open)) return null;
    return (
      <Card className="flex-row items-center gap-3 rounded-2xl p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"><Landmark className="size-4 text-muted-foreground" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Bonds with a fixed coupon</p>
          <p className="text-xs text-muted-foreground">Coupons are paid to your wallet automatically.</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/bonds" />}>Browse</Button>
      </Card>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="bond-positions-title">
      <div className="flex items-center justify-between">
        <h3 id="bond-positions-title" className="font-semibold">Bonds</h3>
        <Button variant="link" size="sm" className="h-auto p-0" nativeButton={false} render={<Link href="/bonds" />}>All bonds</Button>
      </div>
      <div className="space-y-2">
        {data.positions.map((p) => (
          <Link key={p.mint} href={`/bonds/${p.mint}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="gap-3 rounded-2xl p-4 transition-colors hover:bg-muted/40">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300"><Landmark className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.symbol} · {p.units} units</p>
                </div>
                <div className="text-right">
                  <p className="font-medium tabular-nums">{money(p.faceValue, p.settlementDecimals, p.settlementSymbol)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Face value</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                <span>Accrued {moneyCents(p.accrued, p.settlementDecimals, p.settlementSymbol)} (estimate)</span>
                <span className="inline-flex items-center gap-1 tabular-nums">Next {p.nextCoupon ? `${formatDate(p.nextCoupon.ts)}${p.nextCoupon.source === "scheduled" ? " · scheduled" : ""}` : "—"}<ArrowRight className="size-3" /></span>
              </div>
            </Card>
          </Link>
        ))}
        {cash.map((s) => (
          <Card key={s.mint} className="flex-row items-center gap-3 rounded-2xl p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Test {s.symbol} · coupon payments</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Settlement token for bond coupons, in your Plain wallet</p>
            </div>
            <p className="font-medium tabular-nums">{money(s.amount, s.decimals, s.symbol)}</p>
          </Card>
        ))}
      </div>
      {data.calendar.length ? (
        <Card className="gap-3 rounded-2xl p-4">
          <p className="text-sm font-semibold">Coupon calendar</p>
          <CouponCalendar entries={data.calendar} limit={4} showSymbol />
        </Card>
      ) : null}
      <TestFundsNote>{data.note}</TestFundsNote>
    </section>
  );
}
