import assert from "node:assert/strict";
import test from "node:test";
import {
  EARN_REQUIRED_DISCLOSURE_LABELS,
  EARN_STRATEGIES,
  EarnGatewayError,
  assertDevnetEarnCluster,
  assertEarnCatalogInvariants,
  assertEarnOperationTransition,
  assertEarnQuoteTransition,
  assertEarnQuoteUsable,
  assertRequiredEarnDisclosures,
  assertStrategyOperationSupported,
  formatAtomicToDecimal,
  getEarnStrategy,
  getEarnStrategyOperationGate,
  hasRequiredEarnDisclosures,
  isEarnQuoteExpired,
  isRequestedEarnDevnetCluster,
  parseAtomicAmount,
  parseDecimalToAtomic,
  requirePositiveDecimalToAtomic,
  SIMULATED_DEMO_FUNDING_PROVIDER,
  SIMULATED_DEMO_YIELD_PROVIDER,
  toPublicEarnStrategy,
} from "../lib/earn-gateway";

test("decimal conversion is exact at ordinary and large integer boundaries", () => {
  assert.equal(parseDecimalToAtomic("12.34", 6), BigInt("12340000"));
  assert.equal(parseDecimalToAtomic("0.000001", 6), BigInt(1));
  assert.equal(parseDecimalToAtomic("9007199254740993.123456789", 9), BigInt("9007199254740993123456789"));
  assert.equal(formatAtomicToDecimal(BigInt("12340000"), 6), "12.34");
  assert.equal(formatAtomicToDecimal(BigInt(1), 6), "0.000001");
  assert.equal(formatAtomicToDecimal(BigInt("9007199254740993123456789"), 9), "9007199254740993.123456789");
  assert.equal(formatAtomicToDecimal(BigInt("12000000"), 6, { trimTrailingZeros: false }), "12.000000");
  assert.equal(parseAtomicAmount("18446744073709551615"), BigInt("18446744073709551615"));
});

test("amount conversion fails closed for floats, ambiguous decimals, and invalid precision", () => {
  for (const value of [1, " 1", "+1", "-1", ".1", "1.", "01", "1e3", "1.0000001"]) {
    assert.throws(() => parseDecimalToAtomic(value, 6), EarnGatewayError);
  }
  assert.throws(() => parseDecimalToAtomic("1.0", 0), EarnGatewayError);
  assert.throws(() => parseDecimalToAtomic("1", 19), EarnGatewayError);
  assert.throws(() => formatAtomicToDecimal(BigInt(-1), 6), EarnGatewayError);
  assert.throws(() => parseAtomicAmount("01"), EarnGatewayError);
  assert.throws(() => requirePositiveDecimalToAtomic("0", 6), EarnGatewayError);
});

test("the catalog has exactly one enabled simulated strategy and disabled provider placeholders", () => {
  assert.doesNotThrow(() => assertEarnCatalogInvariants());

  const enabled = EARN_STRATEGIES.filter((strategy) => strategy.availability === "ENABLED");
  assert.equal(enabled.length, 1);
  assert.equal(enabled[0]?.mode, "SIMULATED_DEMO");
  assert.equal(enabled[0]?.network, "devnet");

  for (const id of ["kamino-devnet-placeholder", "native-sol-stake-placeholder"] as const) {
    const strategy = getEarnStrategy(id);
    assert.equal(strategy.availability, "DISABLED");
    const gate = getEarnStrategyOperationGate(strategy, "deposit");
    assert.equal(gate.supported, false);
    if (!gate.supported) assert.match(gate.reason, /verified|epoch|configured/i);
    assert.throws(() => assertStrategyOperationSupported(strategy, "deposit"), (error: unknown) => {
      return error instanceof EarnGatewayError && error.code === "OPERATION_NOT_SUPPORTED";
    });
  }

  assert.equal(getEarnStrategyOperationGate("devnet-simulated-demo", "deposit").supported, true);
  assert.equal(SIMULATED_DEMO_YIELD_PROVIDER.getStrategy("devnet-simulated-demo")?.name, "Devnet Earn Strategy");
  assert.equal(SIMULATED_DEMO_YIELD_PROVIDER.getStrategy("kamino-devnet-placeholder"), null);
  assert.equal(SIMULATED_DEMO_FUNDING_PROVIDER.acceptsFiat, false);
  assert.equal(SIMULATED_DEMO_FUNDING_PROVIDER.getOperationGate("devnet-simulated-demo").supported, true);
  const legacy = getEarnStrategy("legacy-devnet-redemption");
  assert.equal(legacy.availability, "REDEMPTION_ONLY");
  assert.equal(getEarnStrategyOperationGate(legacy, "withdraw").supported, true);
  assert.equal(getEarnStrategyOperationGate(legacy, "deposit").supported, false);
  assert.equal(SIMULATED_DEMO_FUNDING_PROVIDER.getOperationGate(legacy).supported, false);
  assert.throws(() => getEarnStrategyOperationGate("devnet-simulated-demo", "invent"), EarnGatewayError);
});

