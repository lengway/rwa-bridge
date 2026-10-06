"use client";

import { useState } from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { AssetFacts, ExistingHolding, TowerArtwork } from "@/components/app/asset-parts";
import { BuyAssetDrawer } from "@/components/app/buy-asset-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { type BridgeAsset } from "@/lib/assets";
import { useAppStore } from "@/lib/store";

export function AssetDetailScreen({ asset }: { asset: BridgeAsset }) {
  const { cashUsd, displayCurrency, holdings } = useAppStore();
  const [buyOpen, setBuyOpen] = useState(false);
  const holding = holdings[asset.id];
  const isDemo = asset.source === "aifc-mock";

  if (!isDemo) {
    return (
      <div className="space-y-5">
        <Card className="gap-3 rounded-2xl p-5">
          <Badge variant="outline" className="w-fit">Скоро</Badge>
          <h2 className="text-xl font-semibold">{asset.name}</h2>
          <p className="text-sm leading-5 text-muted-foreground">
            Покупка появится после подключения проверки доступности и торгового маршрута.
          </p>
          <Button className="w-full" disabled>Покупка недоступна</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-28">
      <section className="space-y-4">
        <TowerArtwork />
        <div className="flex items-center gap-2">
          <Badge variant="outline">Демо</Badge>
          <span className="text-xs text-muted-foreground">ICT-DEMO</span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Iconic Tower</h2>
          <p className="mt-1 text-sm text-muted-foreground">Доля в офисной недвижимости</p>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{asset.description}</p>
      </section>

      {holding ? <ExistingHolding units={holding.units} costUsd={holding.costUsd} /> : null}
      <AssetFacts asset={asset} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Что означает доля</h2>
        <Card className="gap-3 rounded-2xl p-4">
          <p className="text-sm leading-5">
            В этом сценарии 1 ICT-DEMO показывает $1 условной доли. Количество долей соответствует сумме покупки в долларах.
          </p>
          <p className="text-sm leading-5 text-muted-foreground">
            Это демонстрационный токен, он не даёт права собственности на реальное здание и не имеет рыночной цены.
          </p>
        </Card>
      </section>

      <Card className="flex-row items-start gap-3 rounded-2xl p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-5 text-muted-foreground">
          Реального предложения Iconic Tower в приложении нет. Покупка изменит только демо-баланс и историю операций.
        </p>
      </Card>

      <div className="fixed inset-x-0 bottom-[4.5rem] z-30 mx-auto w-full max-w-md border-t bg-background/95 p-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Доступно</p>
            <p className="truncate text-sm font-semibold tabular-nums">
              {formatMoney(cashUsd, displayCurrency)}
            </p>
          </div>
          <Button
            className="h-11 flex-1"
            onClick={() => setBuyOpen(true)}
            disabled={cashUsd < 10}
          >
            <ArrowRight />Купить от $10
          </Button>
        </div>
        {cashUsd < 10 ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Пополните демо-баланс хотя бы на $10, чтобы продолжить.
          </p>
        ) : null}
      </div>
      <BuyAssetDrawer open={buyOpen} onOpenChange={setBuyOpen} asset={asset} />
    </div>
  );
}
