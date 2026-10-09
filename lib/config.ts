export const crossmintApiKey = process.env.NEXT_PUBLIC_CROSSMINT_API_KEY ?? "";
export const coinbaseOnrampAppId = process.env.NEXT_PUBLIC_COINBASE_ONRAMP_APP_ID ?? "";
export const aifcAssetPartnerId = process.env.NEXT_PUBLIC_AIFC_ASSET_PARTNER_ID ?? "";

export const isCrossmintConfigured = crossmintApiKey.length > 0;
export const isOnrampConfigured = coinbaseOnrampAppId.length > 0;

// The chain the embedded wallet is created on. Crossmint decides devnet vs mainnet by
// whether the API key is a "staging" or "production" key, not by this value — so a
// staging key here means this is Solana devnet, no separate flag needed.
export const walletChain = "solana" as const;
