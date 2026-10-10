"use client";

import Link from "next/link";
import { AssetListCard, ExistingHolding } from "@/components/app/asset-parts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BRIDGE_ASSETS } from "@/lib/assets";
import { useAppStore } from "@/lib/store";

export function AssetsScreen() {
  const { holdings } = useAppStore();
  const asset = BRIDGE_ASSETS[0];
  const holding = holdings[asset.id];

  return (
    <div className="space-y-6">
      {holding ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Ваши доли</h2>
          <Link href={`/assets/${asset.slug}`} className="block">
            <ExistingHolding units={holding.units} costUsd={holding.costUsd} />
          </Link>
        </section>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Доли в недвижимости</h2>
        <p className="text-sm leading-5 text-muted-foreground">
          Объект представлен токеном OFFICE. 1 токен = $1 доли объекта.
        </p>
      </section>
      <AssetListCard asset={asset} />

      <section className="space-y-2 pt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Devnet demo</h2>
          <Badge variant="secondary">DEVNET DEMO</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          A separate direct-Meteora test-token flow. It does not represent a real
          asset, KZT payment, or payout.
        </p>
        <Link href="/assets/rwa-demo" className="block">
          <Card className="gap-2 rounded-2xl p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">RWA-DEMO</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Configured Devnet quote token ↔ RWA-DEMO via a direct Meteora DLMM Devnet pool.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">Open →</span>
            </div>
            <p className="text-xs text-muted-foreground">
              DEVNET TEST TOKEN — no monetary value
            </p>
          </Card>
        </Link>
      </section>
    </div>
  );
}
