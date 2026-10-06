export type AssetSource = "xstocks" | "aifc-mock";

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
 * Local rail: a stand-in for a future AIFC-issued token (e.g. the kind of commercial
 * real-estate pilot referenced in the project's research, such as Iconic Tower /
 * Birlik). No real AIFC partner or contract exists yet, so this issues our own ICT-DEMO
 * SPL token on Solana devnet (1 token = $1 of the share) — a real, testable transfer,
 * standing in for what a licensed AFSA partner's token would later be.
 */
export const AIFC_MOCK_ASSET: BridgeAsset = {
  id: "aifc-mock-iconic-tower",
  name: "Iconic Tower (демо-доля)",
  ticker: "ICT-DEMO",
  source: "aifc-mock",
  sourceLabel: "AIFC — демо, не реальный эмитент",
  description:
    "Мок-актив вместо реального казахстанского RWA-токена. Показывает, как будет выглядеть покупка доли местной недвижимости, когда появится лицензированный партнёр.",
  mintAddress: null,
  logoEmoji: "🏢",
  buyFlow: "spl-demo-mint",
  demoPriceUsd: 40,
};

export const DEMO_ASSETS: BridgeAsset[] = [AIFC_MOCK_ASSET, XSTOCKS_DEMO_ASSET];
