import "server-only";

import { NextResponse } from "next/server";
import { issueSandboxWidgetSession, WidgetSessionError } from "@/lib/widget-session";
import { widgetAllowedOrigins } from "@/lib/widget-origins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  try {
    return origin && widgetAllowedOrigins().includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } : {};
  } catch { return {}; }
}
export async function OPTIONS(request: Request) {
  try {
    if (!request.headers.get("origin") || !widgetAllowedOrigins().includes(request.headers.get("origin")!)) return new NextResponse(null, { status: 403 });
    return new NextResponse(null, { status: 204, headers: cors(request) });
  } catch { return new NextResponse(null, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && !widgetAllowedOrigins().includes(origin)) throw new WidgetSessionError(403, "Embedding origin is not registered.");
    const input = await request.json().catch(() => null);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new WidgetSessionError(400, "Expected sandbox widget configuration.");
    if (Object.keys(input).some((field) => !["partnerId", "parentOrigin"].includes(field))) throw new WidgetSessionError(400, "Sandbox bootstrap accepts no real customer or verification data.");
    if (origin && input.parentOrigin !== origin) throw new WidgetSessionError(403, "Embedding origin does not match this request.");
    return NextResponse.json(issueSandboxWidgetSession(input.partnerId, input.parentOrigin), { headers: { ...cors(request), "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof WidgetSessionError ? cause.message : "Sandbox widget is temporarily unavailable.", mode: "SANDBOX", identityVerified: false },
      { status: cause instanceof WidgetSessionError ? cause.status : 503, headers: { ...cors(request), "Cache-Control": "no-store" } });
  }
}
