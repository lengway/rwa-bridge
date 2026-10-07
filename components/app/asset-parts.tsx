import Link from "next/link";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import type { BridgeAsset } from "@/lib/assets";

export function TowerArtwork() {
  return (
    <div
      className="relative flex h-48 items-end justify-center overflow-hidden rounded-2xl border bg-muted/60 px-8 pb-0"
      role="img"
      aria-label="Иллюстрация офисной башни"
    >
      <div className="absolute inset-x-7 bottom-0 h-12 rounded-t-[2rem] border border-b-0 bg-background/70" />
      <div className="relative z-10 flex h-36 w-24 flex-col items-center justify-evenly rounded-t-2xl border border-b-0 bg-card shadow-sm">
        <Building2 className="size-8 text-muted-foreground" />
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} className="size-2 rounded-sm bg-muted-foreground/35" />
          ))}
        </div>
      </div>
      <div className="absolute bottom-0 left-5 h-20 w-14 rounded-t-xl border border-b-0 bg-background/50" />
      <div className="absolute bottom-0 right-5 h-24 w-16 rounded-t-xl border border-b-0 bg-background/50" />
    </div>
  );
}

export function AssetListCard({ asset }: { asset: BridgeAsset }) {
  if (asset.id === "xstocks-aaplx") {
    return <ComingSoonAssetCard asset={asset} />;
  }

  return (
    <Link href={`/assets/${asset.id}`} className="block">
      <Card className="gap-4 rounded-2xl p-4 transition-colors hover:bg-muted/40">
        <TowerArtwork />
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Офисное здание</h2>
              <Badge variant="outline">Демо</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Доля в офисной недвижимости</p>
          </div>
          <ArrowRight className="mt-1 size-4 text-muted-foreground" />
        </div>
        <div className="flex items-end justify-between gap-3 border-t pt-3">
          <div>
            <p className="text-sm font-medium">От $10</p>
            <p className="text-xs text-muted-foreground">1 OFFICE-DEMO = $1 доли</p>
          </div>
          <span className="text-xs text-muted-foreground">Покупка в демо</span>
        </div>
      </Card>
    </Link>
  );
}

function ComingSoonAssetCard({ asset }: { asset: BridgeAsset }) {
  return (
    <Card className="gap-4 rounded-2xl p-4">
      <div className="flex h-36 items-center justify-center rounded-2xl border bg-muted/50">
        <div className="flex size-16 items-center justify-center rounded-2xl border bg-card text-lg font-semibold">
          A
        </div>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Apple</h2>
          <p className="mt-1 text-sm text-muted-foreground">{asset.ticker} · акции</p>
        </div>
        <Badge variant="outline">Скоро</Badge>
      </div>
      <p className="text-sm leading-5 text-muted-foreground">
        Покупка появится после подключения проверки доступности и торгового маршрута.
      </p>
      <Button variant="outline" className="w-full" disabled>
        Покупка недоступна
      </Button>
    </Card>
  );
}

export function AssetFacts({ asset }: { asset: BridgeAsset }) {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <h2 className="font-semibold">Ключевые факты</h2>
      <Fact label="Название" value={asset.name} />
      <Fact label="Формат" value="Демо-доля недвижимости" />
      <Fact label="Тикер" value={asset.ticker} />
      <Fact label="Одна единица" value="$1 доли" />
      <Fact label="Минимальная покупка" value="$10" />
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function ExistingHolding({ units, costUsd }: { units: number; costUsd: number }) {
  return (
    <Card className="flex-row items-center gap-3 rounded-2xl p-4">
      <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <ShieldCheck className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">В вашем портфеле</p>
        <p className="text-xs text-muted-foreground">{units.toLocaleString("ru-RU")} долей</p>
      </div>
      <p className="font-medium tabular-nums">{formatMoney(costUsd)}</p>
    </Card>
  );
}
