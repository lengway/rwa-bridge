import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, isValidWalletAddress, unavailableResponse } from "@/lib/devnet-route";
import { getWalletTokenBalances } from "@/lib/solana-server";

export async function GET(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!isValidWalletAddress(wallet)) {
    return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  }
  try {
    return NextResponse.json(await getWalletTokenBalances(wallet));
  } catch {
    return NextResponse.json({ error: "Couldn't read the Solana devnet balance." }, { status: 502 });
  }
}
