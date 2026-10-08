"use client";

import Link from "next/link";
import { BriefcaseBusiness } from "lucide-react";
import { AssetListCard, ExistingHolding } from "@/components/app/asset-parts";
import { Card } from "@/components/ui/card";
import { DEMO_ASSETS } from "@/lib/assets";
import { useAppStore } from "@/lib/store";

export function AssetsScreen() {
  const { holdings } = useAppStore();
  const ownedAssets = DEMO_ASSETS.flatMap((asset) => {
    const holding = holdings[asset.id];
    return holding ? [{ asset, holding }] : [];
  });

  return (
    <div className="space-y-6">
      {ownedAssets.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Ваши доли</h2>
          <div className="space-y-2">
            {ownedAssets.map(({ asset, holding }) => (
              <Link key={asset.id} href={`/assets/${asset.id}`} className="block">
                <ExistingHolding units={holding.units} costUsd={holding.costUsd} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Доли в недвижимости</h2>
        <p className="text-sm leading-5 text-muted-foreground">
          Знакомьтесь с покупкой долей на примере демо-токена. Реальный объект не продаётся.
        </p>
      </section>
      <AssetListCard asset={DEMO_ASSETS.find((asset) => asset.source === "demo")!} />
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Акции</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Карточка будущего раздела. Покупки пока недоступны.
          </p>
        </div>
        <AssetListCard asset={DEMO_ASSETS.find((asset) => asset.source === "xstocks")!} />
      </section>
      <Card className="flex-row items-start gap-3 rounded-2xl p-4">
        <BriefcaseBusiness className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-5 text-muted-foreground">
          Демо-покупки уменьшают только баланс этого приложения. Они не подтверждают право на реальную недвижимость или акции.
        </p>
      </Card>
    </div>
  );
}
