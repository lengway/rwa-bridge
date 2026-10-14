import "server-only";

import { NextResponse } from "next/server";
import { GuardError, createIdempotencyStore, createRateLimiter } from "@/lib/markets/api-guard";
import { IssuerError } from "@/lib/markets/devnet-issuer";
import { issuerQueue as queue } from "@/lib/markets/issuer-queue";
import { EXECUTOR_OPS, type ExecutorOp } from "@/lib/markets/devnet-service";
import { marketsServer } from "@/lib/markets/server";
import type { ActionDraft, TxResult } from "@/lib/markets/service";

export const dynamic = "force-dynamic";
// Confirmation on devnet can take a while; keep the function alive for it.
export const maxDuration = 60;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const limiter = createRateLimiter({ windowMs: 60_000, perClient: 20, global: 120 });
const idempotent = createIdempotencyStore<TxResult>();

type Body = { mint?: unknown; draft?: unknown; actionId?: unknown; holder?: unknown; choice?: unknown };

function fail(message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store", ...headers } });
}

function address(value: unknown, name: string) {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new GuardError(`${name} must be a Solana address.`, 400);
  return value;
}

export async function POST(request: Request, ctx: RouteContext<"/api/markets/[op]">) {
  const { op } = await ctx.params;
  if (!EXECUTOR_OPS.includes(op as ExecutorOp)) return fail("Unknown operation.", 404);
  const server = marketsServer();
  if (!server) return fail("Plain Markets devnet writes are not configured on this server.", 501);

  const client = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const limit = limiter(client);
  if (!limit.ok) return fail("Too many requests. Try again shortly.", 429, { "retry-after": String(limit.retryAfter) });

  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[\w-]{8,100}$/.test(key)) return fail("An Idempotency-Key header (8–100 characters) is required.", 400);

  const raw = await request.text();
  if (raw.length > 4_000) return fail("Request too large.", 413);
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return fail("Invalid JSON.", 400);
  }

  try {
    const { issuer } = server;
    const task = (): Promise<TxResult> => {
      switch (op as ExecutorOp) {
        case "announce":
          return issuer.announce(address(body.mint, "mint"), body.draft as ActionDraft);
        case "vote":
          if (typeof body.choice !== "number") throw new GuardError("choice must be a number.", 400);
          return issuer.vote(address(body.actionId, "actionId"), address(body.holder, "holder"), body.choice);
        case "pay":
        case "claim":
          return issuer[op as "pay" | "claim"](address(body.actionId, "actionId"), address(body.holder, "holder"));
        default:
          return issuer[op as "lockRecord" | "postSnapshot" | "fund" | "settle"](address(body.actionId, "actionId"));
      }
    };
    const result = await idempotent(`${op}:${key}`, raw, () => queue(task));
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof GuardError || error instanceof IssuerError) return fail(error.message, error.status);
    console.error("[markets]", op, error);
    return fail("Solana devnet request failed. Try again in a moment.", 502);
  }
}
