import "server-only";

import { NextResponse } from "next/server";
import { getMeteoraDemoAssetMetadata } from "@/lib/meteora-devnet";
import { readRwaDemoConfig } from "@/lib/rwa-demo-config";
import { RWA_DEMO_ASSET_ID, RWA_DEMO_NETWORK, RWA_DEMO_SWAP_DISCLOSURE } from "@/lib/rwa-demo";

export const runtime = "nodejs";

const ASSET_DESCRIPTION = "Devnet test token used only for the RWA-DEMO Meteora DLMM demonstration.";
const ASSET_DISCLOSURE = "RWA-DEMO and QUOTE-DEMO are Devnet test tokens only. They have no monetary value, real-asset backing, or legal rights.";

function assetResponse({
  configured,
  quoteDecimals,
  rwaDecimals,
  quoteMint,
  rwaMint,
  poolAddress,
}: {
  configured: boolean;
  quoteDecimals: number;
  rwaDecimals: number;
  quoteMint: string | null;
  rwaMint: string | null;
  poolAddress: string | null;
}) {
  return {
    id: RWA_DEMO_ASSET_ID,
    name: "RWA-DEMO",
    symbol: "RWA-DEMO",
    description: ASSET_DESCRIPTION,
    network: RWA_DEMO_NETWORK,
    mintAddress: rwaMint,
    quoteMintAddress: quoteMint,
    poolAddress,
    decimals: rwaDecimals,
    quoteDecimals,
    tokenProgram: "spl-token",
    demo: true,
    tradeEnabled: configured,
    rightsDisclosure: RWA_DEMO_SWAP_DISCLOSURE,
    explorerUrl: rwaMint ? `https://explorer.solana.com/address/${rwaMint}?cluster=devnet` : null,
    quoteMintExplorerUrl: quoteMint ? `https://explorer.solana.com/address/${quoteMint}?cluster=devnet` : null,
    poolExplorerUrl: poolAddress ? `https://explorer.solana.com/address/${poolAddress}?cluster=devnet` : null,
  };
}

export async function GET() {
  const config = readRwaDemoConfig();
  const fallback = assetResponse({
    configured: false,
    quoteDecimals: config.quoteDecimals,
    rwaDecimals: 0,
    quoteMint: null,
    rwaMint: null,
    poolAddress: null,
  });
  // Never perform an RPC call for a disabled or incomplete configuration.
  if (!config.enabled || config.configurationError || config.cluster !== RWA_DEMO_NETWORK
    || !config.rpcUrl || !config.quoteMint || !config.rwaMint || !config.pool) {
    return NextResponse.json({ configured: false, assets: [fallback], disclosure: ASSET_DISCLOSURE });
  }

  try {
    const metadata = await getMeteoraDemoAssetMetadata();
    return NextResponse.json({
      configured: true,
      assets: [assetResponse({
        configured: true,
        quoteDecimals: metadata.quoteDecimals,
        rwaDecimals: metadata.rwaDecimals,
        quoteMint: metadata.quoteMint,
        rwaMint: metadata.rwaMint,
        poolAddress: metadata.poolAddress,
      })],
      disclosure: ASSET_DISCLOSURE,
    });
  } catch {
    // The endpoint deliberately fails closed without exposing configuration or
    // RPC details to unauthenticated callers.
    return NextResponse.json({ configured: false, assets: [fallback], disclosure: ASSET_DISCLOSURE });
  }
}
