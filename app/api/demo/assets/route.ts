import "server-only";

import { NextResponse } from "next/server";
import { getMeteoraDemoAssetMetadata } from "@/lib/meteora-devnet";
import { readRwaDemoConfig } from "@/lib/rwa-demo-config";
import { RWA_DEMO_ASSET_ID, RWA_DEMO_NETWORK, RWA_DEMO_SWAP_DISCLOSURE } from "@/lib/rwa-demo";

export const runtime = "nodejs";

const ASSET_DESCRIPTION = "Solana Devnet test token for a Meteora DLMM swap. It has no monetary value, real-asset backing, or legal rights.";

function assetDisclosure({
  externalQuoteMint,
  quoteSymbol,
}: {
  externalQuoteMint: boolean;
  quoteSymbol: string;
}) {
  if (externalQuoteMint) {
    return `The RWA Devnet test asset has no real-asset backing or legal rights. ${quoteSymbol} is supplied externally on Solana Devnet; this app does not sell, issue, redeem, or pay out fiat.`;
  }
  return `The RWA Devnet test asset and ${quoteSymbol} are Solana Devnet test tokens only. They have no monetary value, real-asset backing, or legal rights.`;
}

function assetResponse({
  configured,
  externalQuoteMint,
  quoteSymbol,
  quoteDecimals,
  rwaDecimals,
  quoteMint,
  rwaMint,
  poolAddress,
}: {
  configured: boolean;
  externalQuoteMint: boolean;
  quoteSymbol: string;
  quoteDecimals: number;
  rwaDecimals: number;
  quoteMint: string | null;
  rwaMint: string | null;
  poolAddress: string | null;
}) {
  return {
    id: RWA_DEMO_ASSET_ID,
    name: "RWA Devnet Test Asset",
    symbol: "RWA-DEVNET",
    description: ASSET_DESCRIPTION,
    network: RWA_DEMO_NETWORK,
    mintAddress: rwaMint,
    quoteMintAddress: quoteMint,
    quoteSymbol,
    externalQuoteMint,
    poolAddress,
    decimals: rwaDecimals,
    quoteDecimals,
    tokenProgram: "spl-token",
    isDevnetTest: true,
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
    externalQuoteMint: config.externalQuoteMint,
    quoteSymbol: config.quoteSymbol,
    quoteDecimals: config.quoteDecimals,
    rwaDecimals: 0,
    quoteMint: null,
    rwaMint: null,
    poolAddress: null,
  });
  // Never perform an RPC call for a disabled or incomplete configuration.
  if (!config.enabled || config.configurationError || config.cluster !== RWA_DEMO_NETWORK
    || !config.rpcUrl || !config.quoteMint || !config.rwaMint || !config.pool) {
    return NextResponse.json({
      configured: false,
      assets: [fallback],
      disclosure: assetDisclosure(config),
    });
  }

  try {
    const metadata = await getMeteoraDemoAssetMetadata();
    return NextResponse.json({
      configured: true,
      assets: [assetResponse({
        configured: true,
        externalQuoteMint: config.externalQuoteMint,
        quoteSymbol: config.quoteSymbol,
        quoteDecimals: metadata.quoteDecimals,
        rwaDecimals: metadata.rwaDecimals,
        quoteMint: metadata.quoteMint,
        rwaMint: metadata.rwaMint,
        poolAddress: metadata.poolAddress,
      })],
      disclosure: assetDisclosure(config),
    });
  } catch {
    // The endpoint deliberately fails closed without exposing configuration or
    // RPC details to unauthenticated callers.
    return NextResponse.json({
      configured: false,
      assets: [fallback],
      disclosure: assetDisclosure(config),
    });
  }
}
