import "server-only";

import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/markets/api-guard";
import { investorOverview } from "@/lib/markets/investor-server";
import { getSessionWallet } from "@/lib/session-wallet";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ windowMs: 60_000, perClient: 30, global: 600 });

/** The signed-in investor's bond view: offerings, positions, coupon calendar, payments, votes. */
export async function GET(request: Request) {
  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Sign in to see bonds." }, { status: 401, headers: { "cache-control": "no-store" } });
  const limit = limiter(session.walletAddress);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "cache-control": "no-store", "retry-after": String(limit.retryAfter) } });
  try {
    return NextResponse.json(await investorOverview(session.walletAddress), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[bonds] overview failed", error);
    return NextResponse.json({ error: "We couldn't read bond data from Solana devnet. Try again in a moment." }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
