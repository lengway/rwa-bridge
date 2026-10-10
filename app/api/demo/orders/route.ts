import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRwaDemoOrderFromQuote, getRwaDemoQuoteForWallet } from "@/lib/devnet-ledger";
import {
  RwaDemoRequestError,
  demoErrorResponse,
  demoOrderResponse,
  readDemoJson,
  requireDemoSession,
  requireString,
} from "@/lib/rwa-demo-api";
import { RWA_DEMO_SWAP_DISCLOSURE, isQuoteExpired } from "@/lib/rwa-demo";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readDemoJson(request);
    const session = await requireDemoSession(request, body.walletAddress);
    const quoteId = requireString(body.quoteId, "quoteId");
    const quote = await getRwaDemoQuoteForWallet(quoteId, session.walletAddress);
    if (!quote) {
      throw new RwaDemoRequestError(404, "QUOTE_NOT_FOUND", "The requested quote was not found.");
    }
    if (!quote.orderId && isQuoteExpired(quote.expiresAt)) {
      throw new RwaDemoRequestError(409, "QUOTE_EXPIRED", "The quote has expired. Request a fresh Meteora Devnet quote.");
    }
    const result = await createRwaDemoOrderFromQuote({
      orderId: randomUUID(),
      quoteId,
      walletAddress: session.walletAddress,
    });
    return NextResponse.json({
      order: demoOrderResponse(result.order),
      reused: result.reused,
      disclosure: RWA_DEMO_SWAP_DISCLOSURE,
    });
  } catch (error) {
    return demoErrorResponse(error);
  }
}
