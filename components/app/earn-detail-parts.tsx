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
  if (strategy.id === "kamino-lend") return "Devnet USDC";
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
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Devnet status and disclosures">
      <Badge variant="secondary">SOLANA DEVNET</Badge>
      {!primaryOnly ? (
        <>
          {gateway.fundingKind === "ONCHAIN" ? <Badge variant="outline">WALLET-SIGNED</Badge> : <Badge variant="outline">FUNDING UNAVAILABLE</Badge>}
          {gateway.yieldKind === "PROTOCOL_VARIABLE" ? <Badge variant="outline">VARIABLE PROTOCOL RATE</Badge> : <Badge variant="outline">RATE UNAVAILABLE</Badge>}
        </>
      ) : null}
      <Badge variant="outline">NO MONETARY VALUE</Badge>
      {includeAvailability ? (
        <Badge variant={canInvest ? "secondary" : "outline"}>
          {canInvest ? "DEVNET AVAILABLE" : canRedeem ? "EXIT ONLY" : "UNAVAILABLE"}
        </Badge>
      ) : null}
    </div>
  );
}

export function RiskBadge({ strategy }: { strategy: YieldStrategy }) {
  return <Badge variant="secondary">{strategy.id === "kamino-lend" ? "Protocol risk" : strategy.id === "kz-bond-demo" ? "Higher risk" : "Medium risk"}</Badge>;
}

export function ProductSummary({ strategy }: { strategy: YieldStrategy }) {
  const gateway = getGatewayInfo(strategy);
  const apyBps = gateway.yield.apyBps;
  const hasIllustrativeApy = gateway.yieldKind === "ILLUSTRATIVE"
    && typeof apyBps === "number"
    && Number.isFinite(apyBps);
  const hasVariableProtocolRate = gateway.yieldKind === "PROTOCOL_VARIABLE";
  const apy = hasIllustrativeApy ? apyBps / 10_000 : Number.NaN;
  return (
    <section className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge strategy={strategy} />
        <Badge variant="outline">{displayStrategyTicker(strategy)}</Badge>
      </div>
      <GatewayDisclosureBadges strategy={strategy} includeAvailability primaryOnly />
      <div>
        <p className="text-sm text-muted-foreground">{displayStrategyName(strategy)}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className={`font-semibold tracking-tight tabular-nums ${hasIllustrativeApy ? "text-5xl text-emerald-700 dark:text-emerald-400" : hasVariableProtocolRate ? "text-xl text-emerald-700 dark:text-emerald-400" : "text-lg text-muted-foreground"}`}>
            {hasIllustrativeApy ? formatApy(apy) : hasVariableProtocolRate ? "Variable" : "Unavailable"}
          </p>
          <p className="text-sm text-muted-foreground">{hasIllustrativeApy ? "illustrative APY" : hasVariableProtocolRate ? "protocol rate" : "rate unavailable"}</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {hasVariableProtocolRate
            ? "Variable protocol rate: rate and liquidity depend on current reserve conditions. No numeric rate is shown; the rate is not guaranteed."
            : hasIllustrativeApy
            ? "Illustrative yield: a Devnet-only estimate, not actual earnings or an amount credited to your balance."
            : "No numeric rate is shown or promised for this route."}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{presentDevnetCopy(gateway.yield.sourceNote)}</p>
      </div>
      <p className="text-sm leading-6">{presentDevnetCopy(strategy.description)}</p>
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
            <h2 className="font-semibold">Variable reserve rate</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Kamino Lend sets the rate and withdrawal availability based on current reserve conditions. No projection
              or promised APY is shown.
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
            <h2 className="font-semibold">Rate unavailable</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              No numeric rate is set for this Devnet entry. The projection is hidden to avoid presenting an unverified
              return.
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
            Devnet-only estimate; excludes fees and price changes. It is not actual or guaranteed earnings.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Source / mode: {presentDevnetCopy(gateway.sourceLabel)}.</p>
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
