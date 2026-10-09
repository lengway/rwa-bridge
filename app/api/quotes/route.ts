import { NextRequest } from "next/server";
import { readProviderQuote } from "@/lib/quotes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const provider = searchParams.get("provider");
  const side = searchParams.get("side");
  const amount = Number(searchParams.get("amount"));
  if ((provider !== "transak" && provider !== "moonpay")
    || (provider === "transak" && side !== "buy")
    || (provider === "moonpay" && side !== "sell")) {
    return Response.json(
      { error: "Некорректный способ или направление операции." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const minimum = provider === "transak" ? 30 : 20;
  if (!Number.isFinite(amount) || amount < minimum || amount > 1_000) {
    return Response.json(
      { error: "Сумма вне диапазона котировки провайдера." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const quoteSide = provider === "transak" ? "buy" : "sell";
    const quote = await readProviderQuote(provider, quoteSide, amount);
    return Response.json(quote, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Не удалось получить котировку." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
