import assert from "node:assert/strict";
import test from "node:test";
import {
  RWA_DEMO_FUNDING_DISCLOSURE,
  RWA_DEMO_PAYOUT_DISCLOSURE,
  RWA_DEMO_SWAP_DISCLOSURE,
  RWA_DEMO_NETWORK,
  SOLANA_DEVNET_GENESIS_HASH,
  assertOrderTransition,
  isCanonicalDevnetTarget,
  isCompletedSell,
  isQuoteExpired,
  kztFromQuoteAtomic,
  parseKztAmount,
  quoteAtomicFromKzt,
  requirePositiveAtomicAmount,
  tokenScale,
} from "../lib/rwa-demo";

test("demo KZT conversion uses exact atomic integer math and rounds down", () => {
  const quoteAmount = quoteAtomicFromKzt({
    requestedKzt: BigInt("1001"),
    kztPerQuoteToken: BigInt("500"),
    quoteDecimals: 6,
  });

  assert.equal(quoteAmount, BigInt("2002000"));
  assert.equal(kztFromQuoteAtomic({
    quoteAmountAtomic: quoteAmount,
    kztPerQuoteToken: BigInt("500"),
    quoteDecimals: 6,
  }), BigInt("1001"));
  assert.equal(quoteAtomicFromKzt({
    requestedKzt: BigInt("499"),
    kztPerQuoteToken: BigInt("500"),
    quoteDecimals: 6,
  }), BigInt("998000"));
});

test("large demo amounts never pass through JavaScript floating point", () => {
  const requestedKzt = BigInt("900719925474099312345");
  const result = quoteAtomicFromKzt({
    requestedKzt,
    kztPerQuoteToken: BigInt("3"),
    quoteDecimals: 6,
  });

  assert.equal(result, requestedKzt * tokenScale(6) / BigInt("3"));
});

test("funding input and atomic caps fail closed", () => {
  assert.equal(parseKztAmount("1000000", BigInt("1000000")), BigInt("1000000"));
  assert.throws(() => parseKztAmount("1000001", BigInt("1000000")));
  assert.throws(() => parseKztAmount(1.5, BigInt("1000")));
  assert.throws(() => requirePositiveAtomicAmount("0", "input"));
  assert.throws(() => requirePositiveAtomicAmount("001", "input"));
  assert.throws(() => requirePositiveAtomicAmount("101", "input", BigInt("100")));
});

test("an order cannot complete before on-chain confirmation", () => {
  assert.throws(() => assertOrderTransition("ORDER_CREATED", "COMPLETED"));
  assert.throws(() => assertOrderTransition("WALLET_APPROVAL_PENDING", "COMPLETED"));
  assert.doesNotThrow(() => assertOrderTransition("ORDER_CREATED", "WALLET_APPROVAL_PENDING"));
  assert.doesNotThrow(() => assertOrderTransition("WALLET_APPROVAL_PENDING", "TRANSACTION_SUBMITTED"));
  assert.doesNotThrow(() => assertOrderTransition("TRANSACTION_SUBMITTED", "ONCHAIN_CONFIRMED"));
  assert.doesNotThrow(() => assertOrderTransition("ONCHAIN_CONFIRMED", "COMPLETED"));
  assert.doesNotThrow(() => assertOrderTransition("CONFIRMATION_TIMEOUT", "WALLET_APPROVAL_PENDING"));
  assert.equal(isCompletedSell({ side: "SELL", status: "COMPLETED" }), true);
  assert.equal(isCompletedSell({ side: "BUY", status: "COMPLETED" }), false);
});

test("quote expiry and safety disclosures remain explicit", () => {
  assert.equal(isQuoteExpired(Date.now() - 1), true);
  assert.equal(isQuoteExpired(Date.now() + 60_000), false);
  assert.equal(RWA_DEMO_NETWORK, "devnet");
  assert.match(RWA_DEMO_FUNDING_DISCLOSURE, /SIMULATED.*no fiat payment/i);
  assert.match(RWA_DEMO_FUNDING_DISCLOSURE, /DEVNET TEST TOKEN.*no monetary value/i);
  assert.match(RWA_DEMO_SWAP_DISCLOSURE, /DEVNET SWAP.*no real asset rights/i);
  assert.match(RWA_DEMO_PAYOUT_DISCLOSURE, /SIMULATED.*no KZT payout/i);
});

test("the Devnet guard fails closed for a missing, Mainnet, or unknown target", () => {
  assert.equal(isCanonicalDevnetTarget("devnet", SOLANA_DEVNET_GENESIS_HASH), true);
  assert.equal(isCanonicalDevnetTarget("mainnet-beta", SOLANA_DEVNET_GENESIS_HASH), false);
  assert.equal(isCanonicalDevnetTarget("devnet", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), false);
  assert.equal(isCanonicalDevnetTarget(null, SOLANA_DEVNET_GENESIS_HASH), false);
  assert.equal(isCanonicalDevnetTarget("devnet", null), false);
});
