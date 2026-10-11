import { NextResponse } from "next/server";
import { verifyAuthCode } from "@/lib/devnet-ledger";
import {
  AUTH_SESSION_COOKIE,
  createSessionCookie,
  emailLedgerKey,
  hashEmailCode,
  isValidEmail,
  normalizeEmail,
  sessionCookieMaxAge,
} from "@/lib/auth-server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown; code?: unknown } | null;
  if (typeof body?.email !== "string" || !isValidEmail(body.email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.replace(/\s/g, "") : "";
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the six-digit code from your email." }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const result = await verifyAuthCode(emailLedgerKey(email), hashEmailCode(email, code));
  if (result !== "verified") {
    const error = result === "expired"
      ? "This code has expired. Request a new code."
      : result === "locked"
        ? "Too many attempts. Request a new code."
        : result === "missing"
          ? "Code not found or already used. Request a new code."
          : "Incorrect code. Check your email and try again.";
    return NextResponse.json({ error }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_SESSION_COOKIE,
    value: createSessionCookie(email),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionCookieMaxAge,
  });
  return response;
}
