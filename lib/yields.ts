export type YieldStrategy = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  issuer: string;
  description: string;
  /** Used when the live market source is temporarily unavailable. */
  fallbackApy: number;
  riskLabel: string;
  eligibilityLabel: string;
  mintAddress: string | null;
  sourceUrl: string | null;
  depositFlow: "onchain";
};

export const ONDO_USDY: YieldStrategy = {
  id: "ondo-usdy",
  slug: "ondo-usdy",
  name: "Долларовый вклад",
  ticker: "vUSDY",
  issuer: "Ondo Finance",
  description: "Цена доли следует доходности USDY, публикуемой Ondo через DefiLlama.",
  fallbackApy: 0.0375,
  riskLabel: "Эмитент Ondo, ставка ФРС, ликвидность токена на Solana пока низкая",
  eligibilityLabel: "Не для резидентов США; Казахстан не в списке ограничений Ondo. Для выпуска токена нужен KYC у Ondo",
  mintAddress: "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6",
  sourceUrl: "https://docs.ondo.finance/addresses",
  depositFlow: "onchain",
};

export const KZ_BOND: YieldStrategy = {
  id: "kz-bond-demo",
  slug: "kz-bond",
  name: "Тенговые облигации",
  ticker: "vKZGB",
  issuer: "Индекс государственных облигаций KASE",
  description: "Ориентир доходности — индекс государственных облигаций KASE.",
  fallbackApy: 0.146,
  riskLabel: "Курс тенге к доллару: высокая ставка частично съедается девальвацией",
  eligibilityLabel: "Доходность приводится как ориентир индекса KASE",
  mintAddress: null,
  sourceUrl: null,
  depositFlow: "onchain",
};

export const YIELD_STRATEGIES: YieldStrategy[] = [ONDO_USDY, KZ_BOND];
