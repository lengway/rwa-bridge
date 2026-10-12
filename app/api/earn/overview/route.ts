import { NextResponse } from "next/server";
import {
  requireKaminoLendSession,
  kaminoLendErrorResponse,
} from "@/lib/kamino-lend-api";
import {
  getKaminoLendDevnetPosition,
  getKaminoLendDevnetHistory,
} from "@/lib/kamino-lend-devnet";
import { performanceFeeBps, dailyYieldEstimate } from "@/lib/earn-economics";
import { trackedProtocolGain } from "@/lib/earn-performance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await requireKaminoLendSession(request);
    const [position, receipts] = await Promise.all([
      getKaminoLendDevnetPosition(session.walletAddress),
      getKaminoLendDevnetHistory(session.walletAddress),
    ]);
    const feeBps = performanceFeeBps(process.env.PLAIN_PERFORMANCE_FEE_BPS);
    return NextResponse.json(
      {
        walletAddress: session.walletAddress,
        network: "devnet",
        asOf: Date.now(),
        positionAtomic: position.estimatedUnderlyingAmountAtomic,
        protocolGainAtomic: trackedProtocolGain(
          position.collateralAmountAtomic,
          position.estimatedUnderlyingAmountAtomic,
          receipts,
        ),
        supplyApy: position.supplyApy,
        dailyEstimate: dailyYieldEstimate(
          Number(position.estimatedUnderlyingAmountAtomic) / 1e6,
          position.supplyApy,
          feeBps,
        ),
        performanceFeeBps: feeBps,
        feeCollectionEnabled: false,
        source: "Kamino reserve state and finalized Plain receipts",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return kaminoLendErrorResponse(cause);
  }
}
