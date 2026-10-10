import "server-only";

import { NextResponse } from "next/server";
import {
  kaminoLendErrorResponse,
  kaminoNoStoreHeaders,
  readKaminoLendJson,
  requireKaminoLendCluster,
  requireKaminoLendSession,
} from "@/lib/kamino-lend-api";
import { confirmKaminoLendDevnetAction } from "@/lib/kamino-lend-devnet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readKaminoLendJson(request);
    requireKaminoLendCluster(body.cluster);
    const session = await requireKaminoLendSession(request, body.walletAddress);
    const confirmation = await confirmKaminoLendDevnetAction({
      action: "withdraw",
      actionId: body.actionId,
      walletAddress: session.walletAddress,
      signature: body.signature,
    });
    return NextResponse.json(confirmation, {
      status: confirmation.confirmed ? 200 : 202,
      headers: kaminoNoStoreHeaders,
    });
  } catch (cause) {
    return kaminoLendErrorResponse(cause);
  }
}
