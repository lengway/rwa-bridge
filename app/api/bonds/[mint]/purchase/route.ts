import "server-only";

import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/markets/api-guard";
import { KaminoLendDevnetError } from "@/lib/kamino-lend-devnet-config";
import { kaminoLendErrorResponse, readKaminoLendJson, requireKaminoLendCluster, requireKaminoLendSession } from "@/lib/kamino-lend-api";
import { KaminoExecutionClaimError } from "@/lib/kamino-execution-claims";
import { prepareSmartWalletAction } from "@/lib/kamino-smart-wallet-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const limiter = createRateLimiter({ windowMs: 60_000, perClient: 10, global: 300 });
const headers = { "Cache-Control": "no-store" } as const;
/** Purchase refusals the buyer can act on; everything else stays generic. */
const BUYER_FACING = new Set(["SIMULATION_FAILED", "SMART_WALLET_EXECUTION_REJECTED", "OFFERING_CLOSED", "OFFERING_SOLD_OUT", "HOLDER_CAP", "INSUFFICIENT_LIQUIDITY_BALANCE", "NOT_ALLOWLISTED", "SETTLEMENT_UNSUPPORTED", "AMOUNT_LIMIT", "INVALID_AMOUNT", "INVALID_ACTION", "DEVNET_DISABLED"]);

/**
 * Prepare a bond purchase (`markets-subscribe`) for the signed-in smart wallet. The server builds the
 * exact DvP payload, has Crossmint wrap it, inspects the envelope and returns the provider operation
 * for one-tap approval. Status and wallet setup use the shared /api/kamino/smart-wallet/* routes.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/bonds/[mint]/purchase">) {
  const { mint } = await ctx.params;
  try {
    if (!ADDRESS.test(mint)) return NextResponse.json({ error: "Unknown bond.", code: "INVALID_ACTION" }, { status: 404, headers });
    const body = await readKaminoLendJson(request);
    requireKaminoLendCluster(body.cluster);
    const session = await requireKaminoLendSession(request, body.walletAddress);
    const limit = limiter(session.walletAddress);
    if (!limit.ok) return NextResponse.json({ error: "Too many purchase requests. Try again shortly.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfter) } });
    const result = await prepareSmartWalletAction({
      email: session.email, walletAddress: session.walletAddress, action: "markets-subscribe",
      mint, amountAtomic: body.amountAtomic, requestId: body.requestId,
    });
    return NextResponse.json(result, { headers });
  } catch (cause) {
    if (cause instanceof KaminoLendDevnetError && BUYER_FACING.has(cause.code)) {
      return NextResponse.json({ error: cause.message, code: cause.code }, { status: cause.code === "DEVNET_DISABLED" ? 503 : 409, headers });
    }
    if (cause instanceof KaminoExecutionClaimError && cause.code === "WALLET_IN_FLIGHT") {
      return NextResponse.json({ error: "Another wallet operation is still being confirmed. Try again once it finishes.", code: cause.code }, { status: 409, headers });
    }
    if (cause instanceof KaminoLendDevnetError) {
      console.error("[bonds] purchase unavailable:", cause.code, cause.message);
      return NextResponse.json({ error: "Bond purchases are temporarily unavailable.", code: "PURCHASE_UNAVAILABLE" }, { status: 503, headers });
    }
    const response = kaminoLendErrorResponse(cause);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
