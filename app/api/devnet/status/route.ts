import "server-only";

import { NextResponse } from "next/server";
import { createReadCoalescer } from "@/lib/read-coalescer";
import {
  assertLegacyDevnetWriteAllowed,
  devnetConfig,
  getKzteReserveStatus,
} from "@/lib/solana-server";

/**
 * Crossmint selects a production wallet network from a production key. The
 * legacy SPL-transfer UI must never offer a transaction unless it can prove
 * both sides are Devnet: a staging wallet key and a canonical Devnet RPC.
 */
function hasStagingCrossmintWalletKey() {
  return (process.env.NEXT_PUBLIC_CROSSMINT_API_KEY ?? "").startsWith("ck_staging_");
}

const statusReads = createReadCoalescer<Awaited<ReturnType<typeof readStatus>>>(60_000, 10_000);
export async function GET() {
  return NextResponse.json(await statusReads("status", readStatus), { headers: { "Cache-Control": "no-store" } });
}

async function readStatus() {
  let treasury: string | null = null;
  let kzteReserve: number | null = null;
  let kzteSupply: number | null = null;
  let configured = false;

  // Do this read-only check before exposing a mint/treasury to a browser
  // wallet. Otherwise a production wallet could sign a transfer before the
  // later server-side signer guard has a chance to reject its follow-up call.
  if (
    devnetConfig.configured
    && process.env.SOLANA_CLUSTER === "devnet"
    && hasStagingCrossmintWalletKey()
  ) {
    try {
      await assertLegacyDevnetWriteAllowed();
      treasury = await devnetConfig.treasury();
      configured = Boolean(treasury);
    } catch {
      treasury = null;
    }
    if (configured) {
      try {
        ({ kzteReserve, kzteSupply } = await getKzteReserveStatus());
      } catch {
        kzteReserve = null;
        kzteSupply = null;
      }
    }
  }
  return {
    configured,
    legacyFaucetEnabled: configured && process.env.ENABLE_LEGACY_DEVNET_FAUCET === "true",
    usdMint: configured ? devnetConfig.usdMint || null : null,
    assetMint: configured ? devnetConfig.assetMint || null : null,
    vaultUsdyMint: configured ? devnetConfig.vaultUsdyMint || null : null,
    vaultKzgbMint: configured ? devnetConfig.vaultKzgbMint || null : null,
    kzteMint: configured ? devnetConfig.kzteMint || null : null,
    kzteReserve,
    kzteSupply,
    treasury,
    treasuryOwner: configured ? devnetConfig.authority?.publicKey.toBase58() ?? null : null,
  };
}