test("stale quotes and unsafe state transitions cannot be used or revived", () => {
  const now = 1_700_000_000_000;
  assert.equal(isEarnQuoteExpired(now - 1, now), true);
  assert.equal(isEarnQuoteExpired(now, now), true);
  assert.equal(isEarnQuoteExpired(now + 1, now), false);
  assert.equal(isEarnQuoteExpired(Number.NaN, now), true);
  assert.throws(() => assertEarnQuoteUsable({ state: "READY", expiresAt: now - 1 }, now), (error: unknown) => {
    return error instanceof EarnGatewayError && error.code === "QUOTE_EXPIRED";
  });
  assert.throws(() => assertEarnQuoteUsable({ state: "ACCEPTED", expiresAt: now + 1 }, now), (error: unknown) => {
    return error instanceof EarnGatewayError && error.code === "QUOTE_NOT_READY";
  });

  assert.doesNotThrow(() => assertEarnQuoteTransition("READY", "ACCEPTED"));
  assert.throws(() => assertEarnQuoteTransition("EXPIRED", "ACCEPTED"), EarnGatewayError);
  assert.doesNotThrow(() => assertEarnOperationTransition("QUOTE_READY", "WALLET_APPROVAL_PENDING"));
  assert.doesNotThrow(() => assertEarnOperationTransition("WALLET_APPROVAL_PENDING", "TRANSACTION_SUBMITTED"));
  assert.doesNotThrow(() => assertEarnOperationTransition("TRANSACTION_SUBMITTED", "ONCHAIN_CONFIRMED"));
  assert.doesNotThrow(() => assertEarnOperationTransition("ONCHAIN_CONFIRMED", "COMPLETED"));
  assert.throws(() => assertEarnOperationTransition("TRANSACTION_SUBMITTED", "COMPLETED"), EarnGatewayError);
  assert.throws(() => assertEarnOperationTransition("QUOTE_EXPIRED", "WALLET_APPROVAL_PENDING"), EarnGatewayError);
});

test("required disclosures are present, explicit, and cannot be silently removed", () => {
  const demo = getEarnStrategy("devnet-simulated-demo");
  assert.equal(hasRequiredEarnDisclosures(demo.disclosures), true);
  assert.doesNotThrow(() => assertRequiredEarnDisclosures(demo.disclosures));
  for (const label of EARN_REQUIRED_DISCLOSURE_LABELS) {
    assert.ok(demo.disclosures.some((disclosure) => disclosure.label === label));
  }
  assert.match(demo.disclosures.map((disclosure) => disclosure.label).join(" | "), /SOLANA DEVNET/);
  assert.match(demo.disclosures.map((disclosure) => disclosure.label).join(" | "), /SIMULATED FUNDING/);
  assert.match(demo.disclosures.map((disclosure) => disclosure.label).join(" | "), /ILLUSTRATIVE YIELD/);
  assert.match(demo.disclosures.map((disclosure) => disclosure.label).join(" | "), /NO MONETARY VALUE/);
  assert.equal(hasRequiredEarnDisclosures(demo.disclosures.slice(1)), false);
  assert.throws(() => assertRequiredEarnDisclosures(demo.disclosures.slice(1)), EarnGatewayError);
});

test("public catalog metadata presents the Devnet product without internal demo identifiers", () => {
  const publicCatalog = EARN_STRATEGIES.map(toPublicEarnStrategy);
  const enabled = publicCatalog.find((strategy) => strategy.availability === "ENABLED");
  assert.equal(enabled?.id, "devnet-simulated-earn");
  assert.equal(enabled?.mode, "DEVNET");
  assert.equal(enabled?.provider, "PLAIN_DEVNET");
  assert.doesNotMatch(JSON.stringify(publicCatalog), /demo/i);
});

test("the requested cluster guard permits only an explicit devnet request", () => {
  assert.equal(isRequestedEarnDevnetCluster("devnet"), true);
  assert.equal(isRequestedEarnDevnetCluster("mainnet-beta"), false);
  assert.equal(isRequestedEarnDevnetCluster(undefined), false);
  assert.equal(assertDevnetEarnCluster("devnet"), "devnet");
  for (const requestedCluster of ["mainnet-beta", "testnet", "DEVNET", null]) {
    assert.throws(() => assertDevnetEarnCluster(requestedCluster), (error: unknown) => {
      return error instanceof EarnGatewayError && error.code === "UNSAFE_CLUSTER";
    });
  }
});
