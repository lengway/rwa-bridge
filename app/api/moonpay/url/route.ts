import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isValidAmount, isValidWalletAddress } from "@/lib/devnet-route";
import {
  createWidgetUrl,
  getAllowedIpAddressHash,
  getMoonPayCurrencyParam,
  getSandboxSellSolAmount,
  MOONPAY_MISSING_SECRET_MESSAGE,
  moonpayConfig,
  normalizeMoonPayIp,
} from "@/lib/moonpay";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    flow?: unknown;
    walletAddress?: unknown;
    amountUsd?: unknown;
    userIp?: unknown;
  } | null;
  const flow = body?.flow;

  if (flow !== "sell") {
    return NextResponse.json({ error: "Укажите сценарий вывода MoonPay." }, { status: 400 });
  }
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (typeof body?.userIp !== "string" || !normalizeMoonPayIp(body.userIp)) {
    return NextResponse.json({ error: "Не удалось определить IP-адрес MoonPay." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd, 20, 1000)) {
    return NextResponse.json({ error: "Сумма вывода должна быть от $20 до $1 000." }, { status: 400 });
  }
  if (!moonpayConfig.publishableKey) {
    return NextResponse.json({
      error: "Добавьте NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY в .env.local для подключения MoonPay.",
    }, { status: 501 });
  }
  if (!moonpayConfig.canSign) {
    return NextResponse.json({ error: MOONPAY_MISSING_SECRET_MESSAGE }, { status: 501 });
  }

  const externalTransactionId = randomUUID();
  const params = new URLSearchParams({
    apiKey: moonpayConfig.publishableKey,
    externalTransactionId,
    theme: "light",
  });

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const serverIp = forwardedIp || request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "";
  const allowedIpAddress = getAllowedIpAddressHash([body.userIp, serverIp]);
  if (!allowedIpAddress) {
    return NextResponse.json({ error: "Не удалось определить IP-адрес MoonPay." }, { status: 400 });
  }
  params.set("allowedIpAddress", allowedIpAddress);
  const currency = getMoonPayCurrencyParam();
  params.set(currency.name, currency.value);
  if (moonpayConfig.environment === "sandbox") {
    const solAmount = await getSandboxSellSolAmount(body.amountUsd as number);
    // If MoonPay cannot quote the USD amount, leave its amount field open for the customer in the widget.
    if (solAmount !== null) params.set("baseCurrencyAmount", String(solAmount));
  } else {
    params.set("baseCurrencyAmount", String(body.amountUsd));
  }
  params.set("quoteCurrencyCode", "usd");
  params.set("refundWalletAddress", body.walletAddress);

  try {
    const url = createWidgetUrl(params);
    return NextResponse.json({ url, externalTransactionId });
  } catch {
    return NextResponse.json({ error: "Не удалось подписать ссылку MoonPay. Проверьте настройки ключей." }, { status: 502 });
  }
}
