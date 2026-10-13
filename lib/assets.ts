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
  name: "OFFICE · Devnet test asset",
  ticker: "OFFICE",
  sourceLabel: "Test asset controlled by the app on Solana Devnet",
  description: "1 OFFICE is issued for 1 TEST QUOTE. OFFICE grants no rights to real estate or any cash payout.",
  mintAddress: null,
  logoEmoji: "🧪",
  buyFlow: "onchain",
  priceUsd: 1,
};

export const BRIDGE_ASSETS: BridgeAsset[] = [OFFICE_ASSET];
