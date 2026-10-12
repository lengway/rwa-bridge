import { Card } from "@/components/ui/card";
import { formatQuantity } from "@/lib/format";

export function SimpleEarnSummary({ available, invested, unavailable = false }: {
  available: number | null;
  invested: number | null;
  unavailable?: boolean;
}) {
  return (
    <Card className="gap-6 rounded-3xl p-6">
      <div><p className="text-sm text-muted-foreground">Available to invest</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{available === null ? unavailable ? "Unavailable" : "…" : formatQuantity(available)} <span className="text-base font-medium text-muted-foreground">USDC</span></p></div>
      <div className="border-t pt-5"><p className="text-sm text-muted-foreground">Invested</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{invested === null ? unavailable ? "Unavailable" : "…" : formatQuantity(invested)} <span className="text-base font-medium text-muted-foreground">USDC</span></p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Estimated withdrawal value. Returns can change.</p></div>
    </Card>
  );
}
