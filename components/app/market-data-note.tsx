import { formatApy } from "@/lib/format";
import { formatDataDate, type DatedMetric, type KztRateData } from "@/lib/market-data";

export function marketApyLabel(apy: number, available: boolean) {
  return available ? formatApy(apy) : "Loading rate…";
}

export function MarketDataNote({
  data,
  plain = false,
  loadingText = "Loading rate…",
}: {
  data: DatedMetric | KztRateData | null;
  plain?: boolean;
  loadingText?: string;
}) {
  if (!data) return <span className="text-xs text-muted-foreground">{loadingText}</span>;
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
      {data.stale ? (manualUpdate ? " · reference" : " · outdated") : null}
    </span>
  );
}
