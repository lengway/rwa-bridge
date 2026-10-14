import "server-only";

import { NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/markets/api-guard";
import { investorBond } from "@/lib/markets/investor-server";
import { getSessionWallet } from "@/lib/session-wallet";

export const dynamic = "force-dynamic";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const limiter = createRateLimiter({ windowMs: 60_000, perClient: 30, global: 600 });

/** One bond for the signed-in investor: terms, position, corporate actions and their status. */
export async function GET(request: Request, ctx: RouteContext<"/api/bonds/[mint]">) {
  const { mint } = await ctx.params;
  const headers = { "cache-control": "no-store" };
  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Sign in to see bonds." }, { status: 401, headers });
  if (!ADDRESS.test(mint)) return NextResponse.json({ error: "Unknown bond." }, { status: 404, headers });
  const limit = limiter(session.walletAddress);
  if (!limit.ok) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { ...headers, "retry-after": String(limit.retryAfter) } });
  try {
    const detail = await investorBond(session.walletAddress, mint);
    if (!detail) return NextResponse.json({ error: "Unknown bond." }, { status: 404, headers });
    return NextResponse.json(detail, { headers });
  } catch (error) {
    console.error("[bonds] detail failed", error);
    return NextResponse.json({ error: "We couldn't read this bond from Solana devnet. Try again in a moment." }, { status: 502, headers });
  }
}
