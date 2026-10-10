import "server-only";

import { NextResponse } from "next/server";
import {
  getRwaDemoOrderForWallet,
  markRwaDemoOrderConfirmed,
  markRwaDemoOrderConfirmationTimeout,
  markRwaDemoOrderFailed,
  completeRwaDemoOrder,
  recordRwaDemoOrderSubmission,
  withLedgerKeyLock,
} from "@/lib/devnet-ledger";
import {
  MeteoraConfirmationTimeoutError,
  MeteoraDevnetError,
  verifyMeteoraDemoSwap,
} from "@/lib/meteora-devnet";
import {
  RwaDemoRequestError,
  demoErrorResponse,
  demoOrderResponse,
  readDemoJson,
  requireDemoSession,
  requireString,
} from "@/lib/rwa-demo-api";
import { RWA_DEMO_SWAP_DISCLOSURE } from "@/lib/rwa-demo";

export const runtime = "nodejs";

function validSignature(value: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(value);
}

async function confirmOrder({
  orderId,
  walletAddress,
  signature,
}: {
  orderId: string;
  walletAddress: string;
  signature: string;
}) {
  return withLedgerKeyLock(`rwa-demo-confirm:${orderId}`, async () => {
    const existing = await getRwaDemoOrderForWallet(orderId, walletAddress);
    if (!existing) throw new RwaDemoRequestError(404, "ORDER_NOT_FOUND", "The requested demo order was not found.");
    if (existing.status === "COMPLETED") {
      if (existing.transactionSignature !== signature) {
        throw new RwaDemoRequestError(409, "ORDER_COMPLETED", "This demo order is already completed with another transaction.");
      }
      return { kind: "completed" as const, order: existing };
    }
    if (existing.status === "TRANSACTION_FAILED" || existing.status === "NEEDS_REVIEW") {
      throw new RwaDemoRequestError(409, "ORDER_FINAL", "This demo order is in a final state and cannot be confirmed again.");
    }

    const order = await recordRwaDemoOrderSubmission({ orderId, walletAddress, signature });
    if (!order.transactionMessageDigest) {
      throw new RwaDemoRequestError(409, "ORDER_NOT_PREPARED", "This demo order has no prepared transaction.");
    }
    try {
      const verification = await verifyMeteoraDemoSwap({
        signature,
        walletAddress,
        side: order.side,
        expectedMessageDigest: order.transactionMessageDigest,
        expectedInputAmountAtomic: order.inputAmountAtomic,
        minimumOutputAtomic: order.minimumOutputAtomic,
      });
      const inputBalanceAfterAtomic = verification.inputMint === order.inputMint
        ? (order.side === "BUY" ? verification.quoteBalanceAfterAtomic : verification.rwaBalanceAfterAtomic)
        : verification.rwaBalanceAfterAtomic;
      const outputBalanceAfterAtomic = verification.outputMint === order.outputMint
        ? (order.side === "BUY" ? verification.rwaBalanceAfterAtomic : verification.quoteBalanceAfterAtomic)
        : verification.quoteBalanceAfterAtomic;
      const confirmed = await markRwaDemoOrderConfirmed({
        orderId,
        walletAddress,
        actualInputAmountAtomic: verification.actualInputAmountAtomic,
        actualOutputAmountAtomic: verification.actualOutputAmountAtomic,
        inputBalanceAfterAtomic,
        outputBalanceAfterAtomic,
      });
      const completed = await completeRwaDemoOrder({ orderId, walletAddress });
      return { kind: "completed" as const, order: completed, confirmed };
    } catch (error) {
      if (error instanceof MeteoraConfirmationTimeoutError) {
        const timeoutOrder = await markRwaDemoOrderConfirmationTimeout({
          orderId,
          walletAddress,
          errorCode: error.code,
        });
        return { kind: "timeout" as const, order: timeoutOrder };
      }
      if (error instanceof MeteoraDevnetError
        && (error.code === "TRANSACTION_FAILED" || error.code === "TRANSACTION_MISMATCH")) {
        const failedOrder = await markRwaDemoOrderFailed({
          orderId,
          walletAddress,
          status: error.code === "TRANSACTION_FAILED" ? "TRANSACTION_FAILED" : "NEEDS_REVIEW",
          errorCode: error.code,
        });
        return { kind: "failed" as const, order: failedOrder, error };
      }
      throw error;
    }
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await readDemoJson(request);
    const session = await requireDemoSession(request, body.walletAddress);
    const signature = requireString(body.signature, "signature");
    if (!validSignature(signature)) {
      throw new RwaDemoRequestError(400, "INVALID_SIGNATURE", "signature is not a valid Solana transaction signature.");
    }
    const { id } = await params;
    const result = await confirmOrder({ orderId: id, walletAddress: session.walletAddress, signature });
    if (result.kind === "timeout") {
      return NextResponse.json({
        order: demoOrderResponse(result.order),
        pending: true,
        disclosure: RWA_DEMO_SWAP_DISCLOSURE,
      }, { status: 202 });
    }
    if (result.kind === "failed") {
      return NextResponse.json({
        error: result.error.message,
        code: result.error.code,
        order: demoOrderResponse(result.order),
        disclosure: RWA_DEMO_SWAP_DISCLOSURE,
      }, { status: 409 });
    }
    return NextResponse.json({ order: demoOrderResponse(result.order), disclosure: RWA_DEMO_SWAP_DISCLOSURE });
  } catch (error) {
    return demoErrorResponse(error);
  }
}
