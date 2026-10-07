import "server-only";

import { NextResponse } from "next/server";
import {
  getMoonPayNumericField,
  getTransactionByExternalId,
  isMoonPayExternalId,
  moonpayConfig,
} from "@/lib/moonpay";
import { isValidWalletAddress } from "@/lib/devnet-route";
import { devnetConfig, explorerUrl, mintTestDollars } from "@/lib/solana-server";

type BuyCredit = { amountUsd: number; signature: string; explorerUrl: string };

// This in-memory guard resets on restart; it prevents duplicate credits in this server process.
const creditedTransactionIds = new Set<string>();
const creditInFlightIds = new Set<string>();
const creditedTransactions = new Map<string, BuyCredit>();

export async function POST(request: Request) {
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
  if (!transaction) return NextResponse.json({ pending: true }, { status: 202 });
  if (transaction.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "Покупка MoonPay привязана к другому кошельку." }, { status: 403 });
  }

  if (transaction.status === "failed") {
    return NextResponse.json({ error: "Оплата MoonPay не прошла.", status: "failed" }, { status: 409 });
  }
  // MoonPay documents `completed` as the terminal success status; sandbox transactions progress through pending and processing first.
  if (transaction.status !== "completed") {
    return NextResponse.json({ pending: true, status: transaction.status }, { status: 202 });
  }

  // In sandbox, baseCurrencyAmount is the fiat USD amount paid (excluding fees); production credits quoteCurrencyAmount in USDC.
  const amountUsd = moonpayConfig.environment === "sandbox"
    ? getMoonPayNumericField(transaction, "baseCurrencyAmount")
    : getMoonPayNumericField(transaction, "quoteCurrencyAmount");
  if (amountUsd === null) {
    return NextResponse.json({ error: "MoonPay не вернул сумму завершённой покупки." }, { status: 502 });
  }
  if (!devnetConfig.configured) return NextResponse.json({ amountUsd });

  const externalTransactionId = body.externalTransactionId;
  const previousCredit = creditedTransactions.get(externalTransactionId);
  if (previousCredit) return NextResponse.json(previousCredit);
  if (creditedTransactionIds.has(externalTransactionId) || creditInFlightIds.has(externalTransactionId)) {
    return NextResponse.json({ pending: true, status: "crediting" }, { status: 202 });
  }

  creditInFlightIds.add(externalTransactionId);
  try {
    // Sandbox delivers test SOL; mirror the USD baseCurrencyAmount in the app's devnet test dollars instead.
    const signature = await mintTestDollars(body.walletAddress, amountUsd);
    const result: BuyCredit = {
      amountUsd,
      signature,
      explorerUrl: explorerUrl(signature),
    };
    creditedTransactionIds.add(externalTransactionId);
    creditedTransactions.set(externalTransactionId, result);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Покупка подтверждена, но не удалось зачислить тестовые доллары." }, { status: 502 });
  } finally {
    creditInFlightIds.delete(externalTransactionId);
  }
}
