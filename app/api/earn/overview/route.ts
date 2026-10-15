import { NextResponse } from "next/server";
import {
  requireKaminoLendSession,
  kaminoLendErrorResponse,
} from "@/lib/kamino-lend-api";
import { getKaminoLendDevnetPosition } from "@/lib/kamino-lend-devnet";
import { getKaminoReceipts } from "@/lib/kamino-receipts";
import { performanceFeeBps, dailyYieldEstimate } from "@/lib/earn-economics";
import { trackedPosition } from "@/lib/earn-performance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const session = await requireKaminoLendSession(request);
    const [position, receipts] = await Promise.all([
      getKaminoLendDevnetPosition(session.walletAddress),
      getKaminoReceipts(session.walletAddress),
    ]);
    const tracked = trackedPosition(
      position.collateralAmountAtomic,
      position.estimatedUnderlyingAmountAtomic,
      receipts,
    );
    const feeBps = performanceFeeBps(process.env.PLAIN_PERFORMANCE_FEE_BPS);
    return NextResponse.json(
      {
        walletAddress: session.walletAddress,
        network: "devnet",
        asOf: Date.now(),
        positionAtomic: position.estimatedUnderlyingAmountAtomic,
        collateralAtomic: position.collateralAmountAtomic,
        principalAtomic: tracked?.principalAtomic ?? null,
        protocolGainAtomic: tracked?.gainAtomic ?? null,
        supplyApy: position.supplyApy,
        dailyEstimate: dailyYieldEstimate(
          Number(position.estimatedUnderlyingAmountAtomic) / 1e6,
          position.supplyApy,
          feeBps,
        ),
        performanceFeeBps: feeBps,
        feeCollectionEnabled: false,
        source: "Kamino reserve state and finalized Plain receipts (direct and smart-wallet)",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return kaminoLendErrorResponse(cause);
  }
}
