"use client";

import Link from "next/link";
import { AssetListCard, ExistingHolding } from "@/components/app/asset-parts";
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
    </div>
  );
}
