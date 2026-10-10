import "server-only";

import { NextResponse } from "next/server";
import { appendKzteOperation, findKzteOperation, hasLedgerSignature, updateKzteOperation, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { isConfigured, isValidAmount, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";
import { getKztRateForOperation } from "@/lib/market-server";
import { getSessionWallet } from "@/lib/session-wallet";
import { devnetConfig, explorerUrl, mintTestDollars, sendKzteFromTreasury, verifyIncomingPayment } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { notifyReceipt } from "@/lib/receipt-notifications";

function isSignature(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 100;
}

function responseFor(operation: NonNullable<Awaited<ReturnType<typeof findKzteOperation>>>) {
  const targetSignature = operation.targetSignature;
  return {
    kind: operation.kind,
    amountKzt: operation.amountKzt,
    amountUsd: operation.amountUsd,
    sourceSignature: operation.sourceSignature,
    sourceExplorerUrl: operation.sourceSignature ? explorerUrl(operation.sourceSignature) : undefined,
    targetSignature,
    targetExplorerUrl: targetSignature ? explorerUrl(targetSignature) : undefined,
    explorerUrl: targetSignature ? explorerUrl(targetSignature) : undefined,
  };
}

export async function POST(request: Request) {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("kzte-exchange");

  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as { signature?: unknown; from?: unknown; amount?: unknown } | null;
  if (!isSignature(body?.signature)) {
    return NextResponse.json({ error: "Не указана подпись перевода." }, { status: 400 });
  }
  if (!isValidWalletAddress(body?.from)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (!isValidAmount(body?.amount, 0.000001, 1_000_000)) {
    return NextResponse.json({ error: "Укажите корректную сумму обмена." }, { status: 400 });
  }
  const session = await getSessionWallet(request);
  if (!session || session.walletAddress !== body.from) {
    return NextResponse.json({ error: "Перевод должен быть отправлен из кошелька текущей сессии." }, { status: 401 });
  }
  const walletAddress = session.walletAddress;
  const transferSignature = body.signature;
  const requestedAmount = body.amount;

  return withLedgerKeyLock(`kzte-exchange:${transferSignature}`, async () => {
    try {
      let operation = await findKzteOperation(walletAddress, transferSignature);
      if (operation && operation.sourceSignature !== transferSignature) {
        return NextResponse.json({ error: "Эта транзакция уже была использована." }, { status: 409 });
      }
      if (operation && operation.kind !== "exchange-kzte-usd" && operation.kind !== "exchange-usd-kzte") {
        return NextResponse.json({ error: "Эта транзакция уже использовалась для другой операции." }, { status: 409 });
      }

      if (!operation) {
        if (await hasLedgerSignature(transferSignature)) {
          return NextResponse.json({ error: "Эта транзакция уже была использована." }, { status: 409 });
        }
        let sourceAmount: number | null = null;
        let sourceKind: "kzte" | "usd" | null = null;
        try {
          sourceAmount = await verifyIncomingPayment({
            signature: transferSignature,
            fromOwner: walletAddress,
            minAmountUi: requestedAmount,
            mintAddress: devnetConfig.kzteMint,
          });
          sourceKind = "kzte";
        } catch {
          sourceAmount = await verifyIncomingPayment({
            signature: transferSignature,
            fromOwner: walletAddress,
            minAmountUi: requestedAmount,
          });
          sourceKind = "usd";
        }
        if (sourceAmount === null || Math.abs(sourceAmount - requestedAmount) > 0.000001) {
          throw new Error("Сумма перевода не совпадает с суммой обмена.");
        }
        const rate = await getKztRateForOperation();
        const kind = sourceKind === "kzte" ? "exchange-kzte-usd" : "exchange-usd-kzte";
        const amountKzt = sourceKind === "kzte" ? sourceAmount : sourceAmount * rate.usdKzt;
        const amountUsd = sourceKind === "kzte" ? sourceAmount / rate.usdKzt : sourceAmount;
        operation = await appendKzteOperation(walletAddress, {
          kind,
          sourceSignature: transferSignature,
          amountKzt,
          amountUsd,
          at: Date.now(),
        });
      }

      if (!operation.targetSignature) {
        const targetSignature = operation.kind === "exchange-kzte-usd"
          ? await mintTestDollars(walletAddress, operation.amountUsd)
          : await sendKzteFromTreasury(walletAddress, operation.amountKzt);
        operation = await updateKzteOperation(walletAddress, transferSignature, { targetSignature });
      }
      invalidateDevnetPortfolio(walletAddress);
      const response = responseFor(operation);
      notifyReceipt(request, {
        kind: "kzte-exchange",
        amountUsd: operation.amountUsd,
        details: operation.kind === "exchange-kzte-usd"
          ? `Обмен KZTE → $: ${operation.amountKzt.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} KZTE возвращены в резерв Intebix; зачислено ${operation.amountUsd.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} USD.`
          : `Перевод из резерва Intebix: получено ${operation.amountKzt.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} KZTE за ${operation.amountUsd.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} USD.`,
        explorerUrl: response.sourceExplorerUrl,
        secondaryExplorerUrl: response.targetExplorerUrl,
        receiptId: transferSignature,
      });
      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json({ error: safeError(error, "Не удалось выполнить обмен в Solana devnet.") }, { status: 400 });
    }
  });
}
