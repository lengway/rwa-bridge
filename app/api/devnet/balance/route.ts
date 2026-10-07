import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, isValidWalletAddress, unavailableResponse } from "@/lib/devnet-route";
import { getWalletTokenBalances } from "@/lib/solana-server";

export async function GET(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!isValidWalletAddress(wallet)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getWalletTokenBalances(wallet));
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать баланс Solana devnet." }, { status: 502 });
  }
}
