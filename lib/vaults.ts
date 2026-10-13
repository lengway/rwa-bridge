import "server-only";

import { devnetConfig } from "@/lib/solana-server";
import { ALL_YIELD_STRATEGIES } from "@/lib/yields";

// Devnet shares settle one-for-one with the Devnet test token. A reference APY
// is useful for an illustrative calculator, but it must never reprice a share
// or be counted as money earned by a position.
export const DEMO_SHARE_PRICE_USD = 1;

export type VaultProduct = {
  productId: string;
  mint: string;
  ticker: string;
};

export const VAULT_PRODUCTS: Record<string, VaultProduct> = {
  "ondo-usdy": {
    productId: "ondo-usdy",
    mint: devnetConfig.vaultUsdyMint,
    ticker: "vUSDY",
  },
  "kz-bond-demo": {
    productId: "kz-bond-demo",
    mint: devnetConfig.vaultKzgbMint,
    ticker: "vKZGB",
  },
};

export async function getVaultQuote(productId: string, now = Date.now()) {
  const strategy = ALL_YIELD_STRATEGIES.find((item) => item.id === productId);
  const vault = VAULT_PRODUCTS[productId];
  if (!strategy || !vault || !vault.mint) throw new Error("Unknown yield product.");

  return {
    productId,
    mint: vault.mint,
    ticker: vault.ticker,
    priceUsd: DEMO_SHARE_PRICE_USD,
    // A numeric rate would be mistaken for earned or provider-derived yield.
    // The first strategy deliberately has no such metric.
    apy: null,
    yieldKind: "illustrative" as const,
    asOf: new Date(now).toISOString(),
  };
}

export async function getVaultQuotes(now = Date.now()) {
  return Promise.all(Object.keys(VAULT_PRODUCTS).map((productId) => getVaultQuote(productId, now)));
}
