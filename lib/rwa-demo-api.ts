import "server-only";

import { NextResponse } from "next/server";
import {
  RwaDemoLedgerConflictError,
  RwaDemoLedgerRateLimitError,
  type RwaDemoFundingEvent,
  type RwaDemoOrderRecord,
  type RwaDemoPayoutEvent,
  type RwaDemoQuoteRecord,
} from "@/lib/devnet-ledger";
import { MeteoraConfirmationTimeoutError, MeteoraDevnetError } from "@/lib/meteora-devnet";
import { RwaDemoConfigError } from "@/lib/rwa-demo-config";
import {
  RWA_DEMO_FUNDING_DISCLOSURE,
  RWA_DEMO_NETWORK,
  RWA_DEMO_PAYOUT_DISCLOSURE,
  RWA_DEMO_ROUTE,
  RWA_DEMO_SWAP_DISCLOSURE,
  RwaDemoValidationError,
} from "@/lib/rwa-demo";
import { getSessionWallet } from "@/lib/session-wallet";

export class RwaDemoRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RwaDemoRequestError";
  }
}

export type DemoSession = { email: string; walletAddress: string };

export function requireObject(value: unknown, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RwaDemoRequestError(400, "INVALID_REQUEST", `${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export async function readDemoJson(request: Request) {
  return requireObject(await request.json().catch(() => null));
}

export async function readOptionalDemoJson(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {} as Record<string, unknown>;
  try {
    return requireObject(JSON.parse(text));
  } catch (error) {
    if (error instanceof RwaDemoRequestError) throw error;
    throw new RwaDemoRequestError(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  }
}

/**
 * A body wallet is only an assertion from the client. The authenticated wallet
 * is always returned and becomes the sole ledger/on-chain authority.
 */
export async function requireDemoSession(request: Request, clientWalletAddress?: unknown): Promise<DemoSession> {
  const session = await getSessionWallet(request);
  if (!session) {
    throw new RwaDemoRequestError(401, "SESSION_REQUIRED", "Sign in with the app wallet to use the Devnet demo.");
  }
  if (clientWalletAddress !== undefined) {
    if (typeof clientWalletAddress !== "string" || !clientWalletAddress.trim()) {
      throw new RwaDemoRequestError(400, "INVALID_WALLET", "walletAddress must be a non-empty string when supplied.");
    }
    if (clientWalletAddress !== session.walletAddress) {
      throw new RwaDemoRequestError(403, "WALLET_MISMATCH", "walletAddress does not match the current authenticated wallet.");
    }
  }
  return session;
}

export function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new RwaDemoRequestError(400, "INVALID_REQUEST", `${field} is required.`);
  }
  return value.trim();
}

export function demoErrorResponse(error: unknown) {
  if (error instanceof RwaDemoRequestError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof RwaDemoValidationError) {
    return NextResponse.json({ error: error.message, code: "INVALID_REQUEST" }, { status: 400 });
  }
  if (error instanceof RwaDemoLedgerRateLimitError) {
    return NextResponse.json({ error: error.message, code: "RATE_LIMITED" }, { status: 429 });
  }
  if (error instanceof RwaDemoLedgerConflictError) {
    return NextResponse.json({ error: error.message, code: "CONFLICT" }, { status: 409 });
  }
  if (error instanceof MeteoraConfirmationTimeoutError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 202 });
  }
  if (error instanceof MeteoraDevnetError) {
    const status = error.code === "INVALID_AMOUNT" || error.code === "INVALID_WALLET" || error.code === "INVALID_SIGNATURE"
      ? 400
      : error.code === "TRANSACTION_FAILED" || error.code === "TRANSACTION_MISMATCH"
        ? 409
        : 503;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof RwaDemoConfigError) {
    // Configuration details can reveal deployment topology. The client only
    // needs to know the demo is intentionally unavailable.
    return NextResponse.json({ error: "The Devnet demo is not available in this environment.", code: "DEMO_UNAVAILABLE" }, { status: 503 });
  }
  return NextResponse.json({ error: "Unable to process the Devnet demo request.", code: "DEMO_ERROR" }, { status: 500 });
}

function priceImpactBps(value: string | null) {
  if (value === null) return null;
  const asNumber = Number(value);
  // Do not turn an SDK value that cannot be represented safely into a number
  // for the UI. The precise quote amounts remain atomic strings below.
  return Number.isFinite(asNumber) && Math.abs(asNumber) <= 1_000_000 ? asNumber * 10_000 : null;
}

export function demoQuoteResponse(quote: RwaDemoQuoteRecord) {
  return {
    id: quote.id,
    assetId: quote.assetId,
    side: quote.side,
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    inputAmountAtomic: quote.inputAmountAtomic,
    expectedOutputAtomic: quote.expectedOutputAtomic,
    minimumOutputAtomic: quote.minimumOutputAtomic,
    feeAmountAtomic: quote.feeAmountAtomic,
    protocolFeeAtomic: quote.protocolFeeAtomic,
    slippageBps: quote.slippageBps,
    priceImpactBps: priceImpactBps(quote.priceImpact),
    poolAddress: quote.poolAddress,
    route: RWA_DEMO_ROUTE,
    network: RWA_DEMO_NETWORK,
    isDemo: true,
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
    disclosure: RWA_DEMO_SWAP_DISCLOSURE,
  };
}

export function demoOrderResponse(order: RwaDemoOrderRecord) {
  return {
    ...demoQuoteResponse(order),
    quoteId: order.quoteId,
    status: order.status,
    signature: order.transactionSignature ?? null,
    explorerUrl: order.transactionSignature
      ? `https://explorer.solana.com/tx/${order.transactionSignature}?cluster=devnet`
      : null,
    actualInputAmountAtomic: order.actualInputAmountAtomic ?? null,
    actualOutputAmountAtomic: order.actualOutputAmountAtomic ?? null,
    inputBalanceAfterAtomic: order.inputBalanceAfterAtomic ?? null,
    outputBalanceAfterAtomic: order.outputBalanceAfterAtomic ?? null,
    errorCode: order.errorCode ?? null,
    updatedAt: order.updatedAt,
  };
}

export function demoFundingResponse(event: RwaDemoFundingEvent) {
  return {
    id: event.id,
    status: event.status,
    requestedKztAmount: event.requestedKztAmount,
    demoRate: event.demoRateKztPerQuoteToken,
    quoteTokenAmountAtomic: event.quoteTokenAmountAtomic,
    mintSignature: event.mintSignature ?? null,
    mintExplorerUrl: event.mintSignature
      ? `https://explorer.solana.com/tx/${event.mintSignature}?cluster=devnet`
      : null,
    network: RWA_DEMO_NETWORK,
    isDemo: true,
    disclosure: RWA_DEMO_FUNDING_DISCLOSURE,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function demoPayoutResponse(event: RwaDemoPayoutEvent) {
  return {
    id: event.id,
    orderId: event.orderId,
    status: event.status,
    quoteTokenAmountAtomic: event.quoteTokenAmountAtomic,
    simulatedKztAmount: event.simulatedKztAmount,
    network: RWA_DEMO_NETWORK,
    isDemo: true,
    disclosure: event.disclosure || RWA_DEMO_PAYOUT_DISCLOSURE,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}
