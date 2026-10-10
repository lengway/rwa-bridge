import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  reserveRwaDemoFunding,
  updateRwaDemoFundingEvent,
  type RwaDemoFundingEvent,
} from "@/lib/devnet-ledger";
import {
  demoExplorerTransactionUrl,
  hashDemoRequestIp,
  mintConfiguredQuoteDemo,
  requireRwaDemoConfig,
} from "@/lib/rwa-demo-config";
import {
  demoErrorResponse,
  demoFundingResponse,
  readDemoJson,
  requireDemoSession,
} from "@/lib/rwa-demo-api";
import {
  RWA_DEMO_FUNDING_DISCLOSURE,
  RwaDemoValidationError,
  isRequestId,
  parseKztAmount,
  quoteAtomicFromKzt,
  serializeAtomic,
} from "@/lib/rwa-demo";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readDemoJson(request);
    const session = await requireDemoSession(request, body.walletAddress);
    const config = requireRwaDemoConfig();
    const requestedKztAmount = parseKztAmount(body.requestedKztAmount, config.fundingMaxKzt);
    const quoteTokenAmount = quoteAtomicFromKzt({
      requestedKzt: requestedKztAmount,
      kztPerQuoteToken: config.kztPerQuoteToken,
      quoteDecimals: config.quoteDecimals,
    });
    if (quoteTokenAmount <= BigInt(0)) {
      throw new RwaDemoValidationError("requestedKztAmount is too small to produce a QUOTE-DEMO atomic amount.");
    }
    // A top-up that would exceed an enabled faucet's per-request policy is
    // rejected before it reaches the ledger or payer key.
    if (config.faucetEnabled && quoteTokenAmount > config.faucetMaxQuoteAtomic) {
      throw new RwaDemoValidationError("requestedKztAmount exceeds the configured Devnet faucet limit.");
    }
    if (body.idempotencyKey !== undefined && !isRequestId(body.idempotencyKey)) {
      throw new RwaDemoValidationError("idempotencyKey must contain 8 to 128 URL-safe characters.");
    }

    const now = Date.now();
    const candidate: RwaDemoFundingEvent = {
      id: randomUUID(),
      walletAddress: session.walletAddress,
      ipHash: hashDemoRequestIp(request),
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      requestedKztAmount: serializeAtomic(requestedKztAmount),
      demoRateKztPerQuoteToken: serializeAtomic(config.kztPerQuoteToken),
      quoteTokenAmountAtomic: serializeAtomic(quoteTokenAmount),
      status: "SIMULATED_CREATED",
      createdAt: now,
      updatedAt: now,
    };
    const reserved = await reserveRwaDemoFunding({
      event: candidate,
      dailyMaxQuoteAtomic: serializeAtomic(config.faucetDailyMaxQuoteAtomic),
      now,
    });
    // A replay never repeats an external mint call. If a prior attempt stopped
    // midway, it remains auditable/fail-closed for manual review instead.
    if (reserved.reused) {
      return NextResponse.json({ funding: demoFundingResponse(reserved.event), disclosure: RWA_DEMO_FUNDING_DISCLOSURE });
    }

    let event = await updateRwaDemoFundingEvent({
      eventId: reserved.event.id,
      walletAddress: session.walletAddress,
      status: "SIMULATED_CONFIRMED",
    });
    if (!config.faucetEnabled) {
      return NextResponse.json({ funding: demoFundingResponse(event), disclosure: RWA_DEMO_FUNDING_DISCLOSURE });
    }

    try {
      const mintSignature = await mintConfiguredQuoteDemo({
        walletAddress: session.walletAddress,
        amountAtomic: quoteTokenAmount,
      });
      event = await updateRwaDemoFundingEvent({
        eventId: event.id,
        walletAddress: session.walletAddress,
        status: "TEST_TOKEN_ISSUED",
        mintSignature,
      });
      return NextResponse.json({
        funding: demoFundingResponse(event),
        disclosure: RWA_DEMO_FUNDING_DISCLOSURE,
        mintExplorerUrl: demoExplorerTransactionUrl(mintSignature),
      });
    } catch {
      // Do not retry a server-paid mint blindly: an RPC timeout could have
      // committed it even if the response was lost.
      event = await updateRwaDemoFundingEvent({
        eventId: event.id,
        walletAddress: session.walletAddress,
        status: "NEEDS_REVIEW",
        errorCode: "QUOTE_ISSUANCE_UNVERIFIED",
      });
      return NextResponse.json({ funding: demoFundingResponse(event), disclosure: RWA_DEMO_FUNDING_DISCLOSURE });
    }
  } catch (error) {
    return demoErrorResponse(error);
  }
}
