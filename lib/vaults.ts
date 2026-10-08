import "server-only";

import { getStrategyApy } from "@/lib/market-data";
import { readYieldData } from "@/lib/market-data-server";
import { getVaultCheckpoint, setVaultCheckpoint, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { devnetConfig } from "@/lib/solana-server";
import { YIELD_STRATEGIES } from "@/lib/yields";

const YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

export type VaultProduct = {
  productId: string;
  mint: string;
  ticker: string;
};

export const VAULT_PRODUCTS: Record<string, VaultProduct> = {
  "ondo-usdy": {
    productId: "ondo-usdy",
    mint: devnetConfig.vaultUsdyMint,
    ticker: "vUSDY-DEMO",
  },
  "kz-bond-demo": {
    productId: "kz-bond-demo",
    mint: devnetConfig.vaultKzgbMint,
    ticker: "vKZGB-DEMO",
  },
};

export async function getVaultQuote(productId: string, now = Date.now()) {
  const strategy = YIELD_STRATEGIES.find((item) => item.id === productId);
  const vault = VAULT_PRODUCTS[productId];
  if (!strategy || !vault || !vault.mint) throw new Error("Неизвестный продукт дохода.");

  return withLedgerKeyLock(`vault-checkpoint:${productId}`, async () => {
    const yields = await readYieldData();
    const apy = Math.max(0, getStrategyApy(productId, yields));
    let checkpoint = await getVaultCheckpoint(productId);
    if (!checkpoint) {
      checkpoint = { price: 1, at: now, apy };
      await setVaultCheckpoint(productId, checkpoint);
    }

    const elapsed = Math.max(0, now - checkpoint.at);
    const priceUsd = checkpoint.price * Math.pow(1 + checkpoint.apy, elapsed / YEAR_MS);
    if (apy !== checkpoint.apy) {
      checkpoint = { price: priceUsd, at: now, apy };
      await setVaultCheckpoint(productId, checkpoint);
    }

    return {
      productId,
      mint: vault.mint,
      ticker: vault.ticker,
      priceUsd,
      apy,
      asOf: new Date(now).toISOString(),
    };
  });
}

export async function getVaultQuotes(now = Date.now()) {
  return Promise.all(Object.keys(VAULT_PRODUCTS).map((productId) => getVaultQuote(productId, now)));
}
