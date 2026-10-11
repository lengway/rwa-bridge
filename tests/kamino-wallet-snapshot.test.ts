import assert from "node:assert/strict";
import test from "node:test";
import { KAMINO_LEND_DEVNET as route } from "../lib/kamino-lend-devnet-config";
import { normalizeKaminoWalletSnapshot, kaminoActionMaximum, isCanonicalAtomic } from "../lib/kamino-wallet-snapshot";

const input = { network: "devnet", walletAddress: "wallet", mint: route.liquidityMint,
  collateralMint: route.collateralMint, decimals: 6, liquidityAmountAtomic: "2000000",
  collateralAmountAtomic: "4000000", estimatedUnderlyingAmountAtomic: "4500000", solBalanceLamports: 10000000 };

test("wallet snapshot is pinned to the authenticated wallet, cluster and assets", () => {
  assert.equal(normalizeKaminoWalletSnapshot(input, "wallet")?.solBalanceLamports, "10000000");
  for (const changed of [{ network: "mainnet-beta" }, { walletAddress: "another" }, { mint: "wrong" },
    { collateralMint: "wrong" }, { decimals: 9 }, { solBalanceLamports: Number.MAX_SAFE_INTEGER + 1 },
    { liquidityAmountAtomic: "0\n" }]) {
    assert.equal(normalizeKaminoWalletSnapshot({ ...input, ...changed }, "wallet"), null);
  }
});

test("Max respects balance, per-action cap and withdrawal liquidity without float math", () => {
  const wallet = normalizeKaminoWalletSnapshot(input, "wallet")!;
  assert.equal(kaminoActionMaximum({ action: "deposit", cap: "1000000", reserveLiquidity: null, wallet }), "1000000");
  assert.equal(kaminoActionMaximum({ action: "withdraw", cap: "1000000", reserveLiquidity: "300000", wallet }), "300000");
  assert.equal(kaminoActionMaximum({ action: "deposit", cap: "1000000", reserveLiquidity: null,
    wallet: { ...wallet, liquidityAmountAtomic: "250000" } }), "250000");
  assert.equal(kaminoActionMaximum({ action: "deposit", cap: "1000000", reserveLiquidity: null, wallet: null }), null);
  assert.equal(kaminoActionMaximum({ action: "withdraw", cap: "1000000", reserveLiquidity: null, wallet }), null);
  assert.equal(kaminoActionMaximum({ action: "deposit", cap: "18446744073709551615", reserveLiquidity: null,
    wallet: { ...wallet, liquidityAmountAtomic: "9007199254740993" } }), "9007199254740993");
});

test("atomic display inputs reject non-canonical numbers instead of showing a fake zero", () => {
  for (const value of [0, "-1", "00", "1.2", "1e6", "NaN", "1\n", " 1", ""]) assert.equal(isCanonicalAtomic(value), false);
  assert.equal(isCanonicalAtomic("0"), true);
});
