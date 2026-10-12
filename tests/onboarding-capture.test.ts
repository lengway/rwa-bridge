import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { MockCapture } from "../components/app/mock-capture";
import { FundingStories } from "../components/app/funding-stories";

test("mock capture is an explicitly simulated, skippable flow, not document collection", () => {
  const html = renderToStaticMarkup(createElement(MockCapture, { onFinish: () => undefined, onBack: () => undefined }));
  assert.match(html, /SAMPLE DOCUMENT/);
  assert.match(html, />Skip</);
  assert.match(html, /No camera or documents are used/);
  assert.match(html, /your identity is not verified/);
  assert.doesNotMatch(html, /type="file"|Identity verified|KYC approved/);
});

test("Home exposes two visual instruction stories without a wallet-details wall", () => {
  const html = renderToStaticMarkup(createElement(FundingStories));
  assert.match(html, /Quick guides/);
  assert.match(html, /Add funds/);
  assert.match(html, /Withdraw funds/);
  assert.doesNotMatch(html, /Wallet and funding details/);
});
