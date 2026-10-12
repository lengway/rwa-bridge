import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { QuickActions } from "../components/app/home-actions";
import { EarnList } from "../components/app/earn-list-screen";

test("Home retains its three original quick-action links", () => {
  const html = renderToStaticMarkup(createElement(QuickActions));
  assert.match(html, /Add to Earn/);
  assert.match(html, /Withdraw/);
  assert.match(html, /Activity/);
  assert.match(html, /grid-cols-3/);
});

test("Earn retains strategy selection rather than replacing it with the balances screen", () => {
  const html = renderToStaticMarkup(createElement(EarnList));
  assert.match(html, /Kamino Lend/);
  assert.match(html, /href="\/earn\/kamino-lend"/);
  assert.doesNotMatch(html, /Available to invest/);
});

test("all original navigation destinations remain present", async () => {
  const source = await readFile("components/app/shell.tsx", "utf8");
  for (const route of ["/home", "/earn", "/assets", "/activity", "/portfolio"]) {
    assert.ok(source.includes(`href: "${route}"`));
  }
  assert.match(source, /grid-cols-3/);
  const primary = source.slice(source.indexOf("const tabs ="), source.indexOf("const secondaryLinks"));
  assert.equal((primary.match(/href:/g) ?? []).length, 3);
  assert.doesNotMatch(primary, /\/assets|\/portfolio/);
});
