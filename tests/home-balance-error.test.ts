import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { BalanceCard } from "../components/app/home-account";

test("failed initial portfolio read shows unavailable, not perpetual skeletons or zero", () => {
  const html = renderToStaticMarkup(createElement(BalanceCard, { total: 0, cashUsd: 0, earnings: 0, hydrated: false, unavailable: true }));
  assert.match(html, /Balance unavailable/);
  assert.doesNotMatch(html, /data-slot="skeleton"|\$0|0 USDC/);
});
