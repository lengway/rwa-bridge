import "server-only";

import { NextResponse } from "next/server";
import { YIELD_STRATEGIES } from "@/lib/yields";
import { appendWithdrawal, findLedgerWithdrawal, hasLedgerSignature, updateWithdrawal, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { isConfigured, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import {
  burnTreasuryVaultShares,
  explorerUrl,
  sendFromTreasury,
  verifyIncomingPayment,
} from "@/lib/solana-server";
import { getVaultQuote } from "@/lib/vaults";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    productId?: unknown;
    signature?: unknown;
    shares?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (typeof body?.productId !== "string" || !YIELD_STRATEGIES.some((item) => item.id === body.productId)) {
    return NextResponse.json({ error: "Неизвестный продукт дохода." }, { status: 400 });
  }
  if (typeof body?.shares !== "number" || !Number.isFinite(body.shares) || body.shares <= 0 || body.shares > 100_000) {
    return NextResponse.json({ error: "Укажите корректное количество долей." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "Не указана подпись перевода долей." }, { status: 400 });
  }

  const walletAddress = body.walletAddress;
  const productId = body.productId;
  const transferSignature = body.signature;
  const requestedShares = body.shares;

  return withLedgerKeyLock(`withdraw:${transferSignature}`, async () => {
    try {
      let withdrawal = await findLedgerWithdrawal(walletAddress, transferSignature);
      if (withdrawal && (withdrawal.productId !== productId || Math.abs((withdrawal.shares ?? 0) - requestedShares) > 0.000001)) {
        return NextResponse.json({ error: "Эта транзакция уже использовалась для другого вывода." }, { status: 409 });
      }

      if (!withdrawal) {
        if (await hasLedgerSignature(transferSignature)) {
          return NextResponse.json({ error: "Эта транзакция уже была использована." }, { status: 409 });
        }
        const quote = await getVaultQuote(productId);
        const receivedShares = await verifyIncomingPayment({
          signature: transferSignature,
          fromOwner: walletAddress,
          minAmountUi: requestedShares,
          mintAddress: quote.mint,
        });
        const roundedShares = Math.floor((receivedShares + Number.EPSILON) * 1_000_000) / 1_000_000;
        if (roundedShares <= 0) throw new Error("Перевод долей не найден.");
        withdrawal = {
          productId,
          signature: transferSignature,
          at: Date.now(),
          shares: roundedShares,
          amountUsd: roundedShares * quote.priceUsd,
          priceUsd: quote.priceUsd,
        };
        await appendWithdrawal(walletAddress, withdrawal);
      }

      if (!withdrawal.payoutSignature) {
        const payoutSignature = await sendFromTreasury(walletAddress, withdrawal.amountUsd ?? 0);
        withdrawal = await updateWithdrawal(walletAddress, transferSignature, { payoutSignature });
      }
      if (!withdrawal.burnSignature) {
        const burnSignature = await burnTreasuryVaultShares(productId, withdrawal.shares ?? 0);
        withdrawal = await updateWithdrawal(walletAddress, transferSignature, { burnSignature });
      }
      invalidateDevnetPortfolio(walletAddress);
      const response = {
        sharesRedeemed: withdrawal.shares,
        priceUsd: withdrawal.priceUsd,
        amountUsd: withdrawal.amountUsd,
        signature: withdrawal.payoutSignature,
        payoutSignature: withdrawal.payoutSignature,
        burnSignature: withdrawal.burnSignature,
        explorerUrl: withdrawal.payoutSignature ? explorerUrl(withdrawal.payoutSignature) : undefined,
      };
      notifyReceipt(request, {
        kind: "redemption",
        amountUsd: withdrawal.amountUsd ?? 0,
        details: `Погашено ${withdrawal.shares ?? 0} долей продукта ${productId}. Доллары отправлены в кошелёк.`,
        explorerUrl: response.explorerUrl,
        receiptId: transferSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Не удалось погасить доли в Solana devnet."),
      }, { status: 502 });
    }
  });
}
