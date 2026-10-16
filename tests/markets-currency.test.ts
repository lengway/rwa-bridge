import assert from "node:assert/strict";
import test from "node:test";
import { CIRCLE_DEVNET_USDC_MINT, TEST_KZT_MINT_ADDRESS, settlementCurrency, settlementSymbolForMint } from "../lib/markets/currency";
import { formatSettlement, settlementDecimal } from "../lib/markets/format";
import { holderEntitlement } from "../lib/markets/math";

const kzt = (n: number) => BigInt(n) * BigInt(100);

test("tenge amounts: ₸ sign, 2 decimals", () => {
  assert.equal(formatSettlement(kzt(35_000), 2, "KZT"), "₸35,000.00");
  assert.equal(formatSettlement(BigInt(12_345_678), 2, "KZT"), "₸123,456.78");
  assert.equal(formatSettlement(-kzt(500), 2, "KZT"), "−₸500.00");
  assert.equal(settlementDecimal(kzt(35_000), 2), "35000.00");
});

test("USD and USDC keep the dollar sign; unknown symbols trail", () => {
  assert.equal(formatSettlement(BigInt(50_000_000_000), 6, "USD"), "$50,000.00");
  assert.equal(formatSettlement(BigInt(1_500_000), 6, "USDC"), "$1.50");
  assert.equal(formatSettlement(BigInt(250), 2, "EUR"), "2.50 EUR");
});

test("settlement symbol is derived from the instrument's settlement mint", () => {
  assert.equal(settlementSymbolForMint(TEST_KZT_MINT_ADDRESS), "KZT");
  assert.equal(settlementSymbolForMint(CIRCLE_DEVNET_USDC_MINT), "USDC");
  assert.equal(settlementSymbolForMint("7GtKkJyuhtwam5H6SxDB7razMC51jUA9kz5keSURxBKh"), "USD");
  assert.match(settlementCurrency("KZT").label, /Test KZT/);
});

test("KZT example: 14% semi-annual on ₸500,000 face pays ₸35,000 per unit", () => {
  const terms = { faceValue: kzt(500_000), couponBps: 1_400, frequency: 2 };
  const e = holderEntitlement(terms, { kind: "Coupon", period: 1, couponBps: 1_400 }, BigInt(4));
  assert.equal(formatSettlement(e.amount, 2, "KZT"), "₸140,000.00");
});
