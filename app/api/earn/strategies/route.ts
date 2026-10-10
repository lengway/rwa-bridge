import "server-only";

import { NextResponse } from "next/server";
import { EARN_STRATEGIES, toPublicEarnStrategy } from "@/lib/earn-gateway";

/**
 * Public, read-only catalog metadata. Execution still goes through the
 * session-bound Devnet routes; this endpoint never accepts an amount, wallet,
 * provider selection, or client-supplied status.
 */
export async function GET() {
  return NextResponse.json({
    network: "devnet",
    strategies: EARN_STRATEGIES
      .filter((strategy) => strategy.availability === "ENABLED")
      .map(toPublicEarnStrategy),
    disclosures: {
      funding: "USER-SIGNED ON-CHAIN",
      yield: "VARIABLE PROTOCOL RATE",
      value: "NO MONETARY VALUE",
    },
  });
}
