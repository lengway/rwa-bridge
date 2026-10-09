import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, isValidAmount, isValidWalletAddress, unavailableResponse } from "@/lib/devnet-route";
import { explorerUrl, verifyOutgoingWalletTransfer } from "@/lib/solana-server";
import { notifyReceipt } from "@/lib/receipt-notifications";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    recipientAddress?: unknown;
    amountUsd?: unknown;
    signature?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress) || !isValidWalletAddress(body?.recipientAddress)) {
    return NextResponse.json({ error: "Проверьте адреса кошельков Solana." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd, 0.01, 100_000)) {
    return NextResponse.json({ error: "Проверьте сумму перевода." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "Не указана подпись перевода." }, { status: 400 });
  }

  try {
    const amountUsd = await verifyOutgoingWalletTransfer({
      signature: body.signature,
      fromOwner: body.walletAddress,
      toOwner: body.recipientAddress,
      minAmountUi: body.amountUsd,
    });
    if (amountUsd === null) {
      return NextResponse.json({ error: "Перевод ещё не подтверждён в Solana devnet." }, { status: 409 });
    }
    invalidateDevnetPortfolio(body.walletAddress);
    notifyReceipt(request, {
      kind: "wallet-send",
      amountUsd,
      details: `Тестовые доллары отправлены на адрес ${body.recipientAddress}.`,
      explorerUrl: explorerUrl(body.signature),
      receiptId: body.signature,
    });
    return NextResponse.json({ ok: true, amountUsd });
  } catch {
    return NextResponse.json({ error: "Не удалось проверить перевод в Solana devnet." }, { status: 502 });
  }
}
