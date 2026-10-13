import "server-only";

import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/auth-server";
import { isValidWalletAddress, unavailableResponse } from "@/lib/devnet-route";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { getMoonPayNumericField, getTransactionByExternalId, isMoonPayExternalId, moonpayConfig } from "@/lib/moonpay";
import { devnetConfig, explorerUrl, mintTestDollars } from "@/lib/solana-server";
import { notifyReceipt } from "@/lib/receipt-notifications";

type BuyCredit = { amountUsd: number; signature: string; explorerUrl: string };

// This in-memory guard prevents duplicate credits and concurrent minting in this server process.
const creditedTransactionIds = new Set<string>();
const creditInFlightIds = new Set<string>();
const creditedTransactions = new Map<string, BuyCredit>();

export async function POST(request: Request) {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("moonpay");

  if (!await getVerifiedEmailFromRequest(request)) {
    return NextResponse.json({ error: "Sign in to confirm the MoonPay purchase." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    externalTransactionId?: unknown;
    walletAddress?: unknown;
    flow?: unknown;
  } | null;

  if (body?.flow !== "buy" || !isMoonPayExternalId(body.externalTransactionId)) {
    return NextResponse.json({ error: "Provide a valid MoonPay purchase ID." }, { status: 400 });
  }
  if (!isValidWalletAddress(body.walletAddress)) {
    return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  }

  let transaction: Record<string, unknown> | null;
  try {
    transaction = await getTransactionByExternalId(body.externalTransactionId, "buy");
  } catch {
    return NextResponse.json({ error: "Couldn't verify the MoonPay purchase. Please try again." }, { status: 502 });
  }
  if (!transaction) return NextResponse.json({ pending: true, status: "notFound" }, { status: 202 });

  const status = typeof transaction.status === "string" ? transaction.status : "pending";
  const normalizedStatus = status.toLowerCase();
  const failureReason = typeof transaction.failureReason === "string" && transaction.failureReason.trim()
    ? transaction.failureReason.trim()
    : null;
  if (normalizedStatus === "completed" || normalizedStatus === "failed") {
    console.error("MoonPay buy status check", { status, failureReason });
  }

  if (transaction.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "The MoonPay purchase is linked to a different wallet." }, { status: 403 });
  }
  if (normalizedStatus === "failed") {
    return NextResponse.json({
      error: failureReason ? `MoonPay declined the payment: ${failureReason}` : "The MoonPay payment failed.",
      status: "failed",
      ...(failureReason ? { failureReason } : {}),
    }, { status: 409 });
  }
  // MoonPay's completed status is terminal; sandbox transactions pass through pending and processing first.
  if (normalizedStatus !== "completed") {
    return NextResponse.json({ pending: true, status }, { status: 202 });
  }

  const amountUsd = moonpayConfig.environment === "sandbox"
    ? getMoonPayNumericField(transaction, "baseCurrencyAmount")
    : getMoonPayNumericField(transaction, "quoteCurrencyAmount");
  if (amountUsd === null) {
    return NextResponse.json({ error: "MoonPay did not return an amount for the completed purchase." }, { status: 502 });
  }
  if (!devnetConfig.configured) return unavailableResponse();

  const externalTransactionId = body.externalTransactionId;
  const previousCredit = creditedTransactions.get(externalTransactionId);
  if (previousCredit) {
    notifyReceipt(request, {
      kind: "moonpay",
      amountUsd: previousCredit.amountUsd,
      details: "Test dollars were credited after server-side verification of the completed MoonPay purchase.",
      explorerUrl: previousCredit.explorerUrl,
      receiptId: externalTransactionId,
    });
    return NextResponse.json(previousCredit);
  }
  if (creditedTransactionIds.has(externalTransactionId) || creditInFlightIds.has(externalTransactionId)) {
    return NextResponse.json({ pending: true, status: "crediting" }, { status: 202 });
  }

  creditInFlightIds.add(externalTransactionId);
  try {
    const signature = await mintTestDollars(body.walletAddress, amountUsd);
    invalidateDevnetPortfolio(body.walletAddress);
    const result: BuyCredit = { amountUsd, signature, explorerUrl: explorerUrl(signature) };
    creditedTransactionIds.add(externalTransactionId);
    creditedTransactions.set(externalTransactionId, result);
    notifyReceipt(request, {
      kind: "moonpay",
      amountUsd,
      details: "Test dollars were credited after server-side verification of the completed MoonPay purchase.",
      explorerUrl: result.explorerUrl,
      receiptId: externalTransactionId,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "The purchase is confirmed, but test dollars couldn't be credited." }, { status: 502 });
  } finally {
    creditInFlightIds.delete(externalTransactionId);
  }
}
