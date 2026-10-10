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
    return NextResponse.json({ error: "Войдите, чтобы подтвердить покупку MoonPay." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    externalTransactionId?: unknown;
    walletAddress?: unknown;
    flow?: unknown;
  } | null;

  if (body?.flow !== "buy" || !isMoonPayExternalId(body.externalTransactionId)) {
    return NextResponse.json({ error: "Укажите корректный идентификатор покупки MoonPay." }, { status: 400 });
  }
  if (!isValidWalletAddress(body.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }

  let transaction: Record<string, unknown> | null;
  try {
    transaction = await getTransactionByExternalId(body.externalTransactionId, "buy");
  } catch {
    return NextResponse.json({ error: "Не удалось проверить покупку MoonPay. Повторите попытку." }, { status: 502 });
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
    return NextResponse.json({ error: "Покупка MoonPay привязана к другому кошельку." }, { status: 403 });
  }
  if (normalizedStatus === "failed") {
    return NextResponse.json({
      error: failureReason ? `MoonPay отклонил оплату: ${failureReason}` : "Оплата MoonPay не прошла.",
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
    return NextResponse.json({ error: "MoonPay не вернул сумму завершённой покупки." }, { status: 502 });
  }
  if (!devnetConfig.configured) return unavailableResponse();

  const externalTransactionId = body.externalTransactionId;
  const previousCredit = creditedTransactions.get(externalTransactionId);
  if (previousCredit) {
    notifyReceipt(request, {
      kind: "moonpay",
      amountUsd: previousCredit.amountUsd,
      details: "Тестовые доллары зачислены после серверной проверки завершённой покупки MoonPay.",
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
      details: "Тестовые доллары зачислены после серверной проверки завершённой покупки MoonPay.",
      explorerUrl: result.explorerUrl,
      receiptId: externalTransactionId,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Покупка подтверждена, но не удалось зачислить тестовые доллары." }, { status: 502 });
  } finally {
    creditInFlightIds.delete(externalTransactionId);
  }
}
