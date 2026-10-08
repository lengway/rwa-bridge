import "server-only";

import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/crossmint-jwt";
import { getEmailPreferences, setEmailPreferences } from "@/lib/devnet-ledger";

export async function GET(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Войдите в аккаунт, чтобы изменить настройки писем." }, { status: 401 });
  return NextResponse.json(await getEmailPreferences(email));
}

export async function POST(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Войдите в аккаунт, чтобы изменить настройки писем." }, { status: 401 });
  const body = await request.json().catch(() => null) as { receiptsEnabled?: unknown } | null;
  if (typeof body?.receiptsEnabled !== "boolean") {
    return NextResponse.json({ error: "Укажите, отправлять ли письма об операциях." }, { status: 400 });
  }
  return NextResponse.json(await setEmailPreferences(email, body.receiptsEnabled));
}
