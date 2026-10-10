import "server-only";

import { NextResponse } from "next/server";
import { ALL_YIELD_STRATEGIES } from "@/lib/yields";
import {
  atomicScale,
  assertStrategyOperationSupported,
  EarnGatewayError,
  formatAtomicToDecimal,
  parseAtomicAmount,
} from "@/lib/earn-gateway";
import {
  appendWithdrawal,
  findLedgerWithdrawal,
  hasLedgerSignature,
  updateWithdrawal,
  withLedgerKeyLock,
} from "@/lib/devnet-ledger";
import { isConfigured, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import {
  burnTreasuryVaultSharesAtomic,
  DEVNET_DEMO_TOKEN_DECIMALS,
  explorerUrl,
  assertLegacyDevnetWriteAllowed,
  sendFromTreasuryAtomic,
  verifyIncomingPaymentAtomic,
} from "@/lib/solana-server";
import { getVaultQuote } from "@/lib/vaults";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";
import { getSessionWallet } from "@/lib/session-wallet";

const MAX_REDEMPTION_ATOMIC = atomicScale(DEVNET_DEMO_TOKEN_DECIMALS) * BigInt(100_000);

function displayAmount(amountAtomic: bigint) {
  return Number(formatAtomicToDecimal(amountAtomic, DEVNET_DEMO_TOKEN_DECIMALS));
}

function needsReviewResponse() {
  return NextResponse.json({
    error: "Эта операция требует сверки. Не подписывайте новый перевод долей с тем же действием.",
    code: "ACTION_NEEDS_REVIEW",
    actionState: "NEEDS_REVIEW",
  }, { status: 409 });
}

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  try {
    await assertLegacyDevnetWriteAllowed();
  } catch {
    return unavailableResponse();
  }
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    productId?: unknown;
    signature?: unknown;
    /** JSON-safe SPL base units; numeric share values are deliberately rejected. */
    sharesAtomic?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  const strategy = typeof body?.productId === "string"
    ? ALL_YIELD_STRATEGIES.find((item) => item.id === body.productId)
    : undefined;
  if (!strategy) {
    return NextResponse.json({ error: "Неизвестный продукт дохода." }, { status: 400 });
  }
  try {
    assertStrategyOperationSupported(strategy.gateway, "withdraw");
  } catch (error) {
    const message = error instanceof EarnGatewayError ? error.message : "Погашение этой стратегии сейчас недоступно.";
    return NextResponse.json({ error: message, code: "STRATEGY_UNSUPPORTED" }, { status: 409 });
  }

  let requestedSharesAtomic: bigint;
  try {
    requestedSharesAtomic = parseAtomicAmount(body?.sharesAtomic, "sharesAtomic");
  } catch (error) {
    const message = error instanceof EarnGatewayError ? error.message : "Укажите корректное количество долей.";
    return NextResponse.json({ error: message, code: "INVALID_AMOUNT" }, { status: 400 });
  }
  if (requestedSharesAtomic <= BigInt(0) || requestedSharesAtomic > MAX_REDEMPTION_ATOMIC) {
    return NextResponse.json({ error: "Укажите корректное количество долей." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "Не указана подпись перевода долей." }, { status: 400 });
  }
  const transferSignature = body.signature;

  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Требуется авторизованная сессия." }, { status: 401 });
  if (session.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "Адрес кошелька не соответствует текущей сессии." }, { status: 403 });
  }

  const walletAddress = session.walletAddress;
  const productId = strategy.id;
  const sharesAtomicString = requestedSharesAtomic.toString(10);

  return withLedgerKeyLock(`withdraw:${transferSignature}`, async () => {
    try {
      const existing = await findLedgerWithdrawal(walletAddress, transferSignature);
      if (existing) {
        if (existing.productId !== productId || (existing.sharesAtomic && existing.sharesAtomic !== sharesAtomicString)) {
          return NextResponse.json({ error: "Эта транзакция уже использовалась для другого вывода." }, { status: 409 });
        }
        if (!existing.payoutSignature || !existing.burnSignature || existing.status === "NEEDS_REVIEW") {
          return needsReviewResponse();
        }
        const completedSharesAtomic = existing.sharesAtomic
          ?? BigInt(Math.round((existing.shares ?? 0) * 1_000_000)).toString(10);
        const completedAmountAtomic = existing.amountAtomic ?? completedSharesAtomic;
        const response = {
          actionState: "COMPLETED" as const,
          sharesAtomic: completedSharesAtomic,
          amountAtomic: completedAmountAtomic,
          sharesRedeemed: existing.shares ?? displayAmount(BigInt(completedSharesAtomic)),
          priceUsd: existing.priceUsd ?? 1,
          amountUsd: existing.amountUsd ?? displayAmount(BigInt(completedAmountAtomic)),
          signature: existing.payoutSignature,
          payoutSignature: existing.payoutSignature,
          burnSignature: existing.burnSignature,
          explorerUrl: explorerUrl(existing.payoutSignature),
          network: strategy.gateway.network,
          mode: strategy.gateway.mode,
          yieldKind: strategy.gateway.yieldKind,
          disclosures: strategy.gateway.disclosures,
        };
        return NextResponse.json(response);
      }

      if (await hasLedgerSignature(transferSignature)) {
        return NextResponse.json({ error: "Эта транзакция уже была использована." }, { status: 409 });
      }
      const quote = await getVaultQuote(productId);
      const receivedSharesAtomic = await verifyIncomingPaymentAtomic({
        signature: transferSignature,
        fromOwner: walletAddress,
        minAmountAtomic: requestedSharesAtomic,
        mintAddress: quote.mint,
      });
      if (receivedSharesAtomic !== requestedSharesAtomic) {
        throw new Error("Количество долей в подтверждённом Devnet-переводе должно точно совпадать с действием.");
      }

      // The selected Devnet demo is exactly one test quote token per demo
      // share. Its illustrative APY is never included in redemption math.
      const amountAtomic = receivedSharesAtomic;
      const sharesRedeemed = displayAmount(receivedSharesAtomic);
      const amountUsd = displayAmount(amountAtomic);
      await appendWithdrawal(walletAddress, {
        productId,
        signature: transferSignature,
        at: Date.now(),
        sharesAtomic: receivedSharesAtomic.toString(10),
        shares: sharesRedeemed,
        amountAtomic: amountAtomic.toString(10),
        amountUsd,
        priceUsd: 1,
        status: "PAYOUT_PENDING",
      });

      let payoutSignature: string;
      try {
        payoutSignature = await sendFromTreasuryAtomic(walletAddress, amountAtomic);
      } catch (error) {
        await updateWithdrawal(walletAddress, transferSignature, {
          status: "NEEDS_REVIEW",
          errorCode: "PAYOUT_SUBMISSION_FAILED",
        }).catch(() => undefined);
        throw error;
      }
      try {
        await updateWithdrawal(walletAddress, transferSignature, {
          payoutSignature,
          status: "BURN_PENDING",
        });
      } catch {
        await updateWithdrawal(walletAddress, transferSignature, {
          status: "NEEDS_REVIEW",
          errorCode: "PAYOUT_RECONCILIATION_REQUIRED",
        }).catch(() => undefined);
        throw new Error("Погашение отправлено, но запись требует сверки. Не повторяйте перевод.");
      }

      let burnSignature: string;
      try {
        burnSignature = await burnTreasuryVaultSharesAtomic(productId, receivedSharesAtomic);
      } catch (error) {
        await updateWithdrawal(walletAddress, transferSignature, {
          status: "NEEDS_REVIEW",
          errorCode: "BURN_SUBMISSION_FAILED",
        }).catch(() => undefined);
        throw error;
      }
      try {
        await updateWithdrawal(walletAddress, transferSignature, {
          burnSignature,
          status: "COMPLETED",
        });
      } catch {
        await updateWithdrawal(walletAddress, transferSignature, {
          status: "NEEDS_REVIEW",
          errorCode: "BURN_RECONCILIATION_REQUIRED",
        }).catch(() => undefined);
        throw new Error("Сжигание долей отправлено, но запись требует сверки. Не повторяйте перевод.");
      }

      invalidateDevnetPortfolio(walletAddress);
      const response = {
        actionState: "COMPLETED" as const,
        sharesAtomic: receivedSharesAtomic.toString(10),
        amountAtomic: amountAtomic.toString(10),
        sharesRedeemed,
        priceUsd: 1,
        amountUsd,
        signature: payoutSignature,
        payoutSignature,
        burnSignature,
        explorerUrl: explorerUrl(payoutSignature),
        network: strategy.gateway.network,
        mode: strategy.gateway.mode,
        yieldKind: strategy.gateway.yieldKind,
        disclosures: strategy.gateway.disclosures,
      };
      notifyReceipt(request, {
        kind: "redemption",
        amountUsd,
        details: `DEVNET TEST-TOKEN REDEMPTION: ${response.sharesAtomic} atomic-долей ${productId} погашены; фиатная выплата не выполнялась.`,
        explorerUrl: response.explorerUrl,
        receiptId: transferSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Не удалось погасить доли в Solana Devnet."),
        actionState: "TRANSACTION_FAILED",
      }, { status: 502 });
    }
  });
}
