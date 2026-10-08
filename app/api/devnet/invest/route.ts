import "server-only";

import { NextResponse } from "next/server";
import { YIELD_STRATEGIES } from "@/lib/yields";
import {
  isConfigured,
  isValidAmount,
  isValidWalletAddress,
  safeError,
  unavailableResponse,
} from "@/lib/devnet-route";
import { appendDeposit, hasLedgerSignature } from "@/lib/devnet-ledger";
import { explorerUrl, verifyIncomingPayment } from "@/lib/solana-server";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    productId?: unknown;
    amountUsd?: unknown;
    signature?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd)) {
    return NextResponse.json({ error: "Сумма должна быть от $1 до $1 000." }, { status: 400 });
  }
  if (typeof body?.productId !== "string" || !YIELD_STRATEGIES.some((item) => item.id === body.productId)) {
    return NextResponse.json({ error: "Неизвестный продукт дохода." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "Не указана подпись перевода." }, { status: 400 });
  }

  try {
    if (await hasLedgerSignature(body.signature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    await verifyIncomingPayment({ signature: body.signature, fromOwner: body.walletAddress, minAmountUi: body.amountUsd });
    await appendDeposit(body.walletAddress, {
      productId: body.productId,
      amountUsd: body.amountUsd,
      signature: body.signature,
      at: Date.now(),
    });
    return NextResponse.json({ ok: true, explorerUrl: explorerUrl(body.signature) });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось подтвердить перевод в Solana devnet."),
    }, { status: 400 });
  }
}
