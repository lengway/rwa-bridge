import "server-only";

import { NextResponse } from "next/server";
import { verifySandboxWidgetSession, WidgetSessionError } from "@/lib/widget-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.parentOrigin !== "string") throw new WidgetSessionError(400, "Expected sandbox session and parent origin.");
    return NextResponse.json(verifySandboxWidgetSession(body.sessionToken, body.parentOrigin), { headers });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof WidgetSessionError ? cause.message : "Sandbox session could not be validated.", mode: "SANDBOX", identityVerified: false },
      { status: cause instanceof WidgetSessionError ? cause.status : 503, headers });
  }
}
