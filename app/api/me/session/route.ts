import "server-only";

import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/crossmint-jwt";
import { notifyWelcome } from "@/lib/receipt-notifications";

export async function POST(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Не удалось проверить вход Crossmint." }, { status: 401 });
  const welcomeScheduled = await notifyWelcome(request);
  return NextResponse.json({ ok: true, welcomeScheduled });
}
