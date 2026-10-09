import "server-only";

import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/auth-server";
import { notifyWelcome } from "@/lib/receipt-notifications";
import { linkEmailWallet } from "@/lib/devnet-ledger";
import { isValidWalletAddress } from "@/lib/devnet-route";

export async function POST(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Не удалось проверить сессию." }, { status: 401 });
  const body = await request.json().catch(() => null) as { walletAddress?: unknown } | null;
  if (body?.walletAddress !== undefined) {
    if (!isValidWalletAddress(body.walletAddress)) {
      return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
    }
    if (!(await linkEmailWallet(email, body.walletAddress))) {
      return NextResponse.json({ error: "К этому email уже привязан другой Solana-кошелёк." }, { status: 409 });
    }
  }
  const welcomeScheduled = await notifyWelcome(request);
  return NextResponse.json({ ok: true, welcomeScheduled });
}
