import "server-only";

import { NextResponse } from "next/server";

/**
 * These routes predate the Universal Earn Devnet environment and can invoke a card
 * provider, mint KZTE, or model a KZT payout. They must never be enabled by
 * an incidental provider key or a client-side feature flag.
 */
export const LEGACY_FIAT_ADAPTERS_ENV = "ENABLE_LEGACY_FIAT_ADAPTERS" as const;

export type LegacyFiatAdapter =
  | "crossmint-onramp"
  | "transak"
  | "moonpay"
  | "kzte"
  | "kzte-exchange";

export type LegacyFiatAdapterUnavailable = {
  available: false;
  status: "unavailable";
  code: "LEGACY_FIAT_ADAPTERS_DISABLED";
  adapter: LegacyFiatAdapter;
  mode: "DEVNET";
  error: string;
  requiredEnvironment: "ENABLE_LEGACY_FIAT_ADAPTERS=true";
};

/**
 * Fail closed. Only the exact lowercase literal deliberately enables a legacy
 * adapter; missing, empty, truthy-looking, and malformed values stay off.
 */
export function legacyFiatAdaptersEnabled(): boolean {
  return process.env[LEGACY_FIAT_ADAPTERS_ENV] === "true";
}

export function legacyFiatAdapterUnavailableResponse(adapter: LegacyFiatAdapter) {
  const payload: LegacyFiatAdapterUnavailable = {
    available: false,
    status: "unavailable",
    code: "LEGACY_FIAT_ADAPTERS_DISABLED",
    adapter,
    mode: "DEVNET",
    error: "The legacy fiat/KZT adapter is disabled: Universal Earn on Solana Devnet does not make external payments, payouts or conversions.",
    requiredEnvironment: "ENABLE_LEGACY_FIAT_ADAPTERS=true",
  };

  return NextResponse.json(payload, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}
