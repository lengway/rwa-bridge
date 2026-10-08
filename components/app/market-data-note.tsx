import { formatDataDate, type DatedMetric, type KztRateData } from "@/lib/market-data";

export function MarketDataNote({ data, plain = false }: { data: DatedMetric | KztRateData; plain?: boolean }) {
  const manualUpdate = "manualUpdate" in data && data.manualUpdate;
  return (
    <span className="text-xs text-muted-foreground">
      {plain ? (
        data.source.name
      ) : (
        <a href={data.source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {data.source.name}
        </a>
      )}
      {" · "}{formatDataDate(data.asOf)}
      {data.stale ? (manualUpdate ? " · ориентир" : " · устарело") : null}
    </span>
  );
}
