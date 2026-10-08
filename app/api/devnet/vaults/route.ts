import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, safeError, unavailableResponse } from "@/lib/devnet-route";
import { getVaultQuotes } from "@/lib/vaults";

export async function GET() {
  if (!isConfigured()) return unavailableResponse();
  try {
    return NextResponse.json(await getVaultQuotes());
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось загрузить цены долей."),
    }, { status: 502 });
  }
}
