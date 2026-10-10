export type BridgeAsset = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  sourceLabel: string;
  description: string;
  mintAddress: string | null;
  logoEmoji: string;
  buyFlow: "onchain";
  priceUsd: number;
};

export const OFFICE_ASSET: BridgeAsset = {
  id: "demo-office",
  slug: "office-building",
  name: "OFFICE · тестовый актив Devnet",
  ticker: "OFFICE",
  sourceLabel: "Тестовый актив, контролируемый приложением в Solana Devnet",
  description: "1 OFFICE выпускается за 1 TEST QUOTE. OFFICE не предоставляет прав на недвижимость или денежную выплату.",
  mintAddress: null,
  logoEmoji: "🧪",
  buyFlow: "onchain",
  priceUsd: 1,
};

export const BRIDGE_ASSETS: BridgeAsset[] = [OFFICE_ASSET];
