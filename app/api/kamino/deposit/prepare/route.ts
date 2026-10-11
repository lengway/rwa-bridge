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
import { getMockIdentityProfile } from "@/lib/devnet-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readKaminoLendJson(request);
    requireKaminoLendCluster(body.cluster);
    const session = await requireKaminoLendSession(request, body.walletAddress);
    if (!await getMockIdentityProfile(session.email)) {
      return NextResponse.json({ error: "Complete demo account setup before adding new funds. This is mock onboarding, not verified KYC.", code: "MOCK_ONBOARDING_REQUIRED" },
        { status: 409, headers: kaminoNoStoreHeaders });
    }
    const prepared = await prepareKaminoLendDevnetAction({
      action: "deposit",
      walletAddress: session.walletAddress,
      amountAtomic: body.amountAtomic,
    });
    return NextResponse.json(prepared, { headers: kaminoNoStoreHeaders });
  } catch (cause) {
    return kaminoLendErrorResponse(cause);
  }
}
