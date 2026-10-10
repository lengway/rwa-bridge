import "server-only";

import { NextResponse } from "next/server";
import {
  getMoonPayNumericField,
  getTransactionByExternalId,
  isMoonPayExternalId,
} from "@/lib/moonpay";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";

export async function POST(request: Request) {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("moonpay");

  const body = await request.json().catch(() => null) as { externalTransactionId?: unknown } | null;
  if (!isMoonPayExternalId(body?.externalTransactionId)) {
    return NextResponse.json({ error: "Укажите корректный идентификатор вывода MoonPay." }, { status: 400 });
  }

  let transaction: Record<string, unknown> | null;
  try {
    transaction = await getTransactionByExternalId(body.externalTransactionId);
  } catch {
    return NextResponse.json({ error: "Не удалось проверить вывод MoonPay. Повторите попытку." }, { status: 502 });
  }
  if (!transaction) return NextResponse.json({ pending: true, status: "notFound" }, { status: 202 });

  const status = typeof transaction.status === "string" ? transaction.status : "pending";
  const depositAddress = typeof transaction.depositAddress === "string" ? transaction.depositAddress : undefined;
  // MoonPay's sell transaction field for the requested crypto amount is `baseCurrencyAmount`.
  const cryptoAmount = getMoonPayNumericField(transaction, "cryptoAmount", "baseCurrencyAmount") ?? undefined;

  return NextResponse.json({
    status,
    ...(depositAddress ? { depositAddress } : {}),
    ...(cryptoAmount ? { cryptoAmount } : {}),
  });
}
