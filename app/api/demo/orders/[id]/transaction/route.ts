import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getRwaDemoOrderForWallet,
  refreshRwaDemoOrderQuote,
  withLedgerKeyLock,
  type RwaDemoQuoteRecord,
} from "@/lib/devnet-ledger";
import { buildMeteoraDemoSwap, isMeteoraDemoTransactionStillValid } from "@/lib/meteora-devnet";
import {
  RwaDemoRequestError,
  demoErrorResponse,
  demoOrderResponse,
  demoQuoteResponse,
  readOptionalDemoJson,
  requireDemoSession,
} from "@/lib/rwa-demo-api";
import { RWA_DEMO_SWAP_DISCLOSURE } from "@/lib/rwa-demo";

export const runtime = "nodejs";

async function prepareTransaction({
  orderId,
  walletAddress,
}: {
  orderId: string;
  walletAddress: string;
}) {
  return withLedgerKeyLock(`rwa-demo-transaction:${orderId}`, async () => {
    const order = await getRwaDemoOrderForWallet(orderId, walletAddress);
    if (!order) throw new RwaDemoRequestError(404, "ORDER_NOT_FOUND", "The requested Devnet order was not found.");
    if (!["ORDER_CREATED", "WALLET_APPROVAL_PENDING", "QUOTE_EXPIRED", "USER_REJECTED", "CONFIRMATION_TIMEOUT"].includes(order.status)) {
      throw new RwaDemoRequestError(409, "ORDER_NOT_BUILDABLE", "This Devnet order cannot be prepared for another transaction.");
    }
    if (order.status === "WALLET_APPROVAL_PENDING" || order.status === "CONFIRMATION_TIMEOUT") {
      if (order.transactionLastValidBlockHeight === undefined) {
        throw new RwaDemoRequestError(409, "TRANSACTION_PENDING", "A prior prepared transaction has no verifiable expiry. Do not sign another transaction.");
      }
      if (await isMeteoraDemoTransactionStillValid(order.transactionLastValidBlockHeight)) {
        throw new RwaDemoRequestError(409, "TRANSACTION_PENDING", "A prior prepared transaction can still execute. Confirm it or wait for its Solana blockhash to expire before preparing another.");
      }
    }

    const built = await buildMeteoraDemoSwap({
      walletAddress,
      side: order.side,
      inputAmountAtomic: order.inputAmountAtomic,
    });
    const now = Date.now();
    const quote: RwaDemoQuoteRecord = {
      id: randomUUID(),
      walletAddress,
      assetId: built.quote.assetId,
      side: built.quote.side,
      inputMint: built.quote.inputMint,
      outputMint: built.quote.outputMint,
      inputAmountAtomic: built.quote.inputAmountAtomic,
      expectedOutputAtomic: built.quote.expectedOutputAtomic,
      minimumOutputAtomic: built.quote.minimumOutputAtomic,
      feeAmountAtomic: built.quote.feeAmountAtomic,
      protocolFeeAtomic: built.quote.protocolFeeAtomic,
      slippageBps: built.quote.slippageBps,
      priceImpact: built.quote.priceImpact,
      poolAddress: built.quote.poolAddress,
      route: built.quote.route,
      network: built.quote.network,
      expiresAt: built.quote.expiresAt,
      createdAt: now,
    };
    const refreshedOrder = await refreshRwaDemoOrderQuote({
      orderId,
      walletAddress,
      quote,
      transactionMessageDigest: built.transactionMessageDigest,
      transactionLastValidBlockHeight: built.lastValidBlockHeight,
      now,
    });
    return { built, quote, order: refreshedOrder };
  });
}

async function transactionResponse(request: Request, id: string, body: Record<string, unknown>) {
  const session = await requireDemoSession(request, body.walletAddress);
  const result = await prepareTransaction({ orderId: id, walletAddress: session.walletAddress });
  return NextResponse.json({
    order: demoOrderResponse(result.order),
    quote: demoQuoteResponse(result.quote),
    serializedTransaction: result.built.serializedTransaction,
    blockhash: result.built.blockhash,
    lastValidBlockHeight: result.built.lastValidBlockHeight,
    network: "devnet",
    disclosure: RWA_DEMO_SWAP_DISCLOSURE,
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  void request;
  void params;
  return NextResponse.json({ error: "Use POST to prepare a Devnet transaction.", code: "METHOD_NOT_ALLOWED" }, {
    status: 405,
    headers: { Allow: "POST" },
  });
}

// Kept for non-browser/mobile clients that prefer an explicit mutation method.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [body, route] = await Promise.all([readOptionalDemoJson(request), params]);
    return await transactionResponse(request, route.id, body);
  } catch (error) {
    return demoErrorResponse(error);
  }
}
