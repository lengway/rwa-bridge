import "server-only";

import { createHmac } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { isCanonicalDevnetTarget, RWA_DEMO_NETWORK, tokenScale } from "@/lib/rwa-demo";

export { SOLANA_DEVNET_GENESIS_HASH } from "@/lib/rwa-demo";

const DEFAULT_KZT_PER_QUOTE_TOKEN = BigInt(500);
const DEFAULT_FUNDING_MAX_KZT = BigInt(1_000_000);
const DEFAULT_FAUCET_MAX_QUOTE_TOKENS = BigInt(1_000);
const DEFAULT_FAUCET_DAILY_MAX_QUOTE_TOKENS = BigInt(10_000);
const DEFAULT_SWAP_SLIPPAGE_BPS = 100;

export class RwaDemoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RwaDemoConfigError";
  }
}

type PublicDemoConfig = {
  enabled: boolean;
  faucetEnabled: boolean;
  /**
   * True when the configured quote mint is owned and funded outside this
   * service (for example, Devnet USDC). In this mode this application must
   * never present, record, or execute a fiat-style top-up/faucet flow.
   */
  externalQuoteMint: boolean;
  quoteSymbol: string;
  cluster: string | null;
  rpcUrl: string | null;
  quoteMint: PublicKey | null;
  rwaMint: PublicKey | null;
  pool: PublicKey | null;
  quoteDecimals: number;
  kztPerQuoteToken: bigint;
  fundingMaxKzt: bigint;
  faucetMaxQuoteAtomic: bigint;
  faucetDailyMaxQuoteAtomic: bigint;
  swapSlippageBps: number;
  payerKeypairPath: string | null;
  configurationError: string | null;
};

export type ConfiguredRwaDemoConfig = Omit<PublicDemoConfig, "quoteMint" | "rwaMint" | "pool" | "rpcUrl" | "cluster"> & {
  cluster: "devnet";
  rpcUrl: string;
  quoteMint: PublicKey;
  rwaMint: PublicKey;
  pool: PublicKey;
};

function nonEmptyEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

function readBooleanEnv(name: string, fallback = false) {
  const raw = nonEmptyEnv(name);
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new RwaDemoConfigError(`${name} must be either true or false.`);
}

function readQuoteSymbol(externalQuoteMint: boolean) {
  const fallback = externalQuoteMint ? "USDC" : "QUOTE-DEMO";
  const raw = nonEmptyEnv("DEVNET_QUOTE_SYMBOL") ?? fallback;
  // Keep this value safe to surface in responses and UI copy. It is a label,
  // not token metadata, and must not be used as an on-chain identifier.
  if (!/^[A-Z][A-Z0-9._-]{0,14}$/.test(raw)) {
    throw new RwaDemoConfigError("DEVNET_QUOTE_SYMBOL must be an uppercase token symbol up to 15 characters.");
  }
  return raw;
}

function readPositiveBigInt(name: string, fallback: bigint) {
  const raw = nonEmptyEnv(name);
  if (!raw) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new RwaDemoConfigError(`${name} must be a positive integer.`);
  return BigInt(raw);
}

