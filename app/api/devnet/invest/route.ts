import "server-only";

import { NextResponse } from "next/server";
import { APP_CONTROLLED_LEGACY_YIELD_STRATEGIES } from "@/lib/yields";
import {
  atomicScale,
  assertStrategyOperationSupported,
  EarnGatewayError,
  formatAtomicToDecimal,
  requirePositiveDecimalToAtomic,
  toPublicEarnStrategy,
  type EarnStrategy,
} from "@/lib/earn-gateway";
import {
  isConfigured,
  isValidWalletAddress,
  safeError,
  unavailableResponse,
} from "@/lib/devnet-route";
import {
  appendDeposit,
  findLedgerDeposit,
  hasLedgerSignature,
  updateDeposit,
  withLedgerKeyLock,
} from "@/lib/devnet-ledger";
import {
  DEVNET_DEMO_TOKEN_DECIMALS,
  explorerUrl,
  assertLegacyDevnetWriteAllowed,
  mintVaultSharesAtomic,
  verifyIncomingPaymentAtomic,
} from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { getVaultQuote } from "@/lib/vaults";
import { notifyReceipt } from "@/lib/receipt-notifications";
import { getSessionWallet } from "@/lib/session-wallet";

const MIN_DEPOSIT_ATOMIC = atomicScale(DEVNET_DEMO_TOKEN_DECIMALS);
const MAX_DEPOSIT_ATOMIC = MIN_DEPOSIT_ATOMIC * BigInt(1_000);

function displayAmount(amountAtomic: bigint) {
  // The API boundary remains JSON-safe; this number is for the existing UI
  // only and is derived from a bounded, exact six-decimal base-unit amount.
  return Number(formatAtomicToDecimal(amountAtomic, DEVNET_DEMO_TOKEN_DECIMALS));
}

function publicGatewayMetadata(strategy: EarnStrategy) {
  const publicStrategy = toPublicEarnStrategy(strategy);
  return {
    network: publicStrategy.network,
    mode: publicStrategy.mode,
    yieldKind: publicStrategy.yieldKind,
    disclosures: publicStrategy.disclosures,
  };
}

