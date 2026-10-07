import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import { devnetDeposits } from "@/lib/devnet-state";
import { explorerUrl, sendFromTreasury } from "@/lib/solana-server";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    productId?: unknown;
    principalUsd?: unknown;
    earnedUsd?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  if (typeof body?.productId !== "string" || body.productId.length < 1 || body.productId.length > 80) {
    return NextResponse.json({ error: "Укажите продукт дохода." }, { status: 400 });
  }
  const principal = body?.principalUsd;
  const earned = body?.earnedUsd;
  if (typeof principal !== "number" || !Number.isFinite(principal) || principal < 0 || principal > 10000) {
    return NextResponse.json({ error: "Сумма вклада должна быть от $0 до $10 000." }, { status: 400 });
  }
  if (typeof earned !== "number" || !Number.isFinite(earned) || earned < 0 || earned > principal * 0.25) {
    return NextResponse.json({ error: "Начисление не может превышать 25% от суммы вклада." }, { status: 400 });
  }
  const amountUsd = principal + earned;
  if (amountUsd <= 0) {
    return NextResponse.json({ error: "Сумма вывода должна быть больше $0." }, { status: 400 });
  }

  const depositKey = `${body.walletAddress}:${body.productId}`;
  const recordedDeposit = devnetDeposits.get(depositKey);
  // A server restart clears this devnet-only guard; withdrawals without a record remain allowed for the demo.
  if (recordedDeposit !== undefined && principal > recordedDeposit + 0.000001) {
    return NextResponse.json({ error: "Сумма основного вклада превышает подтверждённые пополнения." }, { status: 400 });
  }

  try {
    const signature = await sendFromTreasury(body.walletAddress, amountUsd);
    if (recordedDeposit !== undefined) {
      devnetDeposits.set(depositKey, Math.max(0, recordedDeposit - principal));
    }
    return NextResponse.json({ signature, explorerUrl: explorerUrl(signature), amountUsd });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось вернуть тестовые доллары из казначейства."),
    }, { status: 502 });
  }
}
