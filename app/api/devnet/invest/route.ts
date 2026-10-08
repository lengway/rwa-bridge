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
import { appendDeposit, findLedgerDeposit, hasLedgerSignature, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { explorerUrl, mintVaultShares, verifyIncomingPayment } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { getVaultQuote } from "@/lib/vaults";
import { notifyReceipt } from "@/lib/receipt-notifications";

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

  const walletAddress = body.walletAddress;
  const productId = body.productId;
  const amountUsd = body.amountUsd;
  const paymentSignature = body.signature;

  return withLedgerKeyLock(`invest:${paymentSignature}`, async () => {
    const existing = await findLedgerDeposit(walletAddress, paymentSignature);
    if (existing?.mintSignature && existing.shares !== undefined && existing.priceUsd !== undefined) {
      if (existing.productId !== productId || Math.abs(existing.amountUsd - amountUsd) > 0.000001) {
        return NextResponse.json({ error: "Эта транзакция уже использовалась для другого вклада." }, { status: 409 });
      }
      const quote = await getVaultQuote(productId);
      const response = {
        ok: true,
        sharesMinted: existing.shares,
        priceUsd: existing.priceUsd,
        mint: quote.mint,
        mintSignature: existing.mintSignature,
        explorerUrl: explorerUrl(existing.mintSignature),
      };
      notifyReceipt(request, {
        kind: "invest",
        amountUsd: existing.amountUsd,
        details: `Выпущено ${existing.shares.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} долей ${productId}.`,
        explorerUrl: response.explorerUrl,
        receiptId: existing.signature,
      });
      return NextResponse.json(response);
    }

    try {
      if (await hasLedgerSignature(paymentSignature)) {
        throw new Error("Эта транзакция уже была использована.");
      }
      await verifyIncomingPayment({ signature: paymentSignature, fromOwner: walletAddress, minAmountUi: amountUsd });
      const quote = await getVaultQuote(productId);
      const sharesMinted = Math.floor((amountUsd / quote.priceUsd) * 1_000_000) / 1_000_000;
      if (sharesMinted <= 0) throw new Error("Сумма слишком мала для выпуска долей.");
      const mintSignature = await mintVaultShares(walletAddress, productId, sharesMinted);
      await appendDeposit(walletAddress, {
        productId,
        amountUsd,
        signature: paymentSignature,
        at: Date.now(),
        shares: sharesMinted,
        priceUsd: quote.priceUsd,
        mintSignature,
      });
      invalidateDevnetPortfolio(walletAddress);
      const response = {
        ok: true,
        sharesMinted,
        priceUsd: quote.priceUsd,
        mint: quote.mint,
        mintSignature,
        explorerUrl: explorerUrl(mintSignature),
      };
      notifyReceipt(request, {
        kind: "invest",
        amountUsd,
        details: `Выпущено ${sharesMinted.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} долей ${productId}.`,
        explorerUrl: response.explorerUrl,
        receiptId: paymentSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Не удалось подтвердить перевод и выпустить доли в Solana devnet."),
      }, { status: 400 });
    }
  });
}
