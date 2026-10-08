import "server-only";

import { NextResponse } from "next/server";
import { DEMO_OFFICE_ASSET } from "@/lib/assets";
import {
  isConfigured,
  isValidAmount,
  isValidWalletAddress,
  safeError,
  unavailableResponse,
} from "@/lib/devnet-route";
import { appendPurchase, findLedgerPurchase, hasLedgerSignature, withLedgerKeyLock } from "@/lib/devnet-ledger";
import { explorerUrl, mintAsset, verifyIncomingPayment } from "@/lib/solana-server";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    assetId?: unknown;
    amountUsd?: unknown;
    signature?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (!isValidAmount(body?.amountUsd)) {
    return NextResponse.json({ error: "Сумма должна быть от $1 до $1 000." }, { status: 400 });
  }
  if (body?.assetId !== DEMO_OFFICE_ASSET.id || DEMO_OFFICE_ASSET.buyFlow !== "spl-demo-mint") {
    return NextResponse.json({ error: "Покупка этого актива недоступна." }, { status: 400 });
  }
  if (typeof body?.signature !== "string" || body.signature.length < 32 || body.signature.length > 100) {
    return NextResponse.json({ error: "Не указана подпись перевода." }, { status: 400 });
  }

  const walletAddress = body.walletAddress;
  const assetId = body.assetId;
  const amountUsd = body.amountUsd;
  const paymentSignature = body.signature;
  return withLedgerKeyLock(paymentSignature, async () => {
    const existingPurchase = await findLedgerPurchase(walletAddress, paymentSignature);
    if (existingPurchase) {
      if (existingPurchase.assetId !== assetId || Math.abs(existingPurchase.amountUsd - amountUsd) > 0.000001) {
        return NextResponse.json({ error: "Эта транзакция уже использовалась для другой покупки.", stage: "verify" }, { status: 409 });
      }
      return NextResponse.json({
        signature: existingPurchase.mintSignature,
        explorerUrl: explorerUrl(existingPurchase.mintSignature),
        units: existingPurchase.units,
      });
    }

    try {
      if (await hasLedgerSignature(paymentSignature)) {
        return NextResponse.json({ error: "Эта транзакция уже была использована.", stage: "verify" }, { status: 409 });
      }
      await verifyIncomingPayment({
        signature: paymentSignature,
        fromOwner: walletAddress,
        minAmountUi: amountUsd,
      });
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Не удалось подтвердить покупку в Solana devnet."),
        stage: "verify",
      }, { status: 400 });
    }

    let signature: string;
    try {
      signature = await mintAsset(walletAddress, amountUsd);
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Не удалось выпустить долю после оплаты."),
        stage: "mint",
      }, { status: 502 });
    }

    try {
      const purchase = await appendPurchase(walletAddress, {
        assetId: DEMO_OFFICE_ASSET.id,
        amountUsd,
        units: amountUsd,
        paymentSignature,
        mintSignature: signature,
        at: Date.now(),
      });
      return NextResponse.json({ signature: purchase.mintSignature, explorerUrl: explorerUrl(purchase.mintSignature), units: purchase.units });
    } catch (error) {
      return NextResponse.json({
        error: safeError(error, "Доля выпущена, но не удалось сохранить покупку."),
        stage: "ledger",
      }, { status: 500 });
    }
  });
}
