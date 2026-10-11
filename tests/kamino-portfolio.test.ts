import assert from "node:assert/strict";
import test from "node:test";
import { buildKaminoPortfolio } from "../lib/kamino-portfolio";
import { KAMINO_LEND_DEVNET as route } from "../lib/kamino-lend-devnet-config";

const empty = {
  walletAddress: "wallet", collateralAmountAtomic: "0", liquidityAmountAtomic: "0",
  estimatedUnderlyingAmountAtomic: "0", solBalanceLamports: 10_000_000,
  liquidityTokenAccount: "usdc-ata", collateralTokenAccount: "collateral-ata",
};

test("Kamino portfolio needs no legacy authority or mints and has an honest empty state", () => {
  const result = buildKaminoPortfolio(empty, []);
  assert.deepEqual(result.holdings, []);
  assert.deepEqual(result.positions, []);
  assert.deepEqual(result.activity, []);
  assert.equal(result.wallet.solBalance, 0.01);
  assert.equal(result.cashUsd, 0);
});

test("actual Kamino balances and verified history feed the common portfolio contract", () => {
  const result = buildKaminoPortfolio({ ...empty, liquidityAmountAtomic: "750000", collateralAmountAtomic: "500000", estimatedUnderlyingAmountAtomic: "600000" }, [
    { confirmed: true, status: "COMPLETED", actionId: "deposit-id", action: "deposit", signature: "deposit-signature", actualLiquidityAmountAtomic: "500000", createdAt: 1 },
    { confirmed: true, status: "COMPLETED", actionId: "withdraw-id", action: "withdraw", signature: "withdraw-signature", actualLiquidityAmountAtomic: "100000", createdAt: 2 },
  ]);
  assert.equal(result.cashUsd, 0.75);
  assert.equal(result.totalValueUsd, 1.35);
  assert.equal(result.positions[0].productId, "kamino-lend");
  assert.equal(result.positions[0].valueUsd, 0.6);
  assert.equal(result.positions[0].earnedCarryUsd, 0);
  assert.equal(result.holdings[1].mint, route.collateralMint);
  assert.equal(result.holdings[1].tokenAccount, "collateral-ata");
  assert.equal(result.history[0].type, "withdraw");
  assert.equal(result.history[0].amountUsd, 0.1);
  assert.equal(result.history[0].explorerUrl, "https://explorer.solana.com/tx/withdraw-signature?cluster=devnet");
  assert.deepEqual(result.activity, result.history);
});

test("malformed balance values cannot become a successful portfolio", () => {
  for (const amount of ["NaN", "-1", "1.1", "1e9"]) {
    assert.throws(() => buildKaminoPortfolio({ ...empty, liquidityAmountAtomic: amount }, []));
  }
});
