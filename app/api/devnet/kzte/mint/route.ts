import "server-only";

import { NextResponse } from "next/server";
import { appendKzteOperation, getKzteTopupsSince, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { isConfigured, safeError, unavailableResponse } from "@/lib/devnet-route";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";
import { getKztRateForOperation } from "@/lib/market-server";
import { getSessionWallet } from "@/lib/session-wallet";
import { explorerUrl, sendKzteFromTreasury } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";

const DAILY_KZTE_CAP = 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export async function POST(request: Request) {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("kzte");

  if (!isConfigured()) return unavailableResponse();
  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Sign in to receive KZTE in your wallet." }, { status: 401 });
  const body = await request.json().catch(() => null) as { amountKzt?: unknown } | null;
  const amountKzt = body?.amountKzt;
  if (typeof amountKzt !== "number" || !Number.isInteger(amountKzt)
    || amountKzt < 5_000 || amountKzt > DAILY_KZTE_CAP) {
    return NextResponse.json({ error: "The amount must be a whole number from 5,000 to 1,000,000 ₸." }, { status: 400 });
  }

  return withLedgerKeyLock(`kzte-topup:${session.walletAddress}`, async () => {
    const since = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const usedToday = await getKzteTopupsSince(session.walletAddress, since);
    if (usedToday + amountKzt > DAILY_KZTE_CAP) {
      return NextResponse.json({ error: "Daily KZTE top-up limit reached: 1,000,000 ₸ per wallet." }, { status: 429 });
    }

    try {
      const rate = await getKztRateForOperation();
      const signature = await sendKzteFromTreasury(session.walletAddress, amountKzt);
      await appendKzteOperation(session.walletAddress, {
        kind: "topup",
        targetSignature: signature,
        amountKzt,
        amountUsd: amountKzt / rate.usdKzt,
        at: Date.now(),
      });
      invalidateDevnetPortfolio(session.walletAddress);
      const url = explorerUrl(signature);
      notifyReceipt(request, {
        kind: "kzte-topup",
        amountUsd: amountKzt / rate.usdKzt,
        details: `Transfer from the Intebix reserve: ${amountKzt.toLocaleString("en-US")} KZTE. Processed on Solana devnet.`,
        explorerUrl: url,
        receiptId: signature,
      });
      return NextResponse.json({ signature, explorerUrl: url, amountKzt, amountUsd: amountKzt / rate.usdKzt });
    } catch (error) {
      return NextResponse.json({ error: safeError(error, "Couldn't transfer KZTE from the Intebix reserve.") }, { status: 502 });
    }
  });
}
