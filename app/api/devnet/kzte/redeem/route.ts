import "server-only";

import { NextResponse } from "next/server";
import { appendKzteOperation, findKzteOperation, hasLedgerSignature, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { isConfigured, safeError, unavailableResponse } from "@/lib/devnet-route";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";
import { getKztRateForOperation } from "@/lib/market-server";
import { getSessionWallet } from "@/lib/session-wallet";
import { devnetConfig, explorerUrl, verifyIncomingPayment } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";

function isSignature(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 100;
}

export async function POST(request: Request) {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("kzte");

  if (!isConfigured()) return unavailableResponse();
  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Sign in to withdraw KZTE from your wallet." }, { status: 401 });
  const body = await request.json().catch(() => null) as { signature?: unknown } | null;
  if (!isSignature(body?.signature)) {
    return NextResponse.json({ error: "The KZTE transfer signature is missing." }, { status: 400 });
  }
  const walletAddress = session.walletAddress;
  const transferSignature = body.signature;

  return withLedgerKeyLock(`kzte-redeem:${transferSignature}`, async () => {
    try {
      let operation = await findKzteOperation(walletAddress, transferSignature);
      if (operation && (operation.sourceSignature !== transferSignature || operation.kind !== "redeem")) {
        return NextResponse.json({ error: "This transaction was already used for a different operation." }, { status: 409 });
      }
      if (!operation) {
        if (await hasLedgerSignature(transferSignature)) {
          return NextResponse.json({ error: "This transaction has already been used." }, { status: 409 });
        }
        const amountKzt = await verifyIncomingPayment({
          signature: transferSignature,
          fromOwner: walletAddress,
          minAmountUi: 0.000001,
          mintAddress: devnetConfig.kzteMint,
        });
        const rate = await getKztRateForOperation();
        operation = await appendKzteOperation(walletAddress, {
          kind: "redeem",
          sourceSignature: transferSignature,
          amountKzt,
          amountUsd: amountKzt / rate.usdKzt,
          at: Date.now(),
        });
      }
      invalidateDevnetPortfolio(walletAddress);
      const response = {
        amountKzt: operation.amountKzt,
        amountUsd: operation.amountUsd,
        signature: operation.sourceSignature,
        explorerUrl: operation.sourceSignature ? explorerUrl(operation.sourceSignature) : undefined,
      };
      notifyReceipt(request, {
        kind: "kzte-redeem",
        amountUsd: operation.amountUsd,
        details: `KZTE returned to the Intebix reserve: ${operation.amountKzt.toLocaleString("en-US", { maximumFractionDigits: 6 })} ₸. The Intebix payout is processed on Solana devnet.`,
        explorerUrl: response.explorerUrl,
        receiptId: transferSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({ error: safeError(error, "Couldn't return KZTE to the Intebix reserve.") }, { status: 400 });
    }
  });
}
