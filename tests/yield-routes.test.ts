import assert from "node:assert/strict";
import test from "node:test";
import {
  YIELD_ROUTES,
  parseDefiLlamaChartApy,
  parseJupiterLendUsdcApy,
  quoteYieldRoutes,
  sanitizeApyPercent,
} from "../lib/yield-routes";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("sanitizeApyPercent rejects non-finite, negative and absurd values", () => {
  assert.equal(sanitizeApyPercent(5.123), 5.12);
  assert.equal(sanitizeApyPercent("4.5"), 4.5);
  assert.equal(sanitizeApyPercent(Number.NaN), null);
  assert.equal(sanitizeApyPercent(-1), null);
  assert.equal(sanitizeApyPercent(250), null);
  assert.equal(sanitizeApyPercent(""), null);
  assert.equal(sanitizeApyPercent(undefined), null);
});

test("parseJupiterLendUsdcApy reads totalRate bps for mainnet USDC only", () => {
  assert.equal(
    parseJupiterLendUsdcApy([
      { assetAddress: "So11111111111111111111111111111111111111112", totalRate: "900" },
      { assetAddress: USDC, totalRate: "576", supplyRate: "540" },
    ]),
    5.76,
  );
  assert.equal(parseJupiterLendUsdcApy([{ assetAddress: "x", totalRate: "576" }]), null);
  assert.equal(parseJupiterLendUsdcApy([{ assetAddress: USDC, totalRate: "abc" }]), null);
  assert.equal(parseJupiterLendUsdcApy({}), null);
});

test("parseDefiLlamaChartApy uses the latest data point", () => {
  assert.equal(
    parseDefiLlamaChartApy({ status: "success", data: [{ apy: 2 }, { apy: 3.13 }] }),
    3.13,
  );
  assert.equal(parseDefiLlamaChartApy({ status: "error", data: [{ apy: 3 }] }), null);
  assert.equal(parseDefiLlamaChartApy({ status: "success", data: [] }), null);
  assert.equal(parseDefiLlamaChartApy(null), null);
});

test("quoteYieldRoutes hides APY when a source fails and never marks routes executable", async () => {
  const failing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const quotes = await quoteYieldRoutes(failing, YIELD_ROUTES, () => new Date(0));
  assert.equal(quotes.length, YIELD_ROUTES.length);
  for (const quote of quotes) {
    assert.equal(quote.apyPercent, null);
    assert.equal(quote.status, "COMING_SOON");
    assert.equal(quote.network, "Solana Mainnet");
  }
});

test("quoteYieldRoutes returns live values from each source", async () => {
  const fake = (async (url: string) => {
    const body = url.includes("jup.ag")
      ? [{ assetAddress: USDC, totalRate: "576" }]
      : { status: "success", data: [{ apy: 3.13 }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const quotes = await quoteYieldRoutes(fake);
  assert.deepEqual(
    quotes.map((quote) => [quote.id, quote.apyPercent]),
    [
      ["jupiter-lend-usdc", 5.76],
      ["save-main-pool-usdc", 3.13],
    ],
  );
});

test("quoteYieldRoutes treats non-OK HTTP responses as unavailable", async () => {
  const notOk = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  const quotes = await quoteYieldRoutes(notOk);
  assert.ok(quotes.every((quote) => quote.apyPercent === null));
});
