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
}: {
  strategy: YieldStrategy;
  includeAvailability?: boolean;
}) {
  const gateway = getGatewayInfo(strategy);
  const canInvest = canInvestInStrategy(strategy);
  const canRedeem = canRedeemStrategy(strategy);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Дисклеймеры стратегии Solana Devnet">
      <Badge variant="secondary">SOLANA DEVNET</Badge>
      {gateway.fundingKind === "ONCHAIN" ? <Badge variant="outline">USER-SIGNED ON-CHAIN</Badge> : <Badge variant="outline">FUNDING UNAVAILABLE</Badge>}
      {gateway.yieldKind === "PROTOCOL_VARIABLE" ? <Badge variant="outline">VARIABLE PROTOCOL RATE</Badge> : <Badge variant="outline">RATE UNAVAILABLE</Badge>}
      <Badge variant="outline">NO MONETARY VALUE</Badge>
      {includeAvailability ? (
        <Badge variant={canInvest ? "secondary" : "outline"}>
          {canInvest ? "DEVNET AVAILABLE" : canRedeem ? "EXIT ONLY" : "UNAVAILABLE"}
        </Badge>
      ) : null}
    </div>
  );
}

export function GatewayDisclosureCard({ strategy }: { strategy: YieldStrategy }) {
  const gateway = getGatewayInfo(strategy);
  const canRedeem = canRedeemStrategy(strategy);
  return (
    <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">
      <GatewayDisclosureBadges strategy={strategy} includeAvailability />
      {gateway.provider === "KAMINO" ? (
        <p>
          Приложение строит и симулирует транзакцию для закреплённого Kamino Lend Devnet reserve. Подпись, отправка и
          оплата сетевой комиссии выполняются только подключённым кошельком; завершение показывается после проверки в сети.
        </p>
      ) : canRedeem ? (
        <p>
          Новые пополнения отключены. Историческую Devnet-позицию можно только завершить через пользовательскую
          Devnet-транзакцию;
          это не денежная выплата.
        </p>
      ) : (
        <p>
          Эта карточка доступна только для исследования. Новые пополнения отключены, пока совместимая Devnet-стратегия
          и её условия не подтверждены.
        </p>
      )}
      <p>Источник / режим: {presentDevnetCopy(gateway.sourceLabel)}.</p>
      {gateway.disclosures.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4">
          {gateway.disclosures.map((disclosure) => <li key={disclosure.label}>{presentDevnetCopy(disclosure.text)}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function RiskBadge({ strategy }: { strategy: YieldStrategy }) {
  return <Badge variant="secondary">{strategy.id === "kamino-lend" ? "Риск: протокольный" : strategy.id === "kz-bond-demo" ? "Риск: повышенный" : "Риск: средний"}</Badge>;
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
      <GatewayDisclosureBadges strategy={strategy} includeAvailability />
      <div>
        <p className="text-sm text-muted-foreground">{displayStrategyName(strategy)}</p>
        <div className="mt-1 flex items-baseline gap-2">
          <p className={`font-semibold tracking-tight tabular-nums ${hasIllustrativeApy ? "text-5xl text-emerald-700 dark:text-emerald-400" : hasVariableProtocolRate ? "text-xl text-emerald-700 dark:text-emerald-400" : "text-lg text-muted-foreground"}`}>
            {hasIllustrativeApy ? formatApy(apy) : hasVariableProtocolRate ? "Variable" : "Unavailable"}
          </p>
          <p className="text-sm text-muted-foreground">{hasIllustrativeApy ? "illustrative APY" : hasVariableProtocolRate ? "protocol rate" : "ставка не задана"}</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {hasVariableProtocolRate
            ? "VARIABLE PROTOCOL RATE: ставка и ликвидность зависят от текущего состояния резерва. Числовое значение не показывается и не гарантируется."
            : hasIllustrativeApy
            ? "ILLUSTRATIVE YIELD: оценка для Solana Devnet, не фактическая доходность и не начисляется на баланс."
            : "Для этого маршрута числовая ставка не показывается и не обещается."}
        </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{presentDevnetCopy(gateway.yield.sourceNote)}</p>
      </div>
        <p className="text-sm leading-6">{presentDevnetCopy(strategy.description)}</p>
      <GatewayDisclosureCard strategy={strategy} />
      <p className="rounded-xl border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        Не банковский вклад, не застраховано фондом гарантирования депозитов. Доход не гарантирован.
      </p>
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
            <h2 className="font-semibold">Переменная ставка резерва</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Kamino Lend определяет ставку и доступность вывода из текущего состояния резерва. Чтобы не создавать
              непроверенный прогноз, приложение не строит доходность и не показывает обещанный APY.
            </p>
          </div>
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
        <GatewayDisclosureBadges strategy={strategy} />
        <p className="text-xs leading-5 text-muted-foreground">{presentDevnetCopy(gateway.yield.sourceNote)}</p>
      </Card>
    );
  }

  if (!hasIllustrativeApy) {
    return (
      <Card className="gap-3 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Ставка недоступна</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Для этой Devnet-карточки не задана числовая ставка. Расчёт скрыт, чтобы не создавать непроверенную
              доходность.
            </p>
          </div>
          <Sparkles className="size-5 text-muted-foreground" />
        </div>
        <GatewayDisclosureBadges strategy={strategy} />
        <p className="text-xs leading-5 text-muted-foreground">{presentDevnetCopy(gateway.yield.sourceNote)}</p>
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
          <h2 className="font-semibold">Иллюстративный расчёт доходности</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            ILLUSTRATIVE YIELD: расчёт для Solana Devnet, без учёта комиссий и изменения цены.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Источник / режим: {presentDevnetCopy(gateway.sourceLabel)}.</p>
        </div>
        <Sparkles className="size-5 text-emerald-700 dark:text-emerald-400" />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">Сумма для примера</p>
        <p className="text-lg font-semibold tabular-nums">{formatQuantity(amount)} TEST QUOTE</p>
      </div>
      <Slider
        aria-label="Сумма для иллюстративного расчёта"
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
        <ProjectedReturn label="Иллюстрация за месяц" amount={amount * apy / 12} />
        <ProjectedReturn label="Иллюстрация за год" amount={amount * apy} />
      </div>
      <ProjectionChart amount={amount} projection={projection} points={points} years={years} />
      {currentPosition ? (
        <p className="text-xs text-muted-foreground">
          Тестовые доли в позиции: {formatQuantity(currentPosition.value)} TEST QUOTE; отображаемое изменение: {formatQuantity(currentPosition.earned)} TEST QUOTE. Это не выплаченный доход.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Этот пример не означает начисление или гарантированную выплату.
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
      <p className="mb-2 text-xs font-medium">Иллюстративная стоимость при неизменной ставке</p>
      <svg
        viewBox="0 0 400 150"
        className="h-32 w-full"
        role="img"
        aria-label={`Иллюстративная проекция от ${formatQuantity(amount)} до ${formatQuantity(projection(5))} TEST QUOTE за пять лет`}
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
                {year} г.
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
