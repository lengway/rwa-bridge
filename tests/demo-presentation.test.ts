import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { DemoBadge } from "../components/app/demo-badge";
import { DemoBankScreen } from "../components/app/demo-bank-screen";
import { BalanceCard } from "../components/app/home-account";

test("one compact demo control carries the truthful environment and mock identity details", () => {
  const html = renderToStaticMarkup(createElement(DemoBadge, { bank: true }));
  assert.match(html, /Demo · Devnet/);
  assert.match(html, /no monetary value/);
  assert.match(html, /not verified KYC/);
  assert.match(html, /Forma Bank is fictional/);
  assert.match(html, /sample data, separate from your Plain wallet/);
  assert.match(html, /<details/);
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
