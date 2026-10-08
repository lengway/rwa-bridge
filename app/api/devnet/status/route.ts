import "server-only";

import { NextResponse } from "next/server";
import { devnetConfig } from "@/lib/solana-server";

export async function GET() {
  let treasury: string | null = null;
  if (devnetConfig.configured) {
    try {
      treasury = await devnetConfig.treasury();
    } catch {
      treasury = null;
    }
  }
  return NextResponse.json({
    configured: devnetConfig.configured && Boolean(treasury),
    usdMint: devnetConfig.usdMint || null,
    assetMint: devnetConfig.assetMint || null,
    vaultUsdyMint: devnetConfig.vaultUsdyMint || null,
    vaultKzgbMint: devnetConfig.vaultKzgbMint || null,
    treasury,
    treasuryOwner: devnetConfig.authority?.publicKey.toBase58() ?? null,
  });
}
