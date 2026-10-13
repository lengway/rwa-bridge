"use client";

import { useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { AssetFacts, ExistingHolding, TestAssetArtwork } from "@/components/app/asset-parts";
import { BuyAssetDrawer } from "@/components/app/buy-asset-drawer";
import { DetailActionBar } from "@/components/app/detail-action-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatQuantity } from "@/lib/format";
import type { BridgeAsset } from "@/lib/assets";
import { useAppStore } from "@/lib/store";

export function AssetDetailScreen({ asset }: { asset: BridgeAsset }) {
  const { cashUsd, holdings } = useAppStore();
  const [buyOpen, setBuyOpen] = useState(false);
  const holding = holdings[asset.id];

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <TestAssetArtwork ticker={asset.ticker} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{asset.ticker}</Badge>
          <Badge variant="secondary">SOLANA DEVNET</Badge>
          <Badge variant="outline">NO MONETARY VALUE</Badge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{asset.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Test asset controlled by the app on Solana Devnet</p>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{asset.description}</p>
      </section>

      {holding ? <ExistingHolding units={holding.units} costUsd={holding.costUsd} /> : null}
      <AssetFacts asset={asset} />

      <Card className="gap-3 rounded-2xl p-4">
        <h2 className="font-semibold">About the test asset</h2>
        <p className="text-sm leading-5">1 {asset.ticker} is issued for 1 TEST QUOTE. It is an app test asset: it grants no rights to real estate, a property stake or any cash payout.</p>
      </Card>

      <DetailActionBar
        amount={`${formatQuantity(cashUsd)} TEST QUOTE`}
        note={cashUsd < 10 ? "Prepare at least 10 TEST QUOTE to continue." : undefined}
      >
        <Button className="h-11 flex-1" onClick={() => setBuyOpen(true)} disabled={cashUsd < 10}>
          <ArrowDownToLine />Get from 10 {asset.ticker}
        </Button>
      </DetailActionBar>
      <BuyAssetDrawer open={buyOpen} onOpenChange={setBuyOpen} asset={asset} />
    </div>
  );
}
