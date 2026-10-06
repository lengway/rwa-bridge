export type YieldStrategy = {
  id: string;
  name: string;
  protocol: string;
  chain: "solana";
  description: string;
  apyLabel: string;
  /** Used only to animate demo accrual; a real rate floats with the lending market. */
  demoApy: number;
  feeLabel: string;
  riskLabel: string;
  /** Whether a real deposit transaction is wired up in this build. */
  depositFlow: "mock" | "onchain";
};

/**
 * Our own strategy, not built yet. Planned first version: the user's own wallet
 * supplies USDC to a Solana lending market, no leverage, no pooled vault — so funds
 * never sit in an account we control. The rate here is a labelled demo number,
 * not a market quote.
 */
export const BRIDGE_USDC_STRATEGY: YieldStrategy = {
  id: "bridge-usdc",
  name: "Доход на долларах",
  protocol: "RWA Bridge, в разработке",
  chain: "solana",
  description:
    "USDC с твоего кошелька уходит в кредитный рынок на Solana и приносит процент от заёмщиков. Без плеча, вывести можно в любой момент.",
  apyLabel: "ставка плавающая, в демо 8% годовых",
  demoApy: 0.08,
  feeLabel: "в демо не берётся",
  riskLabel: "Низкий–средний: смарт-контракты кредитного рынка, отрыв USDC от доллара",
  depositFlow: "mock",
};

export const YIELD_STRATEGIES: YieldStrategy[] = [BRIDGE_USDC_STRATEGY];

// Demo clock: one real second counts as one day, so accrual is visible during a pitch.
export const DEMO_DAY_MS = 1000;

export function accrued(principal: number, since: number, apy: number, now: number) {
  const days = (now - since) / DEMO_DAY_MS;
  return principal * apy * (days / 365);
}
