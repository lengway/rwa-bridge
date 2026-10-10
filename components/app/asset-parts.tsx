import Link from "next/link";
import { ArrowRight, Box, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatQuantity } from "@/lib/format";
import type { BridgeAsset } from "@/lib/assets";

export function TestAssetArtwork({ ticker }: { ticker: string }) {
  return (
    <div className="relative flex h-48 items-center justify-center overflow-hidden rounded-2xl border bg-muted/60 px-8" role="img" aria-label={`${ticker}: тестовый актив в Solana Devnet`}>
      <div className="absolute size-40 rounded-full border bg-background/50" />
      <div className="absolute size-28 rounded-full border border-dashed border-muted-foreground/35" />
      <div className="relative z-10 flex size-24 flex-col items-center justify-center gap-2 rounded-full border bg-card shadow-sm">
        <Box className="size-7 text-muted-foreground" />
        <span className="text-xs font-semibold tracking-wide">{ticker}</span>
      </div>
    </div>
  );
}

export function AssetListCard({ asset }: { asset: BridgeAsset }) {
  return (
    <Link href={`/assets/${asset.slug}`} className="block">
      <Card className="gap-4 rounded-2xl p-4 transition-colors hover:bg-muted/40">
        <TestAssetArtwork ticker={asset.ticker} />
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{asset.name}</h2>
              <Badge variant="outline">{asset.ticker}</Badge>
              <Badge variant="secondary">SOLANA DEVNET</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{asset.sourceLabel}</p>
          </div>
          <ArrowRight className="mt-1 size-4 text-muted-foreground" />
        </div>
        <div className="flex items-end justify-between gap-3 border-t pt-3">
          <div>
            <p className="text-sm font-medium">От 10 TEST QUOTE</p>
            <p className="text-xs text-muted-foreground">1 {asset.ticker} = 1 TEST QUOTE · NO MONETARY VALUE</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function AssetFacts({ asset }: { asset: BridgeAsset }) {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <h2 className="font-semibold">Ключевые факты</h2>
      <Fact label="Название" value={asset.name} />
      <Fact label="Формат" value="Тестовый актив приложения" />
      <Fact label="Тикер" value={asset.ticker} />
      <Fact label="Одна единица" value={`1 ${asset.ticker} = 1 TEST QUOTE`} />
      <Fact label="Минимальное действие" value="10 TEST QUOTE" />
      <Fact label="Статус" value="NO MONETARY VALUE" />
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>;
}

export function ExistingHolding({ units, costUsd }: { units: number; costUsd: number }) {
  return (
    <Card className="flex-row items-center gap-3 rounded-2xl p-4">
      <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Ваш тестовый актив</p>
        <p className="text-xs text-muted-foreground">{formatQuantity(units, 0)} OFFICE · NO MONETARY VALUE</p>
      </div>
      <div className="text-right">
        <p className="text-[11px] text-muted-foreground">TEST QUOTE</p>
        <p className="font-medium tabular-nums">{formatQuantity(costUsd)}</p>
      </div>
    </Card>
  );
}
