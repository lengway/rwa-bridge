import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/auth-server";
import { isValidAmount, isValidWalletAddress } from "@/lib/devnet-route";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";
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
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("moonpay");

  const body = await request.json().catch(() => null) as {
    flow?: unknown;
    walletAddress?: unknown;
    amountUsd?: unknown;
    userIp?: unknown;
  } | null;
  const flow = body?.flow;
  if (!await getVerifiedEmailFromRequest(request)) {
    return NextResponse.json({ error: "Sign in to open MoonPay." }, { status: 401 });
  }

  if (flow !== "buy" && flow !== "sell") {
    return NextResponse.json({ error: "Specify the MoonPay flow: buy or withdraw." }, { status: 400 });
  }
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  }
  if (typeof body?.userIp !== "string" || !normalizeMoonPayIp(body.userIp)) {
    return NextResponse.json({ error: "Couldn't determine the IP address for MoonPay." }, { status: 400 });
  }
  const minimum = flow === "buy" ? 5 : 20;
  if (!isValidAmount(body?.amountUsd, minimum, 1000)) {
    return NextResponse.json({
      error: flow === "buy" ? "The purchase amount must be between $5 and $1,000." : "The withdrawal amount must be between $20 and $1,000.",
    }, { status: 400 });
  }
  if (!moonpayConfig.publishableKey) {
    return NextResponse.json({
      error: "Add NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY to .env.local to enable MoonPay.",
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
    return NextResponse.json({ error: "Couldn't determine the IP address for MoonPay." }, { status: 400 });
  }
  params.set("allowedIpAddress", allowedIpAddress);
  const currency = getMoonPayCurrencyParam(flow);
  params.set(currency.name, currency.value);
  if (flow === "buy") {
    params.set("walletAddress", body.walletAddress);
    params.set("baseCurrencyCode", "usd");
    params.set("baseCurrencyAmount", String(body.amountUsd));
  } else {
    if (moonpayConfig.environment === "sandbox") {
      const solAmount = await getSandboxSellSolAmount(body.amountUsd as number);
      // If MoonPay cannot quote the USD amount, leave its amount field open for the customer in the widget.
      if (solAmount !== null) params.set("baseCurrencyAmount", String(solAmount));
    } else {
      params.set("baseCurrencyAmount", String(body.amountUsd));
    }
    params.set("quoteCurrencyCode", "usd");
    params.set("refundWalletAddress", body.walletAddress);
  }

  try {
    const url = createWidgetUrl(params, flow);
    return NextResponse.json({ url, externalTransactionId });
  } catch {
    return NextResponse.json({ error: "Couldn't sign the MoonPay link. Check the key settings." }, { status: 502 });
  }
}
