import "server-only";

import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { devnetConfig } from "@/lib/solana-server";

export const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
    { error: "Сеть Solana devnet не настроена. Выполните node scripts/setup-devnet.mjs." },
    { status: 501 },
  );
}

export function safeError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return /[А-Яа-яЁё]/.test(message) ? message : fallback;
}

export function isConfigured() {
  return devnetConfig.configured;
}
