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
  if (!session) return NextResponse.json({ error: "Войдите в аккаунт, чтобы зачислить KZTE на свой кошелёк." }, { status: 401 });
  const body = await request.json().catch(() => null) as { amountKzt?: unknown } | null;
  const amountKzt = body?.amountKzt;
  if (typeof amountKzt !== "number" || !Number.isInteger(amountKzt)
    || amountKzt < 5_000 || amountKzt > DAILY_KZTE_CAP) {
    return NextResponse.json({ error: "Сумма должна быть целым числом от 5 000 до 1 000 000 ₸." }, { status: 400 });
  }

  return withLedgerKeyLock(`kzte-topup:${session.walletAddress}`, async () => {
    const since = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const usedToday = await getKzteTopupsSince(session.walletAddress, since);
    if (usedToday + amountKzt > DAILY_KZTE_CAP) {
      return NextResponse.json({ error: "Достигнут дневной лимит пополнения KZTE: 1 000 000 ₸ на кошелёк." }, { status: 429 });
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
        details: `Перевод из резерва Intebix: ${amountKzt.toLocaleString("ru-RU")} KZTE. Операция проведена в Solana devnet.`,
        explorerUrl: url,
        receiptId: signature,
      });
      return NextResponse.json({ signature, explorerUrl: url, amountKzt, amountUsd: amountKzt / rate.usdKzt });
    } catch (error) {
      return NextResponse.json({ error: safeError(error, "Не удалось перевести KZTE из резерва Intebix.") }, { status: 502 });
    }
  });
}
