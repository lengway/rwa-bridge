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

  try {
    await verifyIncomingPayment({ signature: body.signature, fromOwner: body.walletAddress, minAmountUi: body.amountUsd });
    const signature = await mintAsset(body.walletAddress, body.amountUsd);
    return NextResponse.json({ signature, explorerUrl: explorerUrl(signature), units: body.amountUsd });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось подтвердить покупку в Solana devnet."),
    }, { status: 400 });
  }
}
