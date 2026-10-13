import "server-only";

import { NextResponse } from "next/server";
import {
  kaminoLendErrorResponse, kaminoNoStoreHeaders, readKaminoLendJson,
  requireKaminoLendCluster, requireKaminoLendSession,
} from "@/lib/kamino-lend-api";
import { prepareSmartWalletAction } from "@/lib/kamino-smart-wallet-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readKaminoLendJson(request);
    requireKaminoLendCluster(body.cluster);
    const session = await requireKaminoLendSession(request, body.walletAddress);
    if (body.action !== "deposit" && body.action !== "withdraw") {
      return NextResponse.json({ error: "action must be deposit or withdraw.", code: "INVALID_ACTION" }, { status: 400, headers: kaminoNoStoreHeaders });
    }
    const result = await prepareSmartWalletAction({ email: session.email, walletAddress: session.walletAddress, action: body.action, amountAtomic: body.amountAtomic, requestId: body.requestId });
    return NextResponse.json(result, { headers: kaminoNoStoreHeaders });
  } catch (cause) {
    const response = kaminoLendErrorResponse(cause);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
