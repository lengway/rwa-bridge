import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRwaDemoQuote, type RwaDemoQuoteRecord } from "@/lib/devnet-ledger";
import { getMeteoraDemoQuote } from "@/lib/meteora-devnet";
import {
  demoErrorResponse,
  demoQuoteResponse,
  readDemoJson,
  requireDemoSession,
} from "@/lib/rwa-demo-api";
import {
  RWA_DEMO_ASSET_ID,
  RWA_DEMO_SWAP_DISCLOSURE,
  RwaDemoValidationError,
  requirePositiveAtomicAmount,
  serializeAtomic,
  type RwaDemoSide,
} from "@/lib/rwa-demo";

export const runtime = "nodejs";

const MAX_U64 = BigInt("18446744073709551615");

function demoSide(value: unknown): RwaDemoSide {
  if (value === "BUY" || value === "SELL") return value;
  throw new RwaDemoValidationError("side must be BUY or SELL.");
}

export async function POST(request: Request) {
  try {
    const body = await readDemoJson(request);
    const session = await requireDemoSession(request, body.walletAddress);
    if (body.assetId !== RWA_DEMO_ASSET_ID) {
      throw new RwaDemoValidationError("Only the server-configured Solana Devnet test asset can be quoted.");
    }
    const side = demoSide(body.side);
    const inputAmountAtomic = serializeAtomic(requirePositiveAtomicAmount(
      body.inputAmountAtomic,
      "inputAmountAtomic",
      MAX_U64,
    ));
    const quote = await getMeteoraDemoQuote({ side, inputAmountAtomic });
    const now = Date.now();
    const record: RwaDemoQuoteRecord = {
      id: randomUUID(),
      walletAddress: session.walletAddress,
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
      priceImpact: quote.priceImpact,
      poolAddress: quote.poolAddress,
      route: quote.route,
      network: quote.network,
      expiresAt: quote.expiresAt,
      createdAt: now,
    };
    await createRwaDemoQuote(record);
    return NextResponse.json({ quote: demoQuoteResponse(record), disclosure: RWA_DEMO_SWAP_DISCLOSURE });
  } catch (error) {
    return demoErrorResponse(error);
  }
}
