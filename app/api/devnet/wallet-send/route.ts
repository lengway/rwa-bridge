import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, isValidAmount, isValidWalletAddress, unavailableResponse } from "@/lib/devnet-route";
import { explorerUrl, verifyOutgoingWalletTransfer } from "@/lib/solana-server";
import { notifyReceipt } from "@/lib/receipt-notifications";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    recipientAddress?: unknown;
    amountUsd?: unknown;
    signature?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress) || !isValidWalletAddress(body?.recipientAddress)) {
    return NextResponse.json({ error: "Check the Solana wallet addresses." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd, 0.01, 100_000)) {
    return NextResponse.json({ error: "Check the transfer amount." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "The transfer signature is missing." }, { status: 400 });
  }

  try {
    const amountUsd = await verifyOutgoingWalletTransfer({
      signature: body.signature,
      fromOwner: body.walletAddress,
      toOwner: body.recipientAddress,
      minAmountUi: body.amountUsd,
    });
    if (amountUsd === null) {
      return NextResponse.json({ error: "The transfer is not yet confirmed on Solana devnet." }, { status: 409 });
    }
    invalidateDevnetPortfolio(body.walletAddress);
    notifyReceipt(request, {
      kind: "wallet-send",
      amountUsd,
      details: `Test dollars sent to address ${body.recipientAddress}.`,
      explorerUrl: explorerUrl(body.signature),
      receiptId: body.signature,
    });
    return NextResponse.json({ ok: true, amountUsd });
  } catch {
    return NextResponse.json({ error: "Couldn't verify the transfer on Solana devnet." }, { status: 502 });
  }
}
