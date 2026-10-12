import { NextResponse } from "next/server";
import { fundingMethods } from "@/lib/funding-contract";
import {
  DEFAULT_PERFORMANCE_FEE_BPS,
  performanceFeeBps,
} from "@/lib/earn-economics";
export const dynamic = "force-dynamic";
export async function GET() {
  let feeBps: number;
  try {
    feeBps = performanceFeeBps(process.env.PLAIN_PERFORMANCE_FEE_BPS);
  } catch {
    return NextResponse.json(
      { error: "Product policy is unavailable." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      network: "devnet",
      methods: fundingMethods(process.env),
      policy: {
        performanceFeeBps: feeBps ?? DEFAULT_PERFORMANCE_FEE_BPS,
        collectionEnabled: false,
        gas: "PROJECT_SPONSORED_TARGET",
        gasVerified: false,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
