import "server-only";

import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/auth-server";
import { notifyWelcome } from "@/lib/receipt-notifications";

export async function POST(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Не удалось проверить сессию." }, { status: 401 });
  const welcomeScheduled = await notifyWelcome(request);
  return NextResponse.json({ ok: true, welcomeScheduled });
}
