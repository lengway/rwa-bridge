import "server-only";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isIP } from "node:net";
import { KaminoActionStore } from "@/lib/kamino-action-store";
import { getSessionWallet } from "@/lib/session-wallet";
import { getMockIdentityProfile } from "@/lib/devnet-ledger";
import {
  sandboxFundingAvailable,
  providerCheckoutStatus,
  isSandboxWidgetUrl,
  type FundingProvider,
} from "@/lib/funding-contract";
import { createWidgetUrl as transakWidget, getOrder } from "@/lib/transak";
import {
  createWidgetUrl as moonpayWidget,
  getAllowedIpAddressHash,
  getTransactionByExternalId,
} from "@/lib/moonpay";

type Checkout = {
  id: string;
  walletAddress: string;
  action: FundingProvider;
  status: string;
  createdAt: number;
  expiresAt: number;
  providerOrderId?: string;
};
const store = new KaminoActionStore<Checkout>(
  `${process.env.DEMO_LEDGER_PATH || path.join(process.cwd(), ".demo-ledger.json")}.funding`,
);

export class FundingError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fundingSession(request: Request) {
  const session = await getSessionWallet(request);
  if (!session)
    throw new FundingError(401, "Sign in and connect your wallet first.");
  return session;
}

export async function createSandboxCheckout(
  request: Request,
  body: Record<string, unknown>,
) {
  const session = await fundingSession(request);
  if (!(await getMockIdentityProfile(session.email)))
    throw new FundingError(409, "Complete demo account setup first.");
  const provider = body.provider;
  if (provider !== "transak" && provider !== "moonpay")
    throw new FundingError(400, "Choose a supported sandbox provider.");
  if (!sandboxFundingAvailable(provider, process.env))
    throw new FundingError(
      503,
      "This sandbox provider is not enabled in this environment.",
    );
  const minimum = provider === "transak" ? 30 : 5;
  if (
    typeof body.amountUsd !== "number" ||
    !Number.isFinite(body.amountUsd) ||
    body.amountUsd < minimum ||
    body.amountUsd > 1000
  )
    throw new FundingError(400, `Enter an amount from $${minimum} to $1,000.`);
  const requestUrl = new URL(request.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    requestUrl.hostname,
  );
  const forwarded =
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip");
  // The deployed reverse proxy must replace forwarded headers. Client IP hints
  // are accepted only on loopback for sandbox development, never remotely.
  const userIp =
    forwarded || (local && typeof body.userIp === "string" ? body.userIp : "");
  if (!isIP(userIp))
    throw new FundingError(
      400,
      "Could not determine the IP address for a sandbox checkout.",
    );
  const id = randomUUID();
  let url: string;
  if (provider === "transak") {
    url = await transakWidget({
      walletAddress: session.walletAddress,
      fiatAmount: body.amountUsd,
      fiatCurrency: "USD",
      userIp,
      referrerDomain: requestUrl.hostname,
    });
  } else {
    const allowedIpAddress = getAllowedIpAddressHash([userIp]);
    if (!allowedIpAddress)
      throw new FundingError(503, "MoonPay sandbox signing is unavailable.");
    url = moonpayWidget(
      new URLSearchParams({
        apiKey: process.env.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY!.trim(),
        externalTransactionId: id,
        walletAddress: session.walletAddress,
        currencyCode: "sol",
        baseCurrencyCode: "usd",
        baseCurrencyAmount: String(body.amountUsd),
        allowedIpAddress,
        theme: "light",
      }),
      "buy",
    );
  }
  if (!isSandboxWidgetUrl(provider, url))
    throw new FundingError(
      502,
      "The provider returned an unexpected checkout destination.",
    );
  const createdAt = Date.now();
  await store.put({
    id,
    walletAddress: session.walletAddress,
    action: provider,
    status: "PENDING",
    createdAt,
    expiresAt: createdAt + 24 * 60 * 60 * 1000,
    ...(provider === "moonpay" ? { providerOrderId: id } : {}),
  });
  return {
    id,
    provider,
    url,
    mode: "SANDBOX",
    walletAddress: session.walletAddress,
    deliversDevnetUsdc: false,
    disclosure:
      "Test checkout only. No real card payment or automatic USDC credit to Solana Devnet.",
  };
}

export async function checkSandboxCheckout(
  request: Request,
  body: Record<string, unknown>,
) {
  const session = await fundingSession(request);
  if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))
    throw new FundingError(400, "Invalid checkout identifier.");
  return store.withLock(body.id, async () => {
    const checkout = await store.get(body.id as string);
    if (!checkout || checkout.walletAddress !== session.walletAddress)
      throw new FundingError(404, "Checkout not found for this wallet.");
    if (!sandboxFundingAvailable(checkout.action, process.env))
      throw new FundingError(503, "Sandbox provider is unavailable.");
    if (checkout.status === "PENDING") {
      if (checkout.expiresAt <= Date.now())
        throw new FundingError(
          409,
          "Checkout tracking expired. Check its outcome with the provider before retrying.",
        );
      let providerStatus: string;
      if (checkout.action === "transak") {
        const orderId = checkout.providerOrderId ?? body.providerOrderId;
        if (
          typeof orderId !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(orderId)
        )
          throw new FundingError(
            400,
            "Enter the Transak order ID to check its status.",
          );
        const order = await getOrder(orderId);
        if (
          order.id !== orderId ||
          order.walletAddress !== session.walletAddress ||
          order.cryptoCurrency.toUpperCase() !== "USDC" ||
          order.network.toLowerCase() !== "solana"
        ) {
          throw new FundingError(
            403,
            "The provider order does not match this wallet and route.",
          );
        }
        checkout.providerOrderId = orderId;
        providerStatus = order.status;
      } else {
        const order = await getTransactionByExternalId(
          checkout.providerOrderId!,
          "buy",
        );
        if (!order)
          return { id: checkout.id, status: "PENDING", walletCredited: false };
        if (order.walletAddress !== session.walletAddress)
          throw new FundingError(
            403,
            "The provider order belongs to another wallet.",
          );
        providerStatus =
          typeof order.status === "string" ? order.status : "pending";
      }
      checkout.status = providerCheckoutStatus(providerStatus);
      await store.put(checkout);
    }
    // Never mint TEST QUOTE or claim provider success as a wallet balance.
    return {
      id: checkout.id,
      provider: checkout.action,
      status: checkout.status,
      walletCredited: false,
      mode: "SANDBOX",
      settlement: "SEPARATE_DEVNET_FUNDING_REQUIRED",
    };
  });
}
