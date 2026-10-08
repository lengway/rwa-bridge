import "server-only";

import { NextResponse } from "next/server";
import { isValidWalletAddress } from "@/lib/devnet-route";
import { devnetConfig, explorerUrl, mintTestDollars } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { getOrder, type TransakOrder } from "@/lib/transak";
import { notifyReceipt } from "@/lib/receipt-notifications";

type CreditResult = { status: "completed"; amountUsd: number; signature: string; explorerUrl: string };

// This in-memory guard resets on restart; it prevents duplicate credits in this server process.
const creditedOrderIds = new Set<string>();
const creditInFlightOrderIds = new Set<string>();
const creditedOrders = new Map<string, CreditResult>();

function isValidOrderId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

const failedStatuses = new Set(["FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    orderId?: unknown;
    walletAddress?: unknown;
  } | null;

  if (!body || !isValidOrderId(body.orderId)) {
    return NextResponse.json({ error: "Укажите корректный идентификатор заказа Transak." }, { status: 400 });
  }
  if (!isValidWalletAddress(body.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }

  let order: TransakOrder;
  try {
    order = await getOrder(body.orderId);
  } catch {
    return NextResponse.json({ error: "Не удалось проверить покупку Transak. Повторите попытку." }, { status: 502 });
  }

  if (order.id !== body.orderId) {
    return NextResponse.json({ error: "Transak вернул другой идентификатор заказа." }, { status: 502 });
  }
  if (order.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "Покупка Transak привязана к другому кошельку." }, { status: 403 });
  }

  if (failedStatuses.has(order.status)) {
    return NextResponse.json({ status: "failed" });
  }
  // Transak documents COMPLETED as the point when crypto has been sent successfully.
  // PROCESSING and PENDING_DELIVERY_FROM_TRANSAK mean settlement/delivery is still underway, so keep polling without crediting early.
  if (order.status !== "COMPLETED") {
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }

  const amountUsd = order.fiatCurrency === "USD" ? order.fiatAmount : order.cryptoAmount;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ error: "Transak не вернул корректную сумму завершённой покупки." }, { status: 502 });
  }

  if (!devnetConfig.configured) {
    return NextResponse.json({ status: "completed", amountUsd });
  }

  const previousCredit = creditedOrders.get(body.orderId);
  if (previousCredit) {
    notifyReceipt(request, {
      kind: "transak",
      amountUsd: previousCredit.amountUsd,
      details: "Тестовые доллары зачислены после серверной проверки завершённого заказа Transak.",
      explorerUrl: previousCredit.explorerUrl,
      receiptId: body.orderId,
    });
    return NextResponse.json(previousCredit);
  }
  if (creditedOrderIds.has(body.orderId) || creditInFlightOrderIds.has(body.orderId)) {
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }

  creditInFlightOrderIds.add(body.orderId);
  try {
    const signature = await mintTestDollars(body.walletAddress, amountUsd);
    invalidateDevnetPortfolio(body.walletAddress);
    const result: CreditResult = {
      status: "completed",
      amountUsd,
      signature,
      explorerUrl: explorerUrl(signature),
    };
    creditedOrderIds.add(body.orderId);
    creditedOrders.set(body.orderId, result);
    notifyReceipt(request, {
      kind: "transak",
      amountUsd,
      details: "Тестовые доллары зачислены после серверной проверки завершённого заказа Transak.",
      explorerUrl: result.explorerUrl,
      receiptId: body.orderId,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Покупка подтверждена, но не удалось зачислить тестовые доллары." }, { status: 502 });
  } finally {
    creditInFlightOrderIds.delete(body.orderId);
  }
}