function actionNeedsReviewResponse() {
  return NextResponse.json({
    error: "Эта операция уже отправлена на проверку. Не подписывайте новый перевод с тем же действием.",
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
    /** Canonical decimal string: the only accepted financial input. */
    amount?: unknown;
    /** Compatibility/display field from older clients; never trusted. */
    amountUsd?: unknown;
    signature?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  const strategy = typeof body?.productId === "string"
    ? APP_CONTROLLED_LEGACY_YIELD_STRATEGIES.find((item) => item.id === body.productId)
    : undefined;
  if (!strategy) {
    return NextResponse.json({ error: "Неизвестный продукт дохода." }, { status: 400 });
  }
  try {
    assertStrategyOperationSupported(strategy.gateway, "deposit");
  } catch (error) {
    const message = error instanceof EarnGatewayError ? error.message : "Стратегия сейчас недоступна.";
    return NextResponse.json({ error: message, code: "STRATEGY_UNSUPPORTED" }, { status: 409 });
  }

  let amountAtomic: bigint;
  try {
    amountAtomic = requirePositiveDecimalToAtomic(body?.amount, DEVNET_DEMO_TOKEN_DECIMALS, "amount");
  } catch (error) {
    const message = error instanceof EarnGatewayError ? error.message : "Укажите корректную сумму.";
    return NextResponse.json({ error: message, code: "INVALID_AMOUNT" }, { status: 400 });
  }
  if (amountAtomic < MIN_DEPOSIT_ATOMIC || amountAtomic > MAX_DEPOSIT_ATOMIC) {
    return NextResponse.json({ error: "Сумма должна быть от 1 до 1 000 TEST QUOTE." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "Не указана подпись перевода." }, { status: 400 });
  }
  const paymentSignature = body.signature;

  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Требуется авторизованная сессия." }, { status: 401 });
  if (session.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "Адрес кошелька не соответствует текущей сессии." }, { status: 403 });
  }

  const walletAddress = session.walletAddress;
  const productId = strategy.id;
  const amountAtomicString = amountAtomic.toString(10);
  const amountUsd = displayAmount(amountAtomic);

  return withLedgerKeyLock(`invest:${paymentSignature}`, async () => {
    const existing = await findLedgerDeposit(walletAddress, paymentSignature);
    if (existing) {
      if (existing.productId !== productId || (existing.amountAtomic && existing.amountAtomic !== amountAtomicString)) {
        return NextResponse.json({ error: "Эта транзакция уже использовалась для другого вклада." }, { status: 409 });
      }
      if (
        existing.status === "MINT_PENDING"
        || existing.status === "NEEDS_REVIEW"
        || !existing.mintSignature
      ) {
        return actionNeedsReviewResponse();
      }
      const quote = await getVaultQuote(productId);
      const sharesAtomic = existing.sharesAtomic ?? BigInt(Math.round((existing.shares ?? 0) * 1_000_000)).toString(10);
      const response = {
        ok: true,
        actionState: "COMPLETED" as const,
        amountAtomic: existing.amountAtomic ?? amountAtomicString,
        sharesMintedAtomic: sharesAtomic,
        sharesMinted: existing.shares ?? displayAmount(BigInt(sharesAtomic)),
        priceUsd: existing.priceUsd ?? 1,
        mint: quote.mint,
        mintSignature: existing.mintSignature,
        explorerUrl: explorerUrl(existing.mintSignature),
        ...publicGatewayMetadata(strategy.gateway),
      };
      notifyReceipt(request, {
        kind: "invest",
        amountUsd: existing.amountUsd,
        details: `Выпущено ${response.sharesMintedAtomic} atomic-долей ${productId} в Solana Devnet.`,
        explorerUrl: response.explorerUrl,
        receiptId: existing.signature,
      });
      return NextResponse.json(response);
    }

    try {
      if (await hasLedgerSignature(paymentSignature)) {
        throw new Error("Эта транзакция уже была использована.");
      }
      const receivedAtomic = await verifyIncomingPaymentAtomic({
        signature: paymentSignature,
        fromOwner: walletAddress,
        minAmountAtomic: amountAtomic,
      });
      if (receivedAtomic !== amountAtomic) {
        throw new Error("Сумма в подтверждённом Devnet-переводе должна точно совпадать с суммой действия.");
      }

      // The first strategy intentionally settles one test quote token to one
      // demo share. Illustrative APY never changes this exact redemption rate.
      const sharesAtomic = receivedAtomic;
      const sharesMinted = displayAmount(sharesAtomic);
      const quote = await getVaultQuote(productId);
      await appendDeposit(walletAddress, {
        productId,
        amountUsd,
        amountAtomic: amountAtomicString,
        signature: paymentSignature,
        at: Date.now(),
        shares: sharesMinted,
        sharesAtomic: sharesAtomic.toString(10),
        priceUsd: 1,
        status: "MINT_PENDING",
      });

      let mintSignature: string;
      try {
        mintSignature = await mintVaultSharesAtomic(walletAddress, productId, sharesAtomic);
      } catch (error) {
        await updateDeposit(walletAddress, paymentSignature, {
          status: "NEEDS_REVIEW",
          errorCode: "MINT_SUBMISSION_FAILED",
        }).catch(() => undefined);
        throw error;
      }

      try {
        await updateDeposit(walletAddress, paymentSignature, {
          mintSignature,
          status: "COMPLETED",
        });
      } catch {
        await updateDeposit(walletAddress, paymentSignature, {
          status: "NEEDS_REVIEW",
          errorCode: "MINT_RECONCILIATION_REQUIRED",
        }).catch(() => undefined);
        throw new Error("Выпуск долей отправлен, но запись требует сверки. Не повторяйте перевод.");
      }

      invalidateDevnetPortfolio(walletAddress);
      const response = {
        ok: true,
        actionState: "COMPLETED" as const,
        amountAtomic: amountAtomicString,
        sharesMintedAtomic: sharesAtomic.toString(10),
        sharesMinted,
        priceUsd: 1,
        mint: quote.mint,
        mintSignature,
        explorerUrl: explorerUrl(mintSignature),
        ...publicGatewayMetadata(strategy.gateway),
      };
      notifyReceipt(request, {
        kind: "invest",
        amountUsd,
        details: `Подтверждён Devnet-перевод; выпущено ${response.sharesMintedAtomic} atomic-долей ${productId}.`,
        explorerUrl: response.explorerUrl,
        receiptId: paymentSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Не удалось подтвердить перевод и выпустить доли в Solana Devnet."),
        actionState: "TRANSACTION_FAILED",
      }, { status: 400 });
    }
  });
}
