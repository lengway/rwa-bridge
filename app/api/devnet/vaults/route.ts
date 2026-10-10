import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, safeError, unavailableResponse } from "@/lib/devnet-route";
import { getVaultQuotes } from "@/lib/vaults";
import { YIELD_STRATEGIES } from "@/lib/yields";

export async function GET() {
  if (!isConfigured()) return unavailableResponse();
  try {
    const publicIds = new Set(YIELD_STRATEGIES.map((strategy) => strategy.id));
    return NextResponse.json((await getVaultQuotes()).filter((quote) => publicIds.has(quote.productId)));
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось загрузить данные Devnet-демо."),
    }, { status: 502 });
  }
}
