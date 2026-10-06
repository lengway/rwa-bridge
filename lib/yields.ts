export type YieldStrategy = {
  id: string;
  name: string;
  ticker: string;
  issuer: string;
  /** "live" = a real token that exists on Solana; "demo" = a clearly labelled stand-in that does not exist. */
  kind: "live" | "demo";
  description: string;
  apyLabel: string;
  /** Used only to animate demo accrual. */
  demoApy: number;
  riskLabel: string;
  eligibilityLabel: string;
  /** Solana mint, copied from the issuer's official docs; null for demo tokens. */
  mintAddress: string | null;
  sourceUrl: string | null;
  /** Whether a real purchase is wired up in this build. */
  depositFlow: "mock" | "onchain";
};

/**
 * Ondo USDY on Solana. Mint from docs.ondo.finance/addresses (checked 2026-10-06);
 * APY from ondo.finance/usdy (3.75% as of 2026-10-02). Real purchase not wired yet:
 * Solana DEX liquidity for USDY is thin, so production needs Ondo-side minting with
 * per-user KYC or a partnership. Open question: Ondo now calls USDY "freely
 * transferrable", older sources describe a 40-day lockup after subscription.
 */
export const ONDO_USDY: YieldStrategy = {
  id: "ondo-usdy",
  name: "Долларовый вклад",
  ticker: "USDY",
  issuer: "Ondo Finance",
  kind: "live",
  description:
    "Токен, обеспеченный краткосрочными гособлигациями США и банковскими депозитами (по описанию Ondo). Доход начисляется через рост цены токена.",
  apyLabel: "~3,75% годовых (ondo.finance, 2 окт 2026)",
  demoApy: 0.0375,
  riskLabel: "Эмитент Ondo, ставка ФРС, ликвидность токена на Solana пока низкая",
  eligibilityLabel: "Не для резидентов США; Казахстан не в списке ограничений Ondo. Для выпуска токена нужен KYC у Ondo",
  mintAddress: "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6",
  sourceUrl: "https://docs.ondo.finance/addresses",
  depositFlow: "mock",
};

/**
 * Stand-in for a future tokenized Kazakh government bond. No such retail token exists
 * as of 2026-10. Yield shown is the KASE government bond index (~14.6% on 2026-10-06)
 * as a reference only. Must stay labelled DEMO and never imply a KASE/AIX/National
 * Bank partnership.
 */
export const KZ_BOND_DEMO: YieldStrategy = {
  id: "kz-bond-demo",
  name: "Тенговые облигации (демо)",
  ticker: "mKZGB-DEMO",
  issuer: "Демо-токен, не существует",
  kind: "demo",
  description:
    "Показывает, как будет выглядеть вклад в токенизированные гособлигации Казахстана, когда такой токен появится у лицензированного эмитента.",
  apyLabel: "ориентир ~14,6% (индекс гособлигаций KASE, 6 окт 2026)",
  demoApy: 0.146,
  riskLabel: "Курс тенге к доллару: высокая ставка частично съедается девальвацией",
  eligibilityLabel: "Токена пока нет — только демонстрация",
  mintAddress: null,
  sourceUrl: null,
  depositFlow: "mock",
};

export const YIELD_STRATEGIES: YieldStrategy[] = [ONDO_USDY, KZ_BOND_DEMO];

// Demo clock: one real second counts as one day, so accrual is visible during a pitch.
export const DEMO_DAY_MS = 1000;

export function accrued(principal: number, since: number, apy: number, now: number) {
  const days = (now - since) / DEMO_DAY_MS;
  return principal * apy * (days / 365);
}
