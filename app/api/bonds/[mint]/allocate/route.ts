import "server-only";

import { NextResponse } from "next/server";
import { GuardError } from "@/lib/markets/api-guard";
import { createAllocationHandler } from "@/lib/markets/allocation-route";
import { IssuerError } from "@/lib/markets/devnet-issuer";
import { allocationLimits, isListedInstrument } from "@/lib/markets/investor-server";
import { issuerQueue } from "@/lib/markets/issuer-queue";
import { marketsServer } from "@/lib/markets/server";
import { getSessionWallet } from "@/lib/session-wallet";

export const dynamic = "force-dynamic";
// Confirmation on devnet can take a while; keep the function alive for it.
export const maxDuration = 60;

const handle = createAllocationHandler({
  sessionWallet: getSessionWallet,
  writable: () => marketsServer() != null,
  isListed: isListedInstrument,
  allocate: (mint, wallet, units) => {
    const server = marketsServer();
    if (!server) throw new GuardError("Bond allocations are not available right now.", 503);
    return server.issuer.allocate(mint, wallet, units, allocationLimits());
  },
  queue: issuerQueue,
  knownError: (error) => (error instanceof IssuerError ? { message: error.message, status: error.status } : null),
});

/** Devnet test allocation: the issuer issues bond units to the signed-in user's smart wallet. */
export async function POST(request: Request, ctx: RouteContext<"/api/bonds/[mint]/allocate">) {
  const { mint } = await ctx.params;
  const { status, body, headers } = await handle(request, mint);
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}
