import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { simpleEarnBalances } from "../lib/simple-earn-balances";
import { buildKaminoPortfolio } from "../lib/kamino-portfolio";
import { SimpleEarnSummary } from "../components/app/simple-earn-summary";
import { QuickActions } from "../components/app/home-actions";
import { PreparedActionReview } from "../components/app/kamino-lend-drawer";
import { KAMINO_LEND_DEVNET as route } from "../lib/kamino-lend-devnet-config";

const position = { walletAddress: "wallet", collateralAmountAtomic: "500000", liquidityAmountAtomic: "250000",
  estimatedUnderlyingAmountAtomic: "600000", solBalanceLamports: 10000000,
  liquidityTokenAccount: "usdc-ata", collateralTokenAccount: "collateral-ata" };

test("only real route USDC and estimated Kamino value feed the two simple balances", () => {
  const portfolio = buildKaminoPortfolio(position, []);
  portfolio.holdings.push({ ...portfolio.holdings[0], mint: "other-demo-mint", balance: 1000, valueUsd: 1000, ticker: "TEST QUOTE" });
  portfolio.totalValueUsd += 1000;
  assert.deepEqual(simpleEarnBalances(portfolio), { available: 0.25, invested: 0.6, hasOtherTokens: true });
});

test("unavailable or invalid simple balances never turn into zero", () => {
  assert.equal(simpleEarnBalances(null), null);
  const portfolio = buildKaminoPortfolio(position, []);
  portfolio.holdings[0].balance = Number.NaN;
  assert.equal(simpleEarnBalances(portfolio), null);
  const html = renderToStaticMarkup(createElement(SimpleEarnSummary, { available: null, invested: null, unavailable: true }));
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, />0</);
});

test("the primary actions are exactly Invest and Withdraw", () => {
  const html = renderToStaticMarkup(createElement(QuickActions, { onInvest: () => undefined, onWithdraw: () => undefined }));
  assert.equal((html.match(/<button\b/g) ?? []).length, 2);
  assert.match(html, />Invest</);
  assert.match(html, />Withdraw</);
  assert.doesNotMatch(html, /Supply|Reserve|Activity|cUSDC/);
});

test("the simple summary explains estimated withdrawal without exposing required protocol jargon", () => {
  const html = renderToStaticMarkup(createElement(SimpleEarnSummary, { available: 0.25, invested: 0.6 }));
  assert.match(html, /Available to invest/);
  assert.match(html, /Invested/);
  assert.match(html, /Estimated withdrawal value/);
  assert.doesNotMatch(html, /cUSDC|Reserve|Mint|Guaranteed|APY/);
});

test("confirmation still shows amount, Devnet and exact quoted fee before wallet approval", () => {
  const html = renderToStaticMarkup(createElement(PreparedActionReview, {
    walletAddress: "11111111111111111111111111111111",
    reserve: { address: route.reserve, mint: route.liquidityMint, collateralMint: route.collateralMint,
      decimals: 6, availableLiquidityAtomic: "10000000", maximumAmountAtomic: "1000000" },
    prepared: { actionId: "12345678-1234-1234-1234-123456789abc", action: "deposit", network: "devnet",
      serializedTransaction: "unused", amountAtomic: "100000", collateralAmountAtomic: null,
      blockhash: "unused", lastValidBlockHeight: 1, expiresAt: Date.now()+90000,
      market: route.market, reserve: route.reserve,
      networkFeeLamports: "5000", transactionMessageDigest: "a".repeat(64),
      simulation: { ok: true, unitsConsumed: 12345 } },
  }));
  assert.match(html, /0\.1 USDC/);
  assert.match(html, /Solana/);
  assert.match(html, /0\.000005 SOL/);
  assert.match(html, /Nothing has been sent yet/);
});
