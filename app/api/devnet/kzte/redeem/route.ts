import "server-only";

import { NextResponse } from "next/server";
import { appendKzteOperation, findKzteOperation, hasLedgerSignature, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { isConfigured, safeError, unavailableResponse } from "@/lib/devnet-route";
import { getKztRateForOperation } from "@/lib/market-server";
import { getSessionWallet } from "@/lib/session-wallet";
import { devnetConfig, explorerUrl, verifyIncomingPayment } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";

function isSignature(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 100;
}

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Войдите в аккаунт, чтобы вывести KZTE с кошелька." }, { status: 401 });
  const body = await request.json().catch(() => null) as { signature?: unknown } | null;
  if (!isSignature(body?.signature)) {
    return NextResponse.json({ error: "Не указана подпись перевода KZTE." }, { status: 400 });
  }
  const walletAddress = session.walletAddress;
  const transferSignature = body.signature;

  return withLedgerKeyLock(`kzte-redeem:${transferSignature}`, async () => {
    try {
      let operation = await findKzteOperation(walletAddress, transferSignature);
      if (operation && (operation.sourceSignature !== transferSignature || operation.kind !== "redeem")) {
        return NextResponse.json({ error: "Эта транзакция уже использовалась для другой операции." }, { status: 409 });
      }
      if (!operation) {
        if (await hasLedgerSignature(transferSignature)) {
          return NextResponse.json({ error: "Эта транзакция уже была использована." }, { status: 409 });
        }
        const amountKzt = await verifyIncomingPayment({
          signature: transferSignature,
          fromOwner: walletAddress,
          minAmountUi: 0.000001,
          mintAddress: devnetConfig.kzteMint,
        });
        const rate = await getKztRateForOperation();
        operation = await appendKzteOperation(walletAddress, {
          kind: "redeem",
          sourceSignature: transferSignature,
          amountKzt,
          amountUsd: amountKzt / rate.usdKzt,
          at: Date.now(),
        });
      }
      invalidateDevnetPortfolio(walletAddress);
      const response = {
        amountKzt: operation.amountKzt,
        amountUsd: operation.amountUsd,
        signature: operation.sourceSignature,
        explorerUrl: operation.sourceSignature ? explorerUrl(operation.sourceSignature) : undefined,
      };
      notifyReceipt(request, {
        kind: "kzte-redeem",
        amountUsd: operation.amountUsd,
        details: `KZTE возвращены в резерв Intebix: ${operation.amountKzt.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ₸. Выплата через Intebix проводится в сети Solana devnet.`,
        explorerUrl: response.explorerUrl,
        receiptId: transferSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({ error: safeError(error, "Не удалось вернуть KZTE в резерв Intebix.") }, { status: 400 });
    }
  });
}
