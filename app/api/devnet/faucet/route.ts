import "server-only";

import { NextResponse } from "next/server";
import {
  isConfigured,
  isValidAmount,
  isValidWalletAddress,
  unavailableResponse,
} from "@/lib/devnet-route";
import {
  findUnresolvedLegacyDevnetFaucetAction,
  getLegacyDevnetFaucetAction,
  isLegacyDevnetFaucetRequestId,
  LegacyDevnetFaucetActionConflictError,
  reserveLegacyDevnetFaucetAction,
  updateLegacyDevnetFaucetAction,
  withLedgerKeyLock,
  type LegacyDevnetFaucetAction,
} from "@/lib/devnet-ledger";
import {
  assertLegacyDevnetWriteAllowed,
  ensureFeeSol,
  explorerUrl,
  mintTestDollars,
} from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";
import { getSessionWallet } from "@/lib/session-wallet";

const faucetUsage = new Map<string, { amount: number; startedAt: number }>();
const DAY_MS = 24 * 60 * 60 * 1000;

type FaucetRequestBody = {
  walletAddress?: unknown;
  amountUsd?: unknown;
  /** Client-generated idempotency key, scoped to the authenticated wallet. */
  requestId?: unknown;
  source?: unknown;
};

function completedResponse(requestId: string, signature: string) {
  return NextResponse.json({
    signature,
    explorerUrl: explorerUrl(signature),
    requestId,
    actionState: "COMPLETED" as const,
  });
}

function requestIdConflictResponse(requestId: string) {
  return NextResponse.json({
    error: "Этот requestId уже связан с другим запросом крана.",
    code: "FAUCET_REQUEST_ID_CONFLICT",
    requestId,
  }, { status: 409 });
}

function actionNeedsReviewResponse(requestId: string) {
  return NextResponse.json({
    error: "Выпуск тестовых токенов требует сверки. Не повторяйте запрос с новым requestId.",
    code: "FAUCET_ACTION_NEEDS_REVIEW",
    requestId,
    actionState: "NEEDS_REVIEW" as const,
  }, { status: 409 });
}

function actionUnavailableResponse(requestId: string) {
  return NextResponse.json({
    error: "Невозможно безопасно зафиксировать действие крана. Повторите позже с тем же requestId.",
    code: "FAUCET_ACTION_UNAVAILABLE",
    requestId,
  }, { status: 503 });
}

function reserveFaucetUsage(walletAddress: string, amountUsd: number, now: number) {
  const usage = faucetUsage.get(walletAddress);
  const activeUsage = usage && now - usage.startedAt < DAY_MS ? usage : { amount: 0, startedAt: now };
  if (activeUsage.amount + amountUsd > 5_000) return false;
  faucetUsage.set(walletAddress, {
    amount: activeUsage.amount + amountUsd,
    startedAt: activeUsage.startedAt,
  });
  return true;
}

/** Only release a reservation that did not reach a persisted pre-mint action. */
function releaseFaucetUsage(walletAddress: string, amountUsd: number) {
  const usage = faucetUsage.get(walletAddress);
  if (!usage) return;
  faucetUsage.set(walletAddress, {
    amount: Math.max(0, usage.amount - amountUsd),
    startedAt: usage.startedAt,
  });
}

async function markActionNeedsReview(
  walletAddress: string,
  requestId: string,
  errorCode: string,
) {
  await updateLegacyDevnetFaucetAction({
    walletAddress,
    requestId,
    status: "NEEDS_REVIEW",
    errorCode,
  }).catch(() => undefined);
}

