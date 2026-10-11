import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { KaminoWalletSetup } from "../components/app/kamino-wallet-setup";

const props = { walletAddress: "11111111111111111111111111111111", loading: false,
  error: null, onRefresh: () => undefined, onCopy: () => undefined };

test("wallet setup shows verified test balances with distinct asset units", () => {
  const html = renderToStaticMarkup(createElement(KaminoWalletSetup, { ...props, snapshot: {
    walletAddress: props.walletAddress, liquidityAmountAtomic: "250000", collateralAmountAtomic: "0",
    estimatedUnderlyingAmountAtomic: "0", solBalanceLamports: "10000000",
  } }));
  assert.match(html, />USDC</);
  assert.match(html, /SOL · network fees/);
  assert.match(html, /0\.25/);
  assert.match(html, /0\.01/);
  assert.match(html, /https:\/\/faucet\.circle\.com\//);
  assert.match(html, /https:\/\/faucet\.solana\.com\//);
  assert.match(html, /no monetary value/);
});

test("unknown balances are unavailable, not a fabricated zero or successful top-up", () => {
  const html = renderToStaticMarkup(createElement(KaminoWalletSetup, { ...props, snapshot: null, error: "Balances could not be verified." }));
  assert.match(html, /Balances could not be verified/);
  assert.equal((html.match(/—/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Funds received|Top-up complete/);
});

test("withdrawal guidance does not ask users to fund USDC again", () => {
  const html = renderToStaticMarkup(createElement(KaminoWalletSetup, { ...props, action: "withdraw", snapshot: {
    walletAddress: props.walletAddress, liquidityAmountAtomic: "0", collateralAmountAtomic: "100000",
    estimatedUnderlyingAmountAtomic: "100000", solBalanceLamports: "10000000",
  } }));
  assert.match(html, /do not need to add USDC/);
  assert.doesNotMatch(html, /faucet\.circle\.com/);
});
