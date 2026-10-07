export type AssetSource = "xstocks" | "demo";

export type BridgeAsset = {
  id: string;
  name: string;
  ticker: string;
  source: AssetSource;
  sourceLabel: string;
  description: string;
  /** Solana mint address on mainnet, when known and verified. */
  mintAddress: string | null;
  logoEmoji: string;
  /** Whether a buy flow is actually wired up in this build, or just a card for now. */
  buyFlow: "onramp-plus-swap" | "spl-demo-mint" | "not-wired";
  /** Demo price in mock USDC, spent from the mock balance on purchase. */
  demoPriceUsd: number;
};

/**
 * Real-world rail: Backed Finance's xStocks (tokenized public equities, distributed
 * via Kraken/Bybit, live on Solana). The mint address below is NOT verified against
 * Backed's official docs — treat it as a placeholder and pull the real address from
 * https://xstocks.com or Backed's issuer docs before this touches a real wallet.
 */
export const XSTOCKS_DEMO_ASSET: BridgeAsset = {
  id: "xstocks-aaplx",
  name: "Apple (tokenized)",
  ticker: "AAPLx",
  source: "xstocks",
  sourceLabel: "Backed Finance / xStocks",
  description:
    "Токенизированная акция через открытый контракт xStocks на Solana. Агрегатор читает её, но не даёт голосующих прав акционера — юридически это дериватив.",
  mintAddress: "XsPLACEHOLDERmintAddressVerifyBeforeUse111111",
  logoEmoji: "🍎",
  // A real "buy" here means: onramp fiat -> USDC, then swap USDC -> AAPLx on a DEX.
  // Neither the swap route nor the mint address is verified yet, so this card is
  // intentionally not wired to a working transaction in this build.
  buyFlow: "not-wired",
  demoPriceUsd: 25,
};

/**
 * Fictional demo asset. This issues our own OFFICE-DEMO SPL token on Solana devnet
 * (1 token = $1 of a conditional share) for a real, testable transfer.
 */
export const DEMO_OFFICE_ASSET: BridgeAsset = {
  id: "demo-office",
  name: "Офисное здание (демо-объект)",
  ticker: "OFFICE-DEMO",
  source: "demo",
  sourceLabel: "Демо-объект, не реальный эмитент",
  description:
    "Выдуманный объект для демонстрации: так выглядит покупка доли в коммерческой недвижимости через токен. 1 OFFICE-DEMO = $1 условной доли.",
  mintAddress: null,
  logoEmoji: "🏢",
  buyFlow: "spl-demo-mint",
  demoPriceUsd: 40,
};

export const DEMO_ASSETS: BridgeAsset[] = [DEMO_OFFICE_ASSET, XSTOCKS_DEMO_ASSET];
