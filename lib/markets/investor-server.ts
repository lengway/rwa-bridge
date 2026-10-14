import "server-only";

import { DEFAULT_ALLOCATION_LIMITS, type AllocationLimits, type BondDetail, type InvestorOverview } from "./investor";
import { readBond, readOverview } from "./investor-reads";
import type { DevnetLedger } from "./devnet-service";
import { marketsReader } from "./server";
import type { Address } from "./service";

/**
 * Server entry points for the investor side of Plain Markets. The browser never talks to the RPC
 * for these: one request returns the signed-in wallet's whole bond view (`investor-reads.ts`).
 *
 *   MARKETS_ALLOCATION_CAP_UNITS        most units one investor may hold via allocation (default 20)
 *   MARKETS_ALLOCATION_MAX_PER_REQUEST  most units per request (default 10)
 */

export const UNAVAILABLE_REASON = "Bond offerings are not available right now.";

function envInt(name: string, fallback: number, max: number) {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : fallback;
}

export function allocationLimits(): AllocationLimits {
  const capUnits = envInt("MARKETS_ALLOCATION_CAP_UNITS", DEFAULT_ALLOCATION_LIMITS.capUnits, 1_000_000);
  return { capUnits, maxPerRequest: Math.min(capUnits, envInt("MARKETS_ALLOCATION_MAX_PER_REQUEST", DEFAULT_ALLOCATION_LIMITS.maxPerRequest, 1_000_000)) };
}

// The server ledger does not poll. Refresh the instrument feeds at most every 15 s so payments
// made elsewhere (another server instance, a holder's own claim) show up.
const POLL_MS = 15_000;
let lastPoll = 0;
async function refresh(reader: DevnetLedger) {
  if (Date.now() - lastPoll < POLL_MS) return;
  lastPoll = Date.now();
  await reader.poll();
}

export async function investorOverview(wallet: Address): Promise<InvestorOverview> {
  const reader = marketsReader();
  if (!reader) return { available: false, reason: UNAVAILABLE_REASON };
  await refresh(reader);
  return readOverview(reader, wallet, allocationLimits());
}

/** Null when the mint is not one of the listed instruments (or Markets is off). */
export async function investorBond(wallet: Address, mint: Address): Promise<BondDetail | null> {
  const reader = marketsReader();
  if (!reader) return null;
  await refresh(reader);
  return readBond(reader, wallet, mint, allocationLimits());
}

/** True when `mint` is one of the listed instruments (allocation is only offered for those). */
export async function isListedInstrument(mint: Address) {
  const reader = marketsReader();
  if (!reader) return false;
  return (await reader.listInstruments()).some((i) => i.mint === mint);
}
