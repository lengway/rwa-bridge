import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { formatApy, formatQuantity } from "@/lib/format";
import type { YieldStrategy } from "@/lib/yields";

export type GatewayInfo = YieldStrategy["gateway"];

export function getGatewayInfo(strategy: YieldStrategy): GatewayInfo {
  return strategy.gateway;
}

export function displayStrategyName(strategy: YieldStrategy) {
  if (strategy.id === "kamino-lend") return "Kamino Lend";
  if (strategy.id === "ondo-usdy") return "Legacy Devnet position";
  if (strategy.id === "kz-bond-demo") return "Historic Devnet shares";
  return strategy.name;
}

export function displayStrategyTicker(strategy: YieldStrategy) {
  if (strategy.id === "kamino-lend") return "USDC";
  return strategy.id === "ondo-usdy" ? "Legacy position" : strategy.ticker;
}

export function presentDevnetCopy(value: string) {
  return value
    .replace(/\bdevnet[ -]demo\b/gi, "Solana Devnet")
    .replace(/\bdemo[- ]only\b/gi, "Solana Devnet only")
    .replace(/\bdemo\b/gi, "Devnet")
    .replace(/демо/giu, "Devnet");
}

export function displayGatewayMode(mode: string) {
  if (mode === "KAMINO") return "KAMINO LEND";
  return mode === "SIMULATED_DEMO" ? "SOLANA DEVNET" : presentDevnetCopy(mode);
}

export function canInvestInStrategy(strategy: YieldStrategy) {
  const gateway = getGatewayInfo(strategy);
  return gateway.network === "devnet"
    && gateway.availability === "ENABLED"
    && gateway.capabilities.deposit;
}

export function canRedeemStrategy(strategy: YieldStrategy) {
  const gateway = getGatewayInfo(strategy);
  return gateway.availability !== "DISABLED" && gateway.capabilities.withdraw;
}

export function GatewayDisclosureBadges({
  strategy,
  includeAvailability = false,
  primaryOnly = false,
}: {
  strategy: YieldStrategy;
  includeAvailability?: boolean;
  primaryOnly?: boolean;
}) {
  const gateway = getGatewayInfo(strategy);
  const canInvest = canInvestInStrategy(strategy);
  const canRedeem = canRedeemStrategy(strategy);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Strategy availability">
      {!primaryOnly ? (
        <>
          {gateway.fundingKind === "ONCHAIN" ? <Badge variant="outline">Wallet approval</Badge> : <Badge variant="outline">Funding unavailable</Badge>}
          {gateway.yieldKind === "PROTOCOL_VARIABLE" ? <Badge variant="outline">Variable rate</Badge> : <Badge variant="outline">Rate unavailable</Badge>}
        </>
      ) : null}
      {includeAvailability ? (
        <Badge variant={canInvest ? "secondary" : "outline"}>
          {canInvest ? "Available" : canRedeem ? "Exit only" : "Unavailable"}
        </Badge>
      ) : null}
    </div>
  );
}

export function RiskBadge({ strategy }: { strategy: YieldStrategy }) {
  return <Badge variant="secondary">{strategy.id === "kamino-lend" ? "Protocol risk" : strategy.id === "kz-bond-demo" ? "Higher risk" : "Medium risk"}</Badge>;
}

/** `liveApy` is the reserve's current supply APY for variable-rate strategies. */
export function ProductSummary({ strategy, liveApy = null }: { strategy: YieldStrategy; liveApy?: number | null }) {
  const gateway = getGatewayInfo(strategy);
  const apyBps = gateway.yield.apyBps;
  const hasIllustrativeApy = gateway.yieldKind === "ILLUSTRATIVE"
    && typeof apyBps === "number"
    && Number.isFinite(apyBps);
  const hasVariableProtocolRate = gateway.yieldKind === "PROTOCOL_VARIABLE";
  const hasLiveApy = hasVariableProtocolRate && liveApy !== null && Number.isFinite(liveApy);
  const apy = hasIllustrativeApy ? apyBps / 10_000 : Number.NaN;
  return (
    <section className="space-y-4 pt-1">
      <div>
        <p className="text-sm text-muted-foreground">{displayStrategyName(strategy)} · {displayStrategyTicker(strategy)}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className={`font-semibold tracking-tight tabular-nums ${hasIllustrativeApy || hasLiveApy ? "text-5xl text-emerald-700 dark:text-emerald-400" : hasVariableProtocolRate ? "text-xl text-emerald-700 dark:text-emerald-400" : "text-lg text-muted-foreground"}`}>
            {hasIllustrativeApy ? formatApy(apy) : hasLiveApy ? formatApy(liveApy) : hasVariableProtocolRate ? "Variable" : "Unavailable"}
          </p>
          <p className="text-sm text-muted-foreground">{hasIllustrativeApy ? "Estimated APY" : hasLiveApy ? "Supply APY · current, variable" : "APY"}</p>
        </div>
      </div>
      <div className="space-y-2 text-sm leading-6">
        <p>{strategy.id === "kamino-lend" ? "Lend USDC at a variable rate." : presentDevnetCopy(strategy.description)}</p>
        <p className="text-xs leading-5 text-muted-foreground">
          {hasVariableProtocolRate
            ? "Rate changes with reserve demand. Withdrawals depend on liquidity."
            : hasIllustrativeApy
              ? "Estimated return."
              : "APY unavailable."}
        </p>
      </div>
    </section>
  );
}

