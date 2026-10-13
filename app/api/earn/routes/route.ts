import "server-only";

import { NextResponse } from "next/server";
import { quoteYieldRoutes } from "@/lib/yield-routes";

/**
 * Read-only mainnet USDC routes with live APY from public sources.
 * Not executable in Plain yet; apyPercent is null when a source is unreachable.
 */
export async function GET() {
  const routes = await quoteYieldRoutes();
  return NextResponse.json(
    { routes },
    { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
  );
}
