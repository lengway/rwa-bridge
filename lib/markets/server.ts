import "server-only";

import { PublicKey } from "@solana/web3.js";

import { PLAIN_MARKETS_PROGRAM_ID } from "./client";
import { DEMO_HOLDER_LABELS, DevnetIssuer, demoHolders, parseSecretKey } from "./devnet-issuer";
import { DevnetLedger, type DevnetMarketsConfig, type MarketsPublicConfig } from "./devnet-service";

/**
 * Plain Markets server configuration.
 *
 *   MARKETS_MODE              devnet | mock (default mock)
 *   MARKETS_ISSUER_SECRET     issuer secret key (JSON array or base58). Server only. Without it the
 *                             console is read-only.
 *   MARKETS_ISSUER            issuer public key to list instruments for (read-only deployments)
 *   MARKETS_INSTRUMENT_MINT   comma-separated bond mints to show (default: the issuer's, newest first)
 *   MARKETS_RPC_URL           RPC used by the server (may carry an API key)
 *   MARKETS_PUBLIC_RPC_URL    RPC the browser reads from (default: public devnet)
 */

const PUBLIC_DEVNET = "https://api.devnet.solana.com";

function issuerKeypair() {
  try {
    return parseSecretKey(process.env.MARKETS_ISSUER_SECRET);
  } catch (error) {
    console.error("[markets] MARKETS_ISSUER_SECRET is invalid:", error instanceof Error ? error.message : error);
    return null;
  }
}

function validKey(value: string | undefined) {
  if (!value) return null;
  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    return null;
  }
}

export function marketsPublicConfig(): MarketsPublicConfig {
  if (process.env.MARKETS_MODE !== "devnet") return { mode: "mock" };
  const issuer = issuerKeypair();
  const holders = issuer ? demoHolders(issuer) : [];
  return {
    mode: "devnet",
    rpcUrl: process.env.MARKETS_PUBLIC_RPC_URL || PUBLIC_DEVNET,
    programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
    issuer: issuer?.publicKey.toBase58() ?? validKey(process.env.MARKETS_ISSUER),
    mints: (process.env.MARKETS_INSTRUMENT_MINT ?? "").split(",").map((m) => validKey(m)).filter((m): m is string => !!m),
    directory: [
      ...(issuer ? [{ address: issuer.publicKey.toBase58(), label: "Issuer treasury", custody: "custodian" as const }] : []),
      ...holders.map((k, i) => ({ address: k.publicKey.toBase58(), label: DEMO_HOLDER_LABELS[i] ?? `Demo holder ${i + 1}`, custody: (DEMO_HOLDER_LABELS[i] ?? "").includes("smart wallet") ? ("smart-wallet" as const) : ("custodian" as const) })),
    ],
    settlementSymbol: "USD",
    writable: !!issuer,
    apiBase: "/api/markets",
  };
}

let server: { ledger: DevnetLedger; issuer: DevnetIssuer } | null = null;

/** The server's ledger + issuer, or null when devnet writes are not configured. */
export function marketsServer() {
  if (server) return server;
  const config = marketsPublicConfig();
  const key = issuerKeypair();
  if (config.mode !== "devnet" || !key) return null;
  const serverConfig: DevnetMarketsConfig = { ...config, rpcUrl: process.env.MARKETS_RPC_URL || config.rpcUrl };
  const ledger = new DevnetLedger(serverConfig, null, { poll: false });
  server = { ledger, issuer: new DevnetIssuer(ledger, key) };
  return server;
}
