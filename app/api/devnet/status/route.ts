import "server-only";

import { NextResponse } from "next/server";
import { devnetConfig, getKzteReserveStatus } from "@/lib/solana-server";

export async function GET() {
  let treasury: string | null = null;
  let kzteReserve: number | null = null;
  let kzteSupply: number | null = null;
  if (devnetConfig.configured) {
    try {
      treasury = await devnetConfig.treasury();
    } catch {
      treasury = null;
    }
    try {
      ({ kzteReserve, kzteSupply } = await getKzteReserveStatus());
    } catch {
      kzteReserve = null;
      kzteSupply = null;
    }
  }
  return NextResponse.json({
    configured: devnetConfig.configured && Boolean(treasury),
    usdMint: devnetConfig.usdMint || null,
    assetMint: devnetConfig.assetMint || null,
    vaultUsdyMint: devnetConfig.vaultUsdyMint || null,
    vaultKzgbMint: devnetConfig.vaultKzgbMint || null,
    kzteMint: devnetConfig.kzteMint || null,
    kzteReserve,
    kzteSupply,
    treasury,
    treasuryOwner: devnetConfig.authority?.publicKey.toBase58() ?? null,
  });
}
