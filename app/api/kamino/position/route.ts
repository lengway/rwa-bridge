import "server-only";

import { NextResponse } from "next/server";
import { kaminoLendErrorResponse, kaminoNoStoreHeaders, requireKaminoLendSession } from "@/lib/kamino-lend-api";
import { getKaminoLendDevnetPosition } from "@/lib/kamino-lend-devnet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const assertedWallet = new URL(request.url).searchParams.get("walletAddress") ?? undefined;
    const session = await requireKaminoLendSession(request, assertedWallet);
    const position = await getKaminoLendDevnetPosition(session.walletAddress);
    return NextResponse.json(position, { headers: kaminoNoStoreHeaders });
  } catch (cause) {
    return kaminoLendErrorResponse(cause);
  }
}
