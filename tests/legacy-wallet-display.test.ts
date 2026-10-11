import assert from "node:assert/strict";
import test from "node:test";
import { legacyWalletBalance } from "../lib/legacy-wallet-display";

test("Kamino USDC can never fund a legacy TEST QUOTE transfer", () => {
  const holdings = [{ mint: "kamino-usdc", balance: 20 }, { mint: "legacy-quote", balance: 3 }];
  assert.equal(legacyWalletBalance(holdings, "legacy-quote"), 3);
  assert.equal(legacyWalletBalance([holdings[0]], "legacy-quote"), 0);
  assert.equal(legacyWalletBalance(holdings, null), 0);
});

test("missing or malformed legacy balances remain unknown, not zero", () => {
  assert.equal(legacyWalletBalance(null, "legacy-quote"), null);
  assert.equal(legacyWalletBalance([{ mint: "legacy-quote", balance: NaN }], "legacy-quote"), null);
  assert.equal(legacyWalletBalance([{ mint: "legacy-quote", balance: -1 }], "legacy-quote"), null);
});
