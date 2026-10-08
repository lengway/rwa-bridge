"use client";

import { MarketDataNote } from "@/components/app/market-data-note";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";

export function KztEstimate({ usd }: { usd: number }) {
  const { marketData } = useAppStore();
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        ≈ {formatMoney(usd, "KZT")} по курсу НБ РК.
      </p>
      <MarketDataNote data={marketData.rate} />
    </div>
  );
}
