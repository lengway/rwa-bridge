import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { clearAuthCodeChallenge, reserveAuthCodeRequest } from "@/lib/devnet-ledger";
import { emailLedgerKey, hashEmailCode, ipLedgerKey, isValidEmail, normalizeEmail } from "@/lib/auth-server";
import { isMailerConfigured, sendLoginCode } from "@/lib/mailer";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  if (typeof body?.email !== "string" || !isValidEmail(body.email)) {
    return NextResponse.json({ error: "Введите корректный email." }, { status: 400 });
  }
  if (!isMailerConfigured()) {
    return NextResponse.json({ error: "Отправка писем временно недоступна. Попробуйте позже." }, { status: 503 });
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
      ? "Новый код можно запросить через минуту."
      : reservation.reason === "email-limit"
        ? "Для этого email запрошено слишком много кодов. Попробуйте позже."
        : "С этого устройства запрошено слишком много кодов. Попробуйте позже.";
    return NextResponse.json(
      { error: message, retryAfterSeconds: reservation.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(reservation.retryAfterSeconds) } },
    );
  }

  try {
    await sendLoginCode(email, code);
  } catch {
    await clearAuthCodeChallenge(emailKey, createdAt).catch(() => undefined);
    return NextResponse.json({ error: "Не удалось отправить письмо с кодом. Проверьте адрес и попробуйте позже." }, { status: 503 });
  }

  return NextResponse.json({ ok: true, resendAfterSeconds: 60 });
}
