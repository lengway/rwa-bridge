import { NextRequest } from "next/server";
import { readProviderQuote } from "@/lib/quotes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const provider = searchParams.get("provider");
  const side = searchParams.get("side");
  const amount = Number(searchParams.get("amount"));
  if ((provider !== "transak" && provider !== "moonpay") || (side !== "buy" && side !== "sell")
    || (provider === "transak" && side !== "buy")) {
    return Response.json(
      { error: "Invalid method or operation direction." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const minimum = provider === "transak" ? 30 : side === "buy" ? 5 : 20;
  if (!Number.isFinite(amount) || amount < minimum || amount > 1_000) {
    return Response.json(
      { error: "The amount is outside the provider's quote range." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const quote = await readProviderQuote(provider, side, amount);
    return Response.json(quote, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Couldn't get a quote." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
