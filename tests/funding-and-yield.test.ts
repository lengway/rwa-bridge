import assert from "node:assert/strict";
import test from "node:test";
import {
  fundingMethods,
  sandboxFundingAvailable,
  providerCheckoutStatus,
  isSandboxWidgetUrl,
} from "../lib/funding-contract";
import {
  dailyYieldEstimate,
  performanceFeeBps,
  quotePerformanceFee,
} from "../lib/earn-economics";
import { trackedProtocolGain } from "../lib/earn-performance";

test("sandbox gates reject Mainnet, production MoonPay keys and legacy blanket flags", () => {
  const environment = {
    SOLANA_CLUSTER: "devnet",
    ENABLE_TRANSAK_STAGING: "true",
    NEXT_PUBLIC_TRANSAK_API_KEY: "fixture",
    TRANSAK_API_SECRET: "fixture",
    ENABLE_MOONPAY_SANDBOX: "true",
    NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY: "pk_test_fixture",
    MOONPAY_SECRET_KEY: "fixture",
  };
  assert.equal(sandboxFundingAvailable("transak", environment), true);
  assert.equal(sandboxFundingAvailable("moonpay", environment), true);
  assert.equal(
    sandboxFundingAvailable("moonpay", {
      ...environment,
      NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY: "pk_live_fixture",
    }),
    false,
  );
  for (const cluster of [undefined, "mainnet-beta", "testnet"]) {
    for (const provider of ["transak", "moonpay"] as const)
      assert.equal(
        sandboxFundingAvailable(provider, {
          ...environment,
          SOLANA_CLUSTER: cluster,
        }),
        false,
      );
  }
  assert.equal(
    sandboxFundingAvailable("transak", {
      ...environment,
      ENABLE_TRANSAK_STAGING: undefined,
      ENABLE_LEGACY_FIAT_ADAPTERS: "true",
    }),
    false,
  );
  assert.equal(
    fundingMethods({}).find((method) => method.id === "circle")?.available,
    true,
  );
  assert.equal(
    fundingMethods(environment).find((method) => method.id === "bank")
      ?.available,
    false,
  );
});

test("provider completion does not mean wallet settlement, and destinations stay sandbox-only", () => {
  assert.equal(providerCheckoutStatus("completed"), "PROVIDER_COMPLETED");
  for (const status of ["processing", "pending", "success", "unknown"])
    assert.equal(providerCheckoutStatus(status), "PENDING");
  assert.equal(providerCheckoutStatus("REFUNDED"), "FAILED");
  assert.equal(
    isSandboxWidgetUrl(
      "transak",
      "https://global-stg.transak.com/?session=fixture",
    ),
    true,
  );
  for (const url of [
    "https://global.transak.com/",
    "https://global-stg.transak.com.evil.test/",
    "https://user@global-stg.transak.com/",
  ]) {
    assert.equal(isSandboxWidgetUrl("transak", url), false);
  }
  assert.equal(
    isSandboxWidgetUrl("moonpay", "https://buy.moonpay.com/"),
    false,
  );
});

test("performance fee charges only gains, handles losses and keeps atomic precision", () => {
  assert.equal(performanceFeeBps(), 3500);
  assert.throws(() => performanceFeeBps("4001"));
  assert.throws(() => performanceFeeBps("35.0"));
  assert.deepEqual(
    quotePerformanceFee(BigInt(1100000000), BigInt(1000000000), 3500),
    {
      gainAtomic: "100000000",
      feeAtomic: "35000000",
      netGainAtomic: "65000000",
    },
  );
  assert.equal(
    quotePerformanceFee(BigInt(900), BigInt(1000), 3500).feeAtomic,
    "0",
  );
  const principal = BigInt("18446744073709551000");
  assert.equal(
    quotePerformanceFee(principal + BigInt(100), principal, 4000).feeAtomic,
    "40",
  );
});

test("daily forecast uses compounding and missing rates never invent profit", () => {
  assert.equal(dailyYieldEstimate(1000, null, 3500), null);
  assert.equal(dailyYieldEstimate(1000, NaN, 3500), null);
  const forecast = dailyYieldEstimate(1000, 0.08, 3500)!;
  assert.ok(Math.abs(forecast.net - forecast.gross * 0.65) < 1e-12);
  assert.ok(Math.abs(Math.pow(1 + forecast.gross / 1000, 365) - 1.08) < 1e-10);
});

test("protocol gain reconciles withdrawals, deduplicates signatures and rejects unknown basis", () => {
  const deposit = {
    signature: "deposit-1",
    action: "deposit" as const,
    actualLiquidityAmountAtomic: "1000000",
    actualCollateralAmountAtomic: "1000000",
  };
  const withdraw = {
    signature: "withdraw-1",
    action: "withdraw" as const,
    actualLiquidityAmountAtomic: "520000",
    actualCollateralAmountAtomic: "500000",
  };
  assert.equal(
    trackedProtocolGain("500000", "530000", [deposit, withdraw]),
    "50000",
  );
  assert.equal(
    trackedProtocolGain("500000", "530000", [deposit, deposit, withdraw]),
    "50000",
  );
  assert.equal(
    trackedProtocolGain("600000", "630000", [deposit, withdraw]),
    null,
  );
  assert.equal(trackedProtocolGain("0", "0", []), "0");
  assert.equal(trackedProtocolGain("1000000", "900000", [deposit]), "-100000");
});