function readInteger(name: string, fallback: number, min: number, max: number) {
  const raw = nonEmptyEnv(name);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new RwaDemoConfigError(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RwaDemoConfigError(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function readPublicKey(name: string) {
  const raw = nonEmptyEnv(name);
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    throw new RwaDemoConfigError(`${name} is not a valid Solana public key.`);
  }
}

/**
 * Reads only non-secret demo settings. This intentionally never defaults a
 * cluster or RPC endpoint: an enabled demo without an explicit Devnet target is
 * unavailable instead of silently selecting another network.
 */
export function readRwaDemoConfig(): PublicDemoConfig {
  const enabled = process.env.ENABLE_DEVNET_DEMO === "true";
  // Use conservative fallbacks in the invalid-config path so a malformed
  // external-token configuration can never make the faucet appear available.
  const externalQuoteMintFallback = process.env.DEVNET_EXTERNAL_QUOTE_MINT === "true";
  const requestedFaucetEnabled = enabled && process.env.ENABLE_DEVNET_FAUCET === "true";
  const faucetEnabled = requestedFaucetEnabled && !externalQuoteMintFallback;
  const cluster = nonEmptyEnv("SOLANA_CLUSTER");
  const rpcUrl = nonEmptyEnv("SOLANA_RPC_URL");
  const payerKeypairPath = nonEmptyEnv("DEVNET_PAYER_KEYPAIR_PATH");

  try {
    const externalQuoteMint = readBooleanEnv("DEVNET_EXTERNAL_QUOTE_MINT");
    const quoteSymbol = readQuoteSymbol(externalQuoteMint);
    if (externalQuoteMint && requestedFaucetEnabled) {
      throw new RwaDemoConfigError("ENABLE_DEVNET_FAUCET cannot be enabled when DEVNET_EXTERNAL_QUOTE_MINT=true.");
    }
    const quoteDecimals = readInteger("DEVNET_QUOTE_DECIMALS", 6, 0, 18);
    const faucetMaxQuoteTokens = readPositiveBigInt(
      "DEMO_FAUCET_MAX_QUOTE_TOKENS",
      DEFAULT_FAUCET_MAX_QUOTE_TOKENS,
    );
    const faucetDailyMaxQuoteTokens = readPositiveBigInt(
      "DEMO_FAUCET_DAILY_MAX_QUOTE_TOKENS",
      DEFAULT_FAUCET_DAILY_MAX_QUOTE_TOKENS,
    );
    const faucetMaxQuoteAtomic = faucetMaxQuoteTokens * tokenScale(quoteDecimals);
    const faucetDailyMaxQuoteAtomic = faucetDailyMaxQuoteTokens * tokenScale(quoteDecimals);
    if (faucetMaxQuoteAtomic > faucetDailyMaxQuoteAtomic) {
      throw new RwaDemoConfigError("DEMO_FAUCET_MAX_QUOTE_TOKENS cannot exceed the daily faucet cap.");
    }
    return {
      enabled,
      faucetEnabled,
      externalQuoteMint,
      quoteSymbol,
      cluster,
      rpcUrl,
      quoteMint: readPublicKey("DEVNET_QUOTE_MINT"),
      rwaMint: readPublicKey("DEVNET_RWA_MINT"),
      pool: readPublicKey("DEVNET_METEORA_POOL"),
      quoteDecimals,
      kztPerQuoteToken: readPositiveBigInt("DEMO_KZT_PER_QUOTE_TOKEN", DEFAULT_KZT_PER_QUOTE_TOKEN),
      fundingMaxKzt: readPositiveBigInt("DEMO_FUNDING_MAX_KZT", DEFAULT_FUNDING_MAX_KZT),
      faucetMaxQuoteAtomic,
      faucetDailyMaxQuoteAtomic,
      swapSlippageBps: readInteger("DEMO_SWAP_SLIPPAGE_BPS", DEFAULT_SWAP_SLIPPAGE_BPS, 1, 10_000),
      payerKeypairPath,
      configurationError: null,
    };
  } catch (error) {
    return {
      enabled,
      faucetEnabled,
      externalQuoteMint: externalQuoteMintFallback,
      quoteSymbol: externalQuoteMintFallback ? "USDC" : "QUOTE-DEMO",
      cluster,
      rpcUrl,
      quoteMint: null,
      rwaMint: null,
      pool: null,
      quoteDecimals: 6,
      kztPerQuoteToken: DEFAULT_KZT_PER_QUOTE_TOKEN,
      fundingMaxKzt: DEFAULT_FUNDING_MAX_KZT,
      faucetMaxQuoteAtomic: DEFAULT_FAUCET_MAX_QUOTE_TOKENS * tokenScale(6),
      faucetDailyMaxQuoteAtomic: DEFAULT_FAUCET_DAILY_MAX_QUOTE_TOKENS * tokenScale(6),
      swapSlippageBps: DEFAULT_SWAP_SLIPPAGE_BPS,
      payerKeypairPath,
      configurationError: error instanceof Error ? error.message : "Invalid RWA demo configuration.",
    };
  }
}

export function requireRwaDemoConfig(): ConfiguredRwaDemoConfig {
  const config = readRwaDemoConfig();
  if (!config.enabled) throw new RwaDemoConfigError("ENABLE_DEVNET_DEMO=true is required.");
  if (config.cluster !== RWA_DEMO_NETWORK) throw new RwaDemoConfigError("SOLANA_CLUSTER must be explicitly set to devnet.");
  if (!config.rpcUrl) throw new RwaDemoConfigError("SOLANA_RPC_URL is required for the Devnet demo.");
  if (config.configurationError) throw new RwaDemoConfigError(config.configurationError);
  if (!config.quoteMint || !config.rwaMint || !config.pool) {
    throw new RwaDemoConfigError("Configure DEVNET_QUOTE_MINT, DEVNET_RWA_MINT, and DEVNET_METEORA_POOL first.");
  }
  return {
    ...config,
    cluster: RWA_DEMO_NETWORK,
    rpcUrl: config.rpcUrl,
    quoteMint: config.quoteMint,
    rwaMint: config.rwaMint,
    pool: config.pool,
  };
}

export function createRwaDemoConnection(config = requireRwaDemoConfig()) {
  return new Connection(config.rpcUrl, "confirmed");
}

const verifiedRpcUntil = new Map<string, number>();
const RPC_VERIFICATION_TTL_MS = 60_000;

export async function assertDevnetRpc(
  connection: Connection,
  config = requireRwaDemoConfig(),
) {
  const now = Date.now();
  const verifiedUntil = verifiedRpcUntil.get(config.rpcUrl) ?? 0;
  if (verifiedUntil > now) return;
  let genesisHash: string;
  try {
    genesisHash = await connection.getGenesisHash();
  } catch {
    throw new RwaDemoConfigError("Unable to verify the configured Solana RPC cluster.");
  }
  if (!isCanonicalDevnetTarget(config.cluster, genesisHash)) {
    throw new RwaDemoConfigError("Configured Solana RPC is not canonical Solana Devnet.");
  }
  verifiedRpcUntil.set(config.rpcUrl, now + RPC_VERIFICATION_TTL_MS);
}

export async function getVerifiedRwaDemoConnection() {
  const config = requireRwaDemoConfig();
  const connection = createRwaDemoConnection(config);
  await assertDevnetRpc(connection, config);
  return { config, connection };
}

function resolvePayerPath(config: ConfiguredRwaDemoConfig) {
  if (!config.payerKeypairPath) {
    throw new RwaDemoConfigError("DEVNET_PAYER_KEYPAIR_PATH is required while the Devnet faucet is enabled.");
  }
  return path.isAbsolute(config.payerKeypairPath)
    ? config.payerKeypairPath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), config.payerKeypairPath);
}

