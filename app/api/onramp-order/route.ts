import { NextResponse } from "next/server";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";

// Circle devnet USDC, as listed in Crossmint's onramp quickstart.
const USDC_DEVNET_LOCATOR = "solana:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/**
 * Creates a Crossmint onramp order: card -> USDC delivered to the user's own wallet.
 * Docs: https://docs.crossmint.com/onramp/quickstarts/react
 * Staging keys only reach devnet; production needs a signed order form + KYB with Crossmint.
 */
export async function POST(request: Request) {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("crossmint-onramp");

  const serverApiKey = process.env.CROSSMINT_SERVER_API_KEY;
  if (!serverApiKey) {
    return NextResponse.json({ error: "add CROSSMINT_SERVER_API_KEY to .env.local" }, { status: 501 });
  }
  if (!serverApiKey.startsWith("sk_staging_")) {
    return NextResponse.json({ error: "Only a staging key is allowed for Crossmint." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const walletAddress: string | undefined = body?.walletAddress;
  const email: string | undefined = body?.email;
  const amount = Number(body?.amount);
  if (!walletAddress || !email || !Number.isFinite(amount) || amount <= 0 || amount > 1000) {
    return NextResponse.json({ error: "walletAddress, email and an amount from 1 to 1000 are required" }, { status: 400 });
  }

  const res = await fetch("https://staging.crossmint.com/api/2022-06-09/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": serverApiKey },
    body: JSON.stringify({
      lineItems: [
        {
          tokenLocator: USDC_DEVNET_LOCATOR,
          executionParameters: { mode: "exact-in", amount: String(amount) },
        },
      ],
      payment: { method: "card", receiptEmail: email },
      recipient: { walletAddress },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: data?.message ?? "Crossmint did not create the order" }, { status: 502 });
  }
  return NextResponse.json({ orderId: data?.order?.orderId, clientSecret: data?.clientSecret });
}
