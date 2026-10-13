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
    error: "This operation was already submitted for review. Do not sign a new transfer for the same action.",
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
    return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  }
  const strategy = typeof body?.productId === "string"
    ? APP_CONTROLLED_LEGACY_YIELD_STRATEGIES.find((item) => item.id === body.productId)
    : undefined;
  if (!strategy) {
    return NextResponse.json({ error: "Unknown yield product." }, { status: 400 });
  }
  try {
    assertStrategyOperationSupported(strategy.gateway, "deposit");
  } catch (error) {
    const message = error instanceof EarnGatewayError ? error.message : "This strategy is currently unavailable.";
    return NextResponse.json({ error: message, code: "STRATEGY_UNSUPPORTED" }, { status: 409 });
  }

  let amountAtomic: bigint;
  try {
    amountAtomic = requirePositiveDecimalToAtomic(body?.amount, DEVNET_DEMO_TOKEN_DECIMALS, "amount");
  } catch (error) {
    const message = error instanceof EarnGatewayError ? error.message : "Provide a valid amount.";
    return NextResponse.json({ error: message, code: "INVALID_AMOUNT" }, { status: 400 });
  }
  if (amountAtomic < MIN_DEPOSIT_ATOMIC || amountAtomic > MAX_DEPOSIT_ATOMIC) {
    return NextResponse.json({ error: "The amount must be between 1 and 1,000 TEST QUOTE." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "The transfer signature is missing." }, { status: 400 });
  }
  const paymentSignature = body.signature;

  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "An authenticated session is required." }, { status: 401 });
  if (session.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "The wallet address does not match the current session." }, { status: 403 });
  }

  const walletAddress = session.walletAddress;
  const productId = strategy.id;
  const amountAtomicString = amountAtomic.toString(10);
  const amountUsd = displayAmount(amountAtomic);

  return withLedgerKeyLock(`invest:${paymentSignature}`, async () => {
    const existing = await findLedgerDeposit(walletAddress, paymentSignature);
    if (existing) {
      if (existing.productId !== productId || (existing.amountAtomic && existing.amountAtomic !== amountAtomicString)) {
        return NextResponse.json({ error: "This transaction was already used for a different deposit." }, { status: 409 });
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
        details: `Issued ${response.sharesMintedAtomic} atomic shares ${productId} on Solana Devnet.`,
        explorerUrl: response.explorerUrl,
        receiptId: existing.signature,
      });
      return NextResponse.json(response);
    }

    try {
      if (await hasLedgerSignature(paymentSignature)) {
        throw new Error("This transaction has already been used.");
      }
      const receivedAtomic = await verifyIncomingPaymentAtomic({
        signature: paymentSignature,
        fromOwner: walletAddress,
        minAmountAtomic: amountAtomic,
      });
      if (receivedAtomic !== amountAtomic) {
        throw new Error("The amount in the confirmed Devnet transfer must exactly match the action amount.");
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
        throw new Error("Share issuance was submitted, but the record needs reconciliation. Do not repeat the transfer.");
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
        details: `Devnet transfer confirmed; issued ${response.sharesMintedAtomic} atomic shares ${productId}.`,
        explorerUrl: response.explorerUrl,
        receiptId: paymentSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Couldn't confirm the transfer and issue shares on Solana Devnet."),
        actionState: "TRANSACTION_FAILED",
      }, { status: 400 });
    }
  });
}
