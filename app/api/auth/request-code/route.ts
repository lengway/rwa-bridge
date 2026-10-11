import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { clearAuthCodeChallenge, reserveAuthCodeRequest } from "@/lib/devnet-ledger";
import { emailLedgerKey, hashEmailCode, ipLedgerKey, isValidEmail, normalizeEmail } from "@/lib/auth-server";
import { isMailerConfigured, sendLoginCode } from "@/lib/mailer";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  if (typeof body?.email !== "string" || !isValidEmail(body.email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!isMailerConfigured()) {
    return NextResponse.json({ error: "Email delivery is temporarily unavailable. Try again later." }, { status: 503 });
  }

  const email = normalizeEmail(body.email);
  const emailKey = emailLedgerKey(email);
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const clientIp = forwardedIp || request.headers.get("x-real-ip")?.trim() || "unknown";
  const code = String(randomInt(100_000, 1_000_000));
  const createdAt = Date.now();
  const reservation = await reserveAuthCodeRequest(emailKey, ipLedgerKey(clientIp), {
    codeHash: hashEmailCode(email, code),
    createdAt,
    expiresAt: createdAt + 10 * 60 * 1_000,
    attempts: 0,
  }, createdAt);

  if (!reservation.ok) {
    const message = reservation.reason === "cooldown"
      ? "You can request a new code in one minute."
      : reservation.reason === "email-limit"
        ? "Too many codes have been requested for this email. Try again later."
        : "Too many codes have been requested from this device. Try again later.";
    return NextResponse.json(
      { error: message, retryAfterSeconds: reservation.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(reservation.retryAfterSeconds) } },
    );
  }

  try {
    await sendLoginCode(email, code);
  } catch {
    await clearAuthCodeChallenge(emailKey, createdAt).catch(() => undefined);
    return NextResponse.json({ error: "Could not send the email with your code. Check the address and try again later." }, { status: 503 });
  }

  return NextResponse.json({ ok: true, resendAfterSeconds: 60 });
}
