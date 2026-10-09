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
  name: "Офисное здание класса A",
  ticker: "OFFICE",
  sourceLabel: "Доля в объекте коммерческой недвижимости",
  description: "1 OFFICE = $1 доли в объекте.",
  mintAddress: null,
  logoEmoji: "🏢",
  buyFlow: "onchain",
  priceUsd: 1,
};

export const BRIDGE_ASSETS: BridgeAsset[] = [OFFICE_ASSET];
