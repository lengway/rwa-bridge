import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { DemoBadge } from "../components/app/demo-badge";
import { DemoBankScreen } from "../components/app/demo-bank-screen";
import { BalanceCard } from "../components/app/home-account";

test("one compact indicator identifies the network without a disclosure wall", () => {
  const html = renderToStaticMarkup(createElement(DemoBadge, { bank: true }));
  assert.match(html, />Devnet</);
  assert.match(html, /fixed right-3 top-3/);
  assert.doesNotMatch(html, /<details|Demo ·|no monetary value|not verified KYC/);
});

test("bank preview presents sample accounts and a working Plain entry, not live bank rails", () => {
  const html = renderToStaticMarkup(createElement(DemoBankScreen, { onOpenPlain: () => undefined }));
  assert.match(html, /Forma Bank/);
  assert.match(html, /Sample account/);
  assert.match(html, /Sample card/);
  assert.match(html, /Sample transactions/);
  assert.match(html, />Plain</);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Guaranteed|Identity verified|Payment sent|KYC approved|Launch sandbox widget/);
});

test("portfolio copy uses actual USDC and estimated USD without inventing earnings", () => {
  const html = renderToStaticMarkup(createElement(BalanceCard, { total: 1.25, cashUsd: 0.75, earnings: 0, hydrated: true }));
  assert.match(html, /Estimated portfolio value/);
  assert.match(html, /\$1\.25/);
  assert.match(html, /0\.75 USDC/);
  assert.doesNotMatch(html, /DEVNET UNITS|Guaranteed|Earned/);
});
