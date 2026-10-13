import "server-only";

import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { isUserFacingMessage } from "@/lib/action-errors";
import { devnetConfig } from "@/lib/solana-server";

export const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const LEGACY_DEVNET_CLUSTER = "devnet" as const;

/**
 * Legacy Devnet endpoints default to Devnet only when the cluster is absent.
 * Any explicitly supplied value must be exactly `devnet` so a deployment can
 * never silently enable legacy writes on mainnet or another cluster.
 */
export function isRequestedDevnetCluster(cluster: unknown): boolean {
  return cluster === undefined || cluster === LEGACY_DEVNET_CLUSTER;
}

export function isValidWalletAddress(value: unknown): value is string {
  if (typeof value !== "string" || !SOLANA_ADDRESS_PATTERN.test(value)) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidAmount(value: unknown, min = 1, max = 1000): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function unavailableResponse() {
  return NextResponse.json(
    { error: "Solana devnet is not configured. Run node scripts/setup-devnet.mjs." },
    { status: 501 },
  );
}

export function safeError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return isUserFacingMessage(message) ? message : fallback;
}

export function isConfigured() {
  return isRequestedDevnetCluster(process.env.SOLANA_CLUSTER) && devnetConfig.configured;
}