export function ProjectionCalculator({
  strategy,
  amount,
  onAmountChange,
  currentPosition,
}: {
  strategy: YieldStrategy;
  amount: number;
  onAmountChange: (amount: number) => void;
  currentPosition?: { value: number; earned: number };
}) {
  const gateway = getGatewayInfo(strategy);
  const apyBps = gateway.yield.apyBps;
  const hasIllustrativeApy = gateway.yieldKind === "ILLUSTRATIVE"
    && typeof apyBps === "number"
    && Number.isFinite(apyBps);
  const apy = hasIllustrativeApy ? apyBps / 10_000 : Number.NaN;

  if (gateway.yieldKind === "PROTOCOL_VARIABLE") {
    return (
      <Card className="gap-3 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Variable APY</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Changes with reserve demand. Withdrawals depend on liquidity.
            </p>
          </div>
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
      </Card>
    );
  }

  if (!hasIllustrativeApy) {
    return (
      <Card className="gap-3 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">APY unavailable</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              No rate is shown for this strategy.
            </p>
          </div>
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
      </Card>
    );
  }

  const years = [0, 1, 2, 3, 4, 5];
  const projection = (year: number) => amount * (1 + apy * year);
  const points = years.map((year, index) => {
    const x = 40 + index * 64;
    const y = 124 - ((projection(year) / projection(5)) * 94);
    return `${x},${y}`;
  }).join(" ");

  return (
    <Card className="gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Illustrative yield estimate</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimate excludes fees and price changes.
          </p>
        </div>
        <Sparkles className="size-5 text-emerald-700 dark:text-emerald-400" />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">Example amount</p>
        <p className="text-lg font-semibold tabular-nums">{formatQuantity(amount)} TEST QUOTE</p>
      </div>
      <Slider
        aria-label="Illustrative estimate amount"
        value={[amount]}
        min={100}
        max={10000}
        step={100}
        onValueChange={(value) => {
          const nextValue = Array.isArray(value) ? value[0] : value;
          onAmountChange(Number(nextValue));
        }}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>100 TEST QUOTE</span>
        <span>10 000 TEST QUOTE</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ProjectedReturn label="Monthly illustration" amount={amount * apy / 12} />
        <ProjectedReturn label="Yearly illustration" amount={amount * apy} />
      </div>
      <ProjectionChart amount={amount} projection={projection} points={points} years={years} />
      {currentPosition ? (
        <p className="text-xs text-muted-foreground">
          Historic test-token position: {formatQuantity(currentPosition.value)} TEST QUOTE; displayed change: {formatQuantity(currentPosition.earned)} TEST QUOTE. This is not paid income.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          This example does not represent credited earnings or a guaranteed payout.
        </p>
      )}
    </Card>
  );
}

function ProjectedReturn({
  label,
  amount,
}: {
  label: string;
  amount: number;
}) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
        +{formatQuantity(amount)} TEST QUOTE
      </p>
    </div>
  );
}

function ProjectionChart({
  amount,
  projection,
  points,
  years,
}: {
  amount: number;
  projection: (year: number) => number;
  points: string;
  years: number[];
}) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <p className="mb-2 text-xs font-medium">Illustrative value if the rate stayed unchanged</p>
      <svg
        viewBox="0 0 400 150"
        className="h-32 w-full"
        role="img"
        aria-label={`Illustrative projection from ${formatQuantity(amount)} to ${formatQuantity(projection(5))} TEST QUOTE over five years`}
      >
        {[30, 60, 90, 120].map((y) => (
          <line key={y} x1="28" y1={y} x2="390" y2={y} className="stroke-border" strokeWidth="1" />
        ))}
        <polyline
          points={points}
          fill="none"
          className="stroke-emerald-600 dark:stroke-emerald-400"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {years.map((year, index) => {
          const x = 40 + index * 64;
          const y = 124 - ((projection(year) / projection(5)) * 94);
          return (
            <g key={year}>
              <circle cx={x} cy={y} r="3.5" className="fill-emerald-600 dark:fill-emerald-400" />
              <text x={x} y="146" textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                {year} yr
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
