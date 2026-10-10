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
          <h2 className="text-lg font-semibold">Ваш тестовый актив</h2>
          <Link href={`/assets/${asset.slug}`} className="block">
            <ExistingHolding units={holding.units} costUsd={holding.costUsd} />
          </Link>
        </section>
      ) : null}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Тестовый актив Devnet</h2>
          <Badge variant="secondary">DEVNET DEMO</Badge>
          <Badge variant="outline">NO MONETARY VALUE</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          OFFICE — тестовый актив, контролируемый приложением в Solana Devnet. 1 OFFICE
          выпускается за 1 TEST QUOTE; он не даёт прав на недвижимость и не имеет денежной
          стоимости.
        </p>
      </section>
      <AssetListCard asset={asset} />

      <section className="space-y-2 pt-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">RWA-DEMO</h2>
          <Badge variant="secondary">ДЕМО</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          Цифровая доля в демонстрационном портфеле. Откройте актив, чтобы
          посмотреть условия покупки.
        </p>
        <Link href="/assets/rwa-demo" className="block">
          <Card className="gap-2 rounded-2xl p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">RWA-DEMO</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Выберите сумму, проверьте условия и подтвердите покупку.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">Открыть →</span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Демо-среда · тестовые средства, без прав на реальный актив.
            </p>
          </Card>
        </Link>
      </section>
    </div>
  );
}
