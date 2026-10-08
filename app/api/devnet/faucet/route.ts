import "server-only";

import { NextResponse } from "next/server";
import {
  isConfigured,
  isValidAmount,
  isValidWalletAddress,
  safeError,
  unavailableResponse,
} from "@/lib/devnet-route";
import { ensureFeeSol, explorerUrl, mintTestDollars } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";

const faucetUsage = new Map<string, { amount: number; startedAt: number }>();
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as { walletAddress?: unknown; amountUsd?: unknown; source?: unknown } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd)) {
    return NextResponse.json({ error: "Сумма должна быть от $1 до $1 000." }, { status: 400 });
  }
  const source = body.source === "bank-demo" ? "bank-demo" : "faucet";

  const now = Date.now();
  const usage = faucetUsage.get(body.walletAddress);
  const activeUsage = usage && now - usage.startedAt < DAY_MS ? usage : { amount: 0, startedAt: now };
  if (activeUsage.amount + body.amountUsd > 5000) {
    return NextResponse.json({ error: "Лимит тестового банкомата на сегодня исчерпан." }, { status: 429 });
  }
  faucetUsage.set(body.walletAddress, {
    amount: activeUsage.amount + body.amountUsd,
    startedAt: activeUsage.startedAt,
  });

  try {
    await ensureFeeSol(body.walletAddress);
    const signature = await mintTestDollars(body.walletAddress, body.amountUsd);
    invalidateDevnetPortfolio(body.walletAddress);
    const url = explorerUrl(signature);
    notifyReceipt(request, {
      kind: source,
      amountUsd: body.amountUsd,
      details: source === "bank-demo"
        ? "Тестовые доллары зачислены после подтверждения оплаты в Демо-банке."
        : "Тестовые доллары выпущены на кошелёк в Solana devnet.",
      explorerUrl: url,
      receiptId: signature,
    });
    return NextResponse.json({ signature, explorerUrl: url });
  } catch (error) {
    const latestUsage = faucetUsage.get(body.walletAddress);
    if (latestUsage) {
      faucetUsage.set(body.walletAddress, {
        amount: Math.max(0, latestUsage.amount - body.amountUsd),
        startedAt: latestUsage.startedAt,
      });
    }
    return NextResponse.json({
      error: safeError(error, "Не удалось пополнить тестовый баланс. Попробуйте ещё раз."),
    }, { status: 502 });
  }
}
