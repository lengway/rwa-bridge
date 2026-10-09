"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { AssetFacts, ExistingHolding, TowerArtwork } from "@/components/app/asset-parts";
import { BuyAssetDrawer } from "@/components/app/buy-asset-drawer";
import { DetailActionBar } from "@/components/app/detail-action-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import type { BridgeAsset } from "@/lib/assets";
import { useAppStore } from "@/lib/store";

export function AssetDetailScreen({ asset }: { asset: BridgeAsset }) {
  const { cashUsd, displayCurrency, holdings } = useAppStore();
  const [buyOpen, setBuyOpen] = useState(false);
  const holding = holdings[asset.id];

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <TowerArtwork />
        <div className="flex items-center gap-2">
          <Badge variant="outline">{asset.ticker}</Badge>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{asset.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Доля в офисной недвижимости</p>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{asset.description}</p>
      </section>

      {holding ? <ExistingHolding units={holding.units} costUsd={holding.costUsd} /> : null}
      <AssetFacts asset={asset} />

      <Card className="gap-3 rounded-2xl p-4">
        <h2 className="font-semibold">Что означает доля</h2>
        <p className="text-sm leading-5">1 {asset.ticker} = $1 доли объекта. Количество токенов соответствует сумме покупки в долларах.</p>
      </Card>

      <DetailActionBar
        amount={formatMoney(cashUsd, displayCurrency)}
        note={cashUsd < 10 ? "Пополните баланс хотя бы на $10, чтобы продолжить." : undefined}
      >
        <Button className="h-11 flex-1" onClick={() => setBuyOpen(true)} disabled={cashUsd < 10}>
          <ArrowRight />Купить от $10
        </Button>
      </DetailActionBar>
      <BuyAssetDrawer open={buyOpen} onOpenChange={setBuyOpen} asset={asset} />
    </div>
  );
}
