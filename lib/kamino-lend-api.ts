import "server-only";

import { NextResponse } from "next/server";
import { isValidWalletAddress } from "@/lib/devnet-route";
import { KaminoLendDevnetError } from "@/lib/kamino-lend-devnet";
import { getSessionWallet } from "@/lib/session-wallet";

export class KaminoLendRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KaminoLendRequestError";
  }
}

export async function readKaminoLendJson(request: Request) {
  const parsed = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new KaminoLendRequestError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * A client-supplied wallet is an assertion only. Routes always execute with
 * the wallet from the authenticated session, which prevents position reads or
 * prepared actions for another account.
 */
export async function requireKaminoLendSession(request: Request, assertedWallet?: unknown) {
  const session = await getSessionWallet(request);
  if (!session) {
    throw new KaminoLendRequestError(401, "SESSION_REQUIRED", "Sign in with the app wallet to use Kamino Lend.");
  }
  if (assertedWallet !== undefined) {
    if (!isValidWalletAddress(assertedWallet)) {
      throw new KaminoLendRequestError(400, "INVALID_WALLET", "walletAddress must be a valid Solana address when supplied.");
    }
    if (assertedWallet !== session.walletAddress) {
      throw new KaminoLendRequestError(403, "WALLET_MISMATCH", "walletAddress does not match the current authenticated wallet.");
    }
  }
  return session;
}

export function requireKaminoLendCluster(value: unknown) {
  if (value !== undefined && value !== "devnet") {
    throw new KaminoLendRequestError(400, "INVALID_CLUSTER", "Kamino Lend actions are available only on Solana Devnet.");
  }
}

export function kaminoLendErrorResponse(cause: unknown) {
  if (cause instanceof KaminoLendRequestError) {
    return NextResponse.json({ error: cause.message, code: cause.code }, { status: cause.status });
  }
  if (cause instanceof KaminoLendDevnetError) {
    const clientFaults = new Set([
      "INVALID_AMOUNT",
      "AMOUNT_LIMIT",
      "INVALID_WALLET",
      "INVALID_SIGNATURE",
      "INVALID_ACTION",
      "INVALID_CLUSTER",
    ]);
    const conflicts = new Set([
      "ACTION_NOT_FOUND",
      "ACTION_EXPIRED",
      "INSUFFICIENT_LIQUIDITY_BALANCE",
      "INSUFFICIENT_COLLATERAL_BALANCE",
      "INSUFFICIENT_RESERVE_LIQUIDITY",
      "SIMULATION_FAILED",
      "TRANSACTION_FAILED",
      "TRANSACTION_MISMATCH",
      "WALLET_MISMATCH",
    ]);
    if (clientFaults.has(cause.code)) {
      return NextResponse.json({ error: cause.message, code: cause.code }, { status: 400 });
    }
    if (conflicts.has(cause.code)) {
      return NextResponse.json({ error: cause.message, code: cause.code }, { status: 409 });
    }
    // Avoid disclosing RPC topology, account layouts, or config details to the client; keep them in server logs.
    console.error("[kamino] unavailable:", cause.code, cause.message);
    return NextResponse.json({ error: "Kamino Lend is temporarily unavailable.", code: "KAMINO_UNAVAILABLE" }, { status: 503 });
  }
  console.error("[kamino] request error:", cause instanceof Error ? `${cause.name}: ${cause.message}` : cause);
  return NextResponse.json({ error: "Unable to process the Kamino Lend request.", code: "KAMINO_REQUEST_ERROR" }, { status: 500 });
}

export const kaminoNoStoreHeaders = { "Cache-Control": "no-store" } as const;
