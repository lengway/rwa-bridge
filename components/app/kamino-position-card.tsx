import { PiggyBank } from "lucide-react";
import { Card } from "@/components/ui/card";
import { displayEarnedAtomic } from "@/lib/earn-performance";
import type { EarnOverview } from "@/lib/useEarnOverview";

const DIGITS = /^-?\d+$/;

/** Display-only conversion; exact atomic strings stay on the server. */
export function formatUsdcAtomic(atomic: string | null | undefined, { signed = false } = {}) {
  if (atomic == null || !DIGITS.test(atomic)) return "—";
  const value = Number(atomic) / 1e6;
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const sign = value < 0 ? "−" : signed && value > 0 ? "+" : "";
  return `${sign}${text} USDC`;
}

export function hasKaminoPosition(overview: EarnOverview | null) {
  return overview !== null && DIGITS.test(overview.collateralAtomic) && BigInt(overview.collateralAtomic) > BigInt(0);
}

/** Invested, earned and current value; `null` fields are unknown, never zero. */
export function kaminoPositionFigures(overview: EarnOverview) {
  const earned = overview.principalAtomic === null ? null : displayEarnedAtomic(overview.protocolGainAtomic);
  return {
    invested: overview.principalAtomic,
    value: overview.positionAtomic,
    earned,
    earnedPositive: earned !== null && BigInt(earned) > BigInt(0),
    earnedNegative: earned !== null && BigInt(earned) < BigInt(0),
  };
}

export function KaminoPositionCard({ overview }: { overview: EarnOverview }) {
  const figures = kaminoPositionFigures(overview);
  return (
    <Card className="gap-4 rounded-3xl border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-card p-5" aria-label="Your Kamino position">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Your position</p>
          <p className="mt-2 text-sm text-muted-foreground">Current value</p>
          <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums break-all">{formatUsdcAtomic(figures.value)}</p>
        </div>
        <PiggyBank className="size-7 shrink-0 text-emerald-600" />
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-background/70 p-3">
          <dt className="text-xs text-muted-foreground">Invested</dt>
          <dd className="mt-1 font-semibold tabular-nums break-all">{formatUsdcAtomic(figures.invested)}</dd>
        </div>
        <div className="rounded-xl bg-background/70 p-3">
          <dt className="text-xs text-muted-foreground">Earned</dt>
          <dd className={`mt-1 font-semibold tabular-nums break-all ${figures.earnedPositive ? "text-emerald-700 dark:text-emerald-400" : figures.earnedNegative ? "text-destructive" : ""}`}>
            {formatUsdcAtomic(figures.earned, { signed: true })}
          </dd>
        </div>
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">
        {figures.invested === null
          ? "Invested amount is unavailable because part of this position wasn't added through Plain."
          : "Invested is your deposits minus withdrawals. Value is an estimate; withdrawals depend on reserve liquidity."}
      </p>
    </Card>
  );
}

export function KaminoPositionEmpty() {
  return (
    <Card className="flex-row items-center gap-3 rounded-2xl p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <PiggyBank className="size-5 text-muted-foreground" />
      </span>
      <div className="min-w-0">
        <p className="font-medium">No position yet</p>
        <p className="text-xs leading-5 text-muted-foreground">Deposit USDC to start earning. Your invested amount and earnings will show here.</p>
      </div>
    </Card>
  );
}
