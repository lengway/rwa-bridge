import "server-only";

import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/auth-server";
import { getMockIdentityProfile, saveMockIdentityProfile, clearMockIdentityProfile } from "@/lib/devnet-ledger";
import { createMockIdentityProfile, MockIdentityInputError } from "@/lib/mock-identity";
import { verifySandboxWidgetSession, WidgetSessionError } from "@/lib/widget-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const response = (profile: unknown) => NextResponse.json({ mode: "MOCK", identityVerified: false, profile }, { headers });

export async function GET(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Sign in to load demo account setup." }, { status: 401, headers });
  try { return response(await getMockIdentityProfile(email)); }
  catch { return NextResponse.json({ error: "Demo account setup is temporarily unavailable." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Sign in to save demo account setup." }, { status: 401, headers });
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ error: "Expected demo account setup fields." }, { status: 400, headers });
  const allowedFields = new Set(["country", "adultAttested", "mockAcknowledged", "dataUsageAccepted", "widgetSessionToken"]);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) return NextResponse.json({ error: "Only demo selections are accepted. Do not submit documents, names, birth dates or identity-verification claims." }, { status: 400, headers });
  try {
    const partner = input.widgetSessionToken !== undefined ? verifySandboxWidgetSession(input.widgetSessionToken) : null;
    if (partner && (input.country !== partner.mockCountry || input.adultAttested !== true)) {
      return NextResponse.json({ error: "The selections do not match the signed sandbox example. This is not real KYC." }, { status: 400, headers });
    }
    const profile = createMockIdentityProfile(input, partner?.partnerId);
    return response(await saveMockIdentityProfile(email, profile));
  } catch (cause) {
    const status = cause instanceof MockIdentityInputError ? 400 : cause instanceof WidgetSessionError ? cause.status : 503;
    return NextResponse.json({ error: status === 503 ? "Demo account setup is temporarily unavailable. Try again; no identity is verified."
      : "Could not save the mock profile. Check the demo declarations and any sandbox session expiry. No identity is verified." }, { status, headers });
  }
}

export async function DELETE(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Sign in to reset demo account setup." }, { status: 401, headers });
  try { await clearMockIdentityProfile(email); return response(null); }
  catch { return NextResponse.json({ error: "Could not reset demo account setup." }, { status: 503, headers }); }
}
