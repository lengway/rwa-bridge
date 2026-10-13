"use client";

import Link from "next/link";
import { AssetListCard, ExistingHolding } from "@/components/app/asset-parts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { BRIDGE_ASSETS } from "@/lib/assets";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import { formatQuantity } from "@/lib/format";

export function AssetsScreen() {
  const devnet = useDevnet();
  return <div className="space-y-5"><div><h2 className="text-xl font-semibold">Your assets</h2><p className="mt-1 text-sm text-muted-foreground">Balances and positions in your wallet.</p></div><Link href="/portfolio" className="block"><Card className="flex-row items-center gap-4 rounded-2xl p-5"><span className="flex size-12 items-center justify-center rounded-full bg-sky-500/10 text-xl font-semibold text-sky-600">$</span><div className="flex-1"><p className="font-semibold">USDC</p><p className="mt-1 text-xs text-muted-foreground">Available balance</p></div><p className="font-semibold tabular-nums">{devnet.portfolio ? formatQuantity(devnet.portfolio.cashUsd) : "—"}</p></Card></Link><Link href="/earn/kamino-lend" className="block"><Card className="gap-2 rounded-2xl p-5"><h3 className="font-semibold">Kamino Lend</h3><p className="text-sm text-muted-foreground">Your USDC lending position. Withdrawals depend on reserve liquidity.</p><span className="text-sm font-medium">View position →</span></Card></Link><p className="text-xs text-muted-foreground">Other tokens and earlier positions remain available in Portfolio.</p></div>;
}

export function ArchivedAssetsScreen() {
  const { holdings } = useAppStore();
  const asset = BRIDGE_ASSETS[0];
  const holding = holdings[asset.id];

  return (
    <div className="space-y-6">
      {holding ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Your test asset</h2>
          <Link href={`/assets/${asset.slug}`} className="block">
            <ExistingHolding units={holding.units} costUsd={holding.costUsd} />
          </Link>
        </section>
      ) : null}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Devnet test asset</h2>
          <Badge variant="secondary">SOLANA DEVNET</Badge>
          <Badge variant="outline">NO MONETARY VALUE</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          OFFICE is a test asset controlled by the app on Solana Devnet. 1 OFFICE
          is issued for 1 TEST QUOTE; it grants no rights to real estate and has no monetary
          value.
        </p>
      </section>
      <AssetListCard asset={asset} />

      <section className="space-y-2 pt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">RWA · Solana Devnet</h2>
          <Badge variant="secondary">SOLANA DEVNET</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          A digital share in a Solana Devnet portfolio. Open the asset to
          see the purchase terms.
        </p>
        <Link href="/assets/rwa" className="block">
          <Card className="gap-2 rounded-2xl p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">RWA · Solana Devnet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Choose an amount, review the terms and confirm the purchase.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">Open →</span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Solana Devnet environment · test funds, no rights to a real asset.
            </p>
          </Card>
        </Link>
      </section>
    </div>
  );
}
