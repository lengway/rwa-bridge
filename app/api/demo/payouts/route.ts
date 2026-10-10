import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  confirmRwaDemoPayout,
  createRwaDemoPayout,
  getRwaDemoOrderForWallet,
  type RwaDemoPayoutEvent,
} from "@/lib/devnet-ledger";
import { getVerifiedRwaDemoConnection, requireRwaDemoConfig } from "@/lib/rwa-demo-config";
import {
  RwaDemoRequestError,
  demoErrorResponse,
  demoPayoutResponse,
  readDemoJson,
  requireDemoSession,
  requireString,
} from "@/lib/rwa-demo-api";
import {
  RWA_DEMO_PAYOUT_DISCLOSURE,
  isCompletedSell,
  kztFromQuoteAtomic,
  requirePositiveAtomicAmount,
  serializeAtomic,
} from "@/lib/rwa-demo";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readDemoJson(request);
    const session = await requireDemoSession(request, body.walletAddress);
    const orderId = requireString(body.orderId, "orderId");
    const configured = requireRwaDemoConfig();
    if (configured.externalQuoteMint) {
      throw new RwaDemoRequestError(409, "EXTERNAL_QUOTE_MODE", `Simulated KZT payouts are disabled when ${configured.quoteSymbol} is supplied externally. A completed sale returns ${configured.quoteSymbol} on Devnet.`);
    }
    // This call validates the configured RPC's real genesis hash before the
    // simulated receipt is created. No fiat or token transfer is performed.
    const { config } = await getVerifiedRwaDemoConnection();
    const order = await getRwaDemoOrderForWallet(orderId, session.walletAddress);
    if (!order) throw new RwaDemoRequestError(404, "ORDER_NOT_FOUND", "The requested Devnet order was not found.");
    if (!isCompletedSell(order)) {
      throw new RwaDemoRequestError(409, "SELL_NOT_CONFIRMED", "A simulated payout is available only after a verified completed Solana Devnet test-asset sale.");
    }
    const quoteTokenAmount = requirePositiveAtomicAmount(
      order.actualOutputAmountAtomic,
      "confirmed quote output",
    );
    const simulatedKztAmount = kztFromQuoteAtomic({
      quoteAmountAtomic: quoteTokenAmount,
      kztPerQuoteToken: config.kztPerQuoteToken,
      quoteDecimals: config.quoteDecimals,
    });
    const now = Date.now();
    const candidate: RwaDemoPayoutEvent = {
      id: randomUUID(),
      orderId: order.id,
      walletAddress: session.walletAddress,
      quoteTokenAmountAtomic: serializeAtomic(quoteTokenAmount),
      simulatedKztAmount: serializeAtomic(simulatedKztAmount),
      status: "SIMULATED_CREATED",
      disclosure: RWA_DEMO_PAYOUT_DISCLOSURE,
      createdAt: now,
      updatedAt: now,
    };
    const created = await createRwaDemoPayout(candidate);
    const payout = created.event.status === "SIMULATED_CONFIRMED"
      ? created.event
      : await confirmRwaDemoPayout({ eventId: created.event.id, walletAddress: session.walletAddress });
    return NextResponse.json({ payout: demoPayoutResponse(payout), disclosure: RWA_DEMO_PAYOUT_DISCLOSURE });
  } catch (error) {
    return demoErrorResponse(error);
  }
}
