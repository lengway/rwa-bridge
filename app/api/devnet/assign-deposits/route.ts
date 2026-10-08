import "server-only";

import { NextResponse } from "next/server";
import { appendDeposits, getLedgerWallet, hasLedgerSignature, type LedgerDeposit } from "@/lib/devnet-ledger";
import { isConfigured, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import { YIELD_STRATEGIES } from "@/lib/yields";
import { getUnassignedIncomingPayments, verifyIncomingPayment } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    productId?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (typeof body?.productId !== "string" || !YIELD_STRATEGIES.some((item) => item.id === body.productId)) {
    return NextResponse.json({ error: "Неизвестный продукт дохода." }, { status: 400 });
  }

  try {
    const wallet = await getLedgerWallet(body.walletAddress);
    if (wallet.deposits.length > 0) {
      return NextResponse.json({ error: "Для этого кошелька вклады уже привязаны." }, { status: 409 });
    }
    const incoming = await getUnassignedIncomingPayments(body.walletAddress);
    const deposits: LedgerDeposit[] = [];
    for (const item of incoming) {
      if (await hasLedgerSignature(item.signature)) continue;
      await verifyIncomingPayment({
        signature: item.signature,
        fromOwner: body.walletAddress,
        minAmountUi: item.amountUsd,
      });
      deposits.push({
        productId: body.productId,
        amountUsd: item.amountUsd,
        signature: item.signature,
        at: item.at,
      });
    }
    if (deposits.length === 0) {
      return NextResponse.json({ error: "Не найдено неподтверждённых переводов в казначейство." }, { status: 400 });
    }
    const updated = await appendDeposits(body.walletAddress, deposits);
    invalidateDevnetPortfolio(body.walletAddress);
    const assignedUsd = deposits.reduce((total, item) => total + item.amountUsd, 0);
    return NextResponse.json({ ok: true, assignedUsd, count: updated.deposits.length });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось привязать переводы к вкладу."),
    }, { status: 400 });
  }
}
