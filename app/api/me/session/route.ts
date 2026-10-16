import "server-only";

import { NextResponse } from "next/server";
import { getVerifiedEmailFromRequest } from "@/lib/auth-server";
import { notifyWelcome } from "@/lib/receipt-notifications";
import { linkEmailWallet } from "@/lib/devnet-ledger";
import { rememberInvestorContact } from "@/lib/markets/notify-server";
import { isValidWalletAddress } from "@/lib/devnet-route";

export async function POST(request: Request) {
  const email = await getVerifiedEmailFromRequest(request);
  if (!email) return NextResponse.json({ error: "Could not verify the session." }, { status: 401 });
  const body = await request.json().catch(() => null) as { walletAddress?: unknown } | null;
  if (body?.walletAddress !== undefined) {
    if (!isValidWalletAddress(body.walletAddress)) {
      return NextResponse.json({ error: "Enter a valid Solana wallet address." }, { status: 400 });
    }
    if (!(await linkEmailWallet(email, body.walletAddress))) {
      return NextResponse.json({ error: "A different Solana wallet is already linked to this email." }, { status: 409 });
    }
    await rememberInvestorContact(email, body.walletAddress);
  }
  const welcomeScheduled = await notifyWelcome(request);
  return NextResponse.json({ ok: true, welcomeScheduled });
}
