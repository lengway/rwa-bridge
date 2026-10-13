import "server-only";

import { NextResponse } from "next/server";
import { KaseError, readView, runCommand, type KaseCommand } from "@/lib/kase/devnet";

export const dynamic = "force-dynamic";

const COMMANDS: KaseCommand[] = ["issue", "record", "coupon", "buyback", "redeem"];
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();

function rateLimited(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

function errorResponse(error: unknown) {
  if (error instanceof KaseError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[kase]", error);
  return NextResponse.json({ error: "Solana devnet request failed. Try again in a moment." }, { status: 502 });
}

function json(value: unknown) {
  return new NextResponse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET() {
  try {
    return json(await readView());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (rateLimited(request)) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const body = (await request.json().catch(() => null)) as { command?: unknown } | null;
  const command = body?.command;
  if (typeof command !== "string" || !COMMANDS.includes(command as KaseCommand)) {
    return NextResponse.json({ error: "Unknown command" }, { status: 400 });
  }
  try {
    await runCommand(command as KaseCommand);
    return json(await readView());
  } catch (error) {
    return errorResponse(error);
  }
}
