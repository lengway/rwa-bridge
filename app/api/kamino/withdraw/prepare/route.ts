import "server-only";

import { NextResponse } from "next/server";
import {
  kaminoLendErrorResponse,
  kaminoNoStoreHeaders,
  readKaminoLendJson,
  requireKaminoLendCluster,
  requireKaminoLendSession,
} from "@/lib/kamino-lend-api";
import { prepareKaminoLendDevnetAction } from "@/lib/kamino-lend-devnet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readKaminoLendJson(request);
    requireKaminoLendCluster(body.cluster);
    const session = await requireKaminoLendSession(request, body.walletAddress);
    const prepared = await prepareKaminoLendDevnetAction({
      action: "withdraw",
      walletAddress: session.walletAddress,
      amountAtomic: body.amountAtomic,
    });
    return NextResponse.json(prepared, { headers: kaminoNoStoreHeaders });
  } catch (cause) {
    return kaminoLendErrorResponse(cause);
  }
}