async function existingActionResponse({
  action,
  walletAddress,
  requestId,
  amountUsd,
}: {
  action: LegacyDevnetFaucetAction;
  walletAddress: string;
  requestId: string;
  amountUsd: number;
}) {
  if (action.amountUsd !== amountUsd) return requestIdConflictResponse(requestId);
  if (action.status === "COMPLETED" && typeof action.mintSignature === "string" && action.mintSignature) {
    // The original process could have stopped after persisting completion but
    // before clearing its short-lived portfolio cache.
    invalidateDevnetPortfolio(walletAddress);
    return completedResponse(requestId, action.mintSignature);
  }

  // A process can die after submission or after a ledger write becomes
  // uncertain. Never send the signer again for this exact action.
  if (action.status === "MINT_PENDING") {
    await markActionNeedsReview(walletAddress, requestId, "MINT_RECONCILIATION_REQUIRED");
  }
  return actionNeedsReviewResponse(requestId);
}

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  // The legacy issuer is intentionally opt-in. The Earn Gateway uses it only
  // as simulated Devnet funding, never as a fiat on-ramp or production rail.
  if (process.env.ENABLE_LEGACY_DEVNET_FAUCET !== "true") {
    return NextResponse.json({
      error: "Демо-кран выключен. Включите ENABLE_LEGACY_DEVNET_FAUCET=true только для контролируемого Devnet-демо.",
      code: "DEVNET_FAUCET_DISABLED",
    }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as FaucetRequestBody | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd)) {
    return NextResponse.json({ error: "Сумма должна быть от $1 до $1 000." }, { status: 400 });
  }
  if (body?.requestId === undefined) {
    return NextResponse.json({
      error: "Укажите requestId для идемпотентного выпуска тестовых токенов.",
      code: "FAUCET_REQUEST_ID_REQUIRED",
    }, { status: 400 });
  }
  if (!isLegacyDevnetFaucetRequestId(body.requestId)) {
    return NextResponse.json({
      error: "requestId должен содержать от 8 до 64 URL-безопасных символов.",
      code: "FAUCET_REQUEST_ID_INVALID",
    }, { status: 400 });
  }

  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Требуется авторизованная сессия." }, { status: 401 });
  if (session.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "Адрес кошелька не соответствует текущей сессии." }, { status: 403 });
  }

  const walletAddress = session.walletAddress;
  const amountUsd = body.amountUsd;
  const requestId = body.requestId;

  // Serialize all faucet actions for a wallet, not only an individual request
  // id. That way a client cannot bypass an uncertain previous mint by making
  // up a fresh requestId after losing a response.
  return withLedgerKeyLock(`legacy-faucet:${walletAddress}`, async () => {
    let existing: LegacyDevnetFaucetAction | null;
    try {
      existing = await getLegacyDevnetFaucetAction(walletAddress, requestId);
    } catch {
      return actionUnavailableResponse(requestId);
    }
    if (existing) {
      return existingActionResponse({ action: existing, walletAddress, requestId, amountUsd });
    }

    let unresolved: LegacyDevnetFaucetAction | null;
    try {
      unresolved = await findUnresolvedLegacyDevnetFaucetAction(walletAddress);
    } catch {
      return actionUnavailableResponse(requestId);
    }
    if (unresolved) {
      if (unresolved.status === "MINT_PENDING") {
        await markActionNeedsReview(
          walletAddress,
          unresolved.requestId,
          "MINT_RECONCILIATION_REQUIRED",
        );
      }
      return actionNeedsReviewResponse(unresolved.requestId);
    }

    // This read-only check happens before the pre-mint record. The signer
    // helpers repeat it immediately before every write-capable operation.
    try {
      await assertLegacyDevnetWriteAllowed();
    } catch {
      return unavailableResponse();
    }

    if (!reserveFaucetUsage(walletAddress, amountUsd, Date.now())) {
      return NextResponse.json({ error: "Лимит крана Solana devnet на сегодня исчерпан." }, { status: 429 });
    }

    let reservation: { action: LegacyDevnetFaucetAction; reused: boolean };
    try {
      reservation = await reserveLegacyDevnetFaucetAction({
        walletAddress,
        requestId,
        amountUsd,
        status: "MINT_PENDING",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (error) {
      releaseFaucetUsage(walletAddress, amountUsd);
      if (error instanceof LegacyDevnetFaucetActionConflictError) {
        return requestIdConflictResponse(requestId);
      }
      // A failed durable reservation may have committed before its response
      // was lost. Keep the action fail-closed rather than starting a mint.
      return actionNeedsReviewResponse(requestId);
    }

    if (reservation.reused) {
      releaseFaucetUsage(walletAddress, amountUsd);
      return existingActionResponse({ action: reservation.action, walletAddress, requestId, amountUsd });
    }

    let signature: string;
    try {
      // Both helpers enforce the canonical Devnet genesis check immediately
      // before their potential writes. An uncertain fee transfer is handled
      // exactly like an uncertain mint: do not issue another token.
      await ensureFeeSol(walletAddress);
      signature = await mintTestDollars(walletAddress, amountUsd);
    } catch {
      await markActionNeedsReview(walletAddress, requestId, "MINT_SUBMISSION_UNVERIFIED");
      return actionNeedsReviewResponse(requestId);
    }

    try {
      await updateLegacyDevnetFaucetAction({
        walletAddress,
        requestId,
        status: "COMPLETED",
        mintSignature: signature,
      });
    } catch {
      await markActionNeedsReview(walletAddress, requestId, "MINT_RECONCILIATION_REQUIRED");
      return actionNeedsReviewResponse(requestId);
    }

    invalidateDevnetPortfolio(walletAddress);
    const response = completedResponse(requestId, signature);
    notifyReceipt(request, {
      kind: "faucet",
      amountUsd,
      details: "SIMULATED FUNDING: тестовые токены выпущены на кошелёк в Solana Devnet; это не банковский или карточный платёж.",
      explorerUrl: explorerUrl(signature),
      receiptId: signature,
    });
    return response;
  });
}