export async function loadRwaDemoPayer(config = requireRwaDemoConfig()) {
  const payerPath = resolvePayerPath(config);
  try {
    const metadata = await lstat(payerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new RwaDemoConfigError("Devnet payer keypair path must be a regular file, not a directory or symlink.");
    }
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new RwaDemoConfigError("Devnet payer keypair file permissions must restrict access to its owner.");
    }
  } catch (error) {
    if (error instanceof RwaDemoConfigError) throw error;
    throw new RwaDemoConfigError("Devnet payer keypair file could not be inspected.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(payerPath, "utf8"));
  } catch {
    throw new RwaDemoConfigError("Devnet payer keypair file could not be loaded.");
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new RwaDemoConfigError("Devnet payer keypair file has an invalid format.");
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {
    throw new RwaDemoConfigError("Devnet payer keypair file is invalid.");
  }
}

export async function mintConfiguredQuoteDemo({
  walletAddress,
  amountAtomic,
}: {
  walletAddress: string;
  amountAtomic: bigint;
}) {
  const { config, connection } = await getVerifiedRwaDemoConnection();
  if (config.externalQuoteMint) {
    throw new RwaDemoConfigError("Externally issued quote tokens cannot be minted by this service.");
  }
  if (!config.faucetEnabled) {
    throw new RwaDemoConfigError("ENABLE_DEVNET_FAUCET=true is required for the Devnet test-token faucet.");
  }
  if (amountAtomic <= BigInt(0) || amountAtomic > config.faucetMaxQuoteAtomic) {
    throw new RwaDemoConfigError("Requested test-token amount is outside the configured faucet limit.");
  }
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletAddress);
  } catch {
    throw new RwaDemoConfigError("Recipient wallet is invalid.");
  }
  const payer = await loadRwaDemoPayer(config);
  const quoteMintInfo = await getMint(connection, config.quoteMint, "confirmed", TOKEN_PROGRAM_ID);
  if (!quoteMintInfo.mintAuthority?.equals(payer.publicKey)) {
    throw new RwaDemoConfigError("The configured payer is not the authority for DEVNET_QUOTE_MINT.");
  }
  const destination = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    config.quoteMint,
    wallet,
    true,
    "confirmed",
    undefined,
    TOKEN_PROGRAM_ID,
  );
  return mintTo(
    connection,
    payer,
    config.quoteMint,
    destination.address,
    payer,
    amountAtomic,
    [],
    undefined,
    TOKEN_PROGRAM_ID,
  );
}

export function requestClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const candidate = request.headers.get("cf-connecting-ip")?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || forwarded
    || "unknown";
  return candidate.slice(0, 200) || "unknown";
}

/** Store only a keyed IP digest in the ledger audit trail. */
export function hashDemoRequestIp(request: Request) {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) throw new RwaDemoConfigError("Server session secret is required for demo faucet rate limiting.");
  return createHmac("sha256", secret).update(requestClientIp(request)).digest("hex");
}

export function demoExplorerAddressUrl(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function demoExplorerTransactionUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
