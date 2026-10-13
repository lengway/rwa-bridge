import "server-only";

import { NextResponse } from "next/server";
import {
  kaminoLendErrorResponse, kaminoNoStoreHeaders, readKaminoLendJson,
  requireKaminoLendCluster, requireKaminoLendSession,
} from "@/lib/kamino-lend-api";
import { getSmartWalletStatus } from "@/lib/kamino-smart-wallet-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readKaminoLendJson(request);
    requireKaminoLendCluster(body.cluster);
    const session = await requireKaminoLendSession(request, body.walletAddress);
    const result = await getSmartWalletStatus({ email: session.email, walletAddress: session.walletAddress, actionId: body.actionId });
    return NextResponse.json(result, { headers: kaminoNoStoreHeaders });
  } catch (cause) {
    const response = kaminoLendErrorResponse(cause);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
