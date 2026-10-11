import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreparedKaminoLendAction, formatAtomicAmount } from "../components/app/kamino-lend-contract";

const response = {
  action: "deposit", actionId: "lend-deposit-fee-01", network: "devnet",
  serializedTransaction: "4Q3B6ov5y6x5eN3E8bRmn3", blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 123, expiresAt: 1000,
  transactionMessageDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  market: "11111111111111111111111111111111", reserve: "22222222222222222222222222222222",
  amountAtomic: "100000", simulation: { ok: true, err: null, unitsConsumed: 45678 }, networkFeeLamports: "5000",
};

test("prepared network fee stays exact and is displayed as SOL, not USDC", () => {
  const prepared = normalizePreparedKaminoLendAction(response, "deposit");
  assert.equal(prepared?.networkFeeLamports, "5000");
  assert.equal(formatAtomicAmount(prepared!.networkFeeLamports!, 9), "0.000005");
});

test("bad fee metadata invalidates the signing payload rather than becoming zero", () => {
  for (const fee of ["-1", "1.5", "5e3", "NaN", "5000\n", " 5000", 5000]) {
    assert.equal(normalizePreparedKaminoLendAction({ ...response, networkFeeLamports: fee }, "deposit"), null);
  }
  assert.equal(normalizePreparedKaminoLendAction({ ...response, networkFeeLamports: undefined }, "deposit")?.networkFeeLamports, null);
});
