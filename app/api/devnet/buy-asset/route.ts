import "server-only";

import { NextResponse } from "next/server";
import { OFFICE_ASSET } from "@/lib/assets";
import {
  isConfigured,
  isValidAmount,
  isValidWalletAddress,
  safeError,
  unavailableResponse,
} from "@/lib/devnet-route";
import { appendPurchase, findLedgerPurchase, hasLedgerSignature, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { explorerUrl, mintAsset, verifyIncomingPayment } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    assetId?: unknown;
    amountUsd?: unknown;
    signature?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd)) {
    return NextResponse.json({ error: "The amount must be between $1 and $1,000." }, { status: 400 });
  }
  if (body?.assetId !== OFFICE_ASSET.id || OFFICE_ASSET.buyFlow !== "onchain") {
    return NextResponse.json({ error: "Buying this asset is not available." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "The transfer signature is missing." }, { status: 400 });
  }

  const walletAddress = body.walletAddress;
  const assetId = body.assetId;
  const amountUsd = body.amountUsd;
  const paymentSignature = body.signature;
  return withLedgerKeyLock(paymentSignature, async () => {
    const existingPurchase = await findLedgerPurchase(walletAddress, paymentSignature);
    if (existingPurchase) {
      if (existingPurchase.assetId !== assetId || Math.abs(existingPurchase.amountUsd - amountUsd) > 0.000001) {
        return NextResponse.json({ error: "This transaction was already used for a different purchase.", stage: "verify" }, { status: 409 });
      }
      const response = {
        signature: existingPurchase.mintSignature,
        explorerUrl: explorerUrl(existingPurchase.mintSignature),
        units: existingPurchase.units,
      };
      notifyReceipt(request, {
        kind: "asset-purchase",
        amountUsd: existingPurchase.amountUsd,
        details: `Issued ${existingPurchase.units.toLocaleString("en-US", { maximumFractionDigits: 6 })} OFFICE shares.`,
        explorerUrl: response.explorerUrl,
        receiptId: existingPurchase.paymentSignature,
      });
      return NextResponse.json(response);
    }

    try {
      if (await hasLedgerSignature(paymentSignature)) {
        return NextResponse.json({ error: "This transaction has already been used.", stage: "verify" }, { status: 409 });
      }
      await verifyIncomingPayment({
        signature: paymentSignature,
        fromOwner: walletAddress,
        minAmountUi: amountUsd,
      });
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Couldn't confirm the purchase on Solana devnet."),
        stage: "verify",
      }, { status: 400 });
    }

    let signature: string;
    try {
      signature = await mintAsset(walletAddress, amountUsd);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Couldn't issue the share after payment."),
        stage: "mint",
      }, { status: 502 });
    }

    try {
      const purchase = await appendPurchase(walletAddress, {
        assetId: OFFICE_ASSET.id,
        amountUsd,
        units: amountUsd,
        paymentSignature,
        mintSignature: signature,
        at: Date.now(),
      });
      invalidateDevnetPortfolio(walletAddress);
      const response = { signature: purchase.mintSignature, explorerUrl: explorerUrl(purchase.mintSignature), units: purchase.units };
      notifyReceipt(request, {
        kind: "asset-purchase",
        amountUsd: purchase.amountUsd,
        details: `Issued ${purchase.units.toLocaleString("en-US", { maximumFractionDigits: 6 })} OFFICE shares.`,
        explorerUrl: response.explorerUrl,
        receiptId: purchase.paymentSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "The share was issued, but the purchase couldn't be saved."),
        stage: "ledger",
      }, { status: 500 });
    }
  });
}
