import { readFile, lstat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import DLMM, {
  CollectFeeMode,
  ConcreteFunctionType,
  StrategyType,
} from "@meteora-ag/dlmm";
import {
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createMint,
  mintTo,
  TOKEN_PROGRAM_ID,
  type Account,
  type Mint,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  type ConfirmOptions,
  type Transaction,
} from "@solana/web3.js";
import BN from "bn.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const ENV_LOCAL_PATH = resolve(PROJECT_ROOT, ".env.local");
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAX_U64 = BigInt("18446744073709551615");
const DEFAULT_TOKEN_DECIMALS = 6;
const DEFAULT_MIN_PAYER_SOL = "0.5";
const DEFAULT_QUOTE_LIQUIDITY = "1000000";
const DEFAULT_RWA_LIQUIDITY = "10000";
const DEFAULT_QUOTE_PER_RWA = "100";
const DEFAULT_LIQUIDITY_RANGE_BINS = 10;

type BlockerKind =
  | "MISSING_CONFIG"
  | "RPC_BLOCKER"
  | "SDK_BLOCKER"
  | "REPO_BLOCKER";

class BootstrapError extends Error {
  constructor(
    readonly kind: BlockerKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BootstrapError";
  }
}

type Environment = Record<string, string>;

type BootstrapConfig = {
  rpcUrl: string;
  payerKeypairPath: string;
  publicConfigPath: string;
  externalQuoteMint: boolean;
  quoteMintAddress: string | null;
  rwaMintAddress: string | null;
  poolAddress: string | null;
  positionAddress: string | null;
  presetAddress: string | null;
  quoteDecimals: number;
  minPayerLamports: bigint;
  quoteLiquidityUi: string;
  rwaLiquidityUi: string;
  quotePerRwa: number;
  liquidityRangeBins: number;
  writePublicConfig: boolean;
};

type MintSetup = {
  label: "QUOTE-DEMO" | "RWA-DEMO";
  address: PublicKey;
  mint: Mint;
  created: boolean;
  /**
   * A deliberately configured third-party Devnet quote mint. It is never
   * created or minted by this bootstrap script.
   */
  externalQuoteMint: boolean;
};

type SeededPosition = {
  publicKey: PublicKey;
  totalXAmount: bigint;
  totalYAmount: bigint;
  created: boolean;
  signature: string | null;
};

type PresetParameter2 = Awaited<ReturnType<typeof DLMM.getAllPresetParameters>>["presetParameter2"][number];
type PayerPosition = Awaited<ReturnType<DLMM["getPositionsByUserAndLbPair"]>>["userPositions"][number];

function explorerAddress(address: PublicKey) {
  return `https://explorer.solana.com/address/${address.toBase58()}?cluster=devnet`;
}

function explorerTransaction(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function trimOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function removeQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function readLocalEnvironment(): Promise<Environment> {
  let contents = "";
  try {
    contents = await readFile(ENV_LOCAL_PATH, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw new BootstrapError("REPO_BLOCKER", `Could not read ${ENV_LOCAL_PATH}.`, error);
  }

  const values: Environment = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = removeQuotes(match[2].trim());
  }
  return values;
}

function environmentValue(environment: Environment, name: string) {
  return trimOptional(process.env[name]) ?? trimOptional(environment[name]);
}

function requiredEnvironmentValue(environment: Environment, name: string) {
  const value = environmentValue(environment, name);
  if (!value) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `Set ${name} explicitly before running this bootstrap script.`,
    );
  }
  return value;
}

function parseBoolean(value: string | null, name: string, defaultValue = false) {
  if (value === null) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new BootstrapError("MISSING_CONFIG", `${name} must be exactly true or false.`);
}

function parseInteger(value: string | null, name: string, defaultValue: number, min: number, max: number) {
  if (value === null) return defaultValue;
  if (!/^\d+$/.test(value)) {
    throw new BootstrapError("MISSING_CONFIG", `${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BootstrapError("MISSING_CONFIG", `${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function parsePositiveUiDecimal(value: string, name: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new BootstrapError("MISSING_CONFIG", `${name} must be a positive decimal value without exponent notation.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BootstrapError("MISSING_CONFIG", `${name} must be a finite positive value.`);
  }
  return parsed;
}

function toAtomicAmount(value: string, decimals: number, name: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new BootstrapError("MISSING_CONFIG", `${name} must be a non-negative decimal amount.`);
  }

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `${name} has more precision than its token mint supports (${decimals} decimals).`,
    );
  }

  const normalizedFraction = fraction.slice(0, decimals).padEnd(decimals, "0");
  const atomic = BigInt(`${whole}${normalizedFraction}`);
  if (atomic <= BigInt(0) || atomic > MAX_U64) {
    throw new BootstrapError("MISSING_CONFIG", `${name} must be greater than zero and fit in a u64.`);
  }
  return atomic;
}

function formatAtomic(amount: bigint, decimals: number) {
  const raw = amount.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return raw;
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function asPublicKey(value: string, name: string) {
  try {
    return new PublicKey(value);
  } catch (error) {
    throw new BootstrapError("MISSING_CONFIG", `${name} is not a valid Solana public key.`, error);
  }
}

function optionalPublicKey(value: string | null, name: string) {
  return value ? asPublicKey(value, name) : null;
}

/**
 * A release can deliberately link .env.local to a shared secret store. Keep
 * the default strict (the project .env.local itself must be a regular file),
 * but let an operator explicitly select a separate, regular target for writing
 * public mint/pool IDs. This avoids creating on-chain resources before a
 * symlink-write failure is discovered.
 */
function resolvePublicConfigPath(value: string | null) {
  if (!value) return ENV_LOCAL_PATH;
  return isAbsolute(value) ? resolve(value) : resolve(PROJECT_ROOT, value);
}

async function loadPayer(pathValue: string) {
  const keypairPath = isAbsolute(pathValue)
    ? resolve(pathValue)
    : resolve(PROJECT_ROOT, pathValue);

  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(keypairPath);
  } catch (error) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `DEVNET_PAYER_KEYPAIR_PATH does not point to a readable keypair file: ${keypairPath}`,
      error,
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      "DEVNET_PAYER_KEYPAIR_PATH must reference a regular local keypair file, not a directory or symlink.",
    );
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `Restrict ${keypairPath} to its owner (for example: chmod 600) before using it.`,
    );
  }

  try {
    const parsed = JSON.parse(await readFile(keypairPath, "utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
      throw new Error("Expected a JSON array of 64 byte values.");
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch (error) {
    throw new BootstrapError("MISSING_CONFIG", "DEVNET_PAYER_KEYPAIR_PATH contains an invalid Solana keypair.", error);
  }
}

function parseConfig(environment: Environment): BootstrapConfig {
  const cluster = requiredEnvironmentValue(environment, "SOLANA_CLUSTER");
  if (cluster !== "devnet") {
    throw new BootstrapError(
      "MISSING_CONFIG",
      "This script only operates when SOLANA_CLUSTER is explicitly set to devnet.",
    );
  }

  const rpcUrl = requiredEnvironmentValue(environment, "SOLANA_RPC_URL");
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
  } catch (error) {
    throw new BootstrapError("MISSING_CONFIG", "SOLANA_RPC_URL must be an http(s) URL.", error);
  }

  const writePublicConfig = parseBoolean(environmentValue(environment, "WRITE_DEVNET_DEMO_CONFIG"), "WRITE_DEVNET_DEMO_CONFIG");
  const externalQuoteMint = parseBoolean(
    environmentValue(environment, "DEVNET_EXTERNAL_QUOTE_MINT"),
    "DEVNET_EXTERNAL_QUOTE_MINT",
  );
  const quoteMintAddress = environmentValue(environment, "DEVNET_QUOTE_MINT");
  const rwaMintAddress = environmentValue(environment, "DEVNET_RWA_MINT");
  if (externalQuoteMint && !quoteMintAddress) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      "DEVNET_EXTERNAL_QUOTE_MINT=true requires DEVNET_QUOTE_MINT to be an existing Devnet SPL Token mint. The bootstrap never creates or mints an external quote token.",
    );
  }
  if ((!quoteMintAddress || !rwaMintAddress) && !writePublicConfig) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      "Set DEVNET_QUOTE_MINT and DEVNET_RWA_MINT, or run with WRITE_DEVNET_DEMO_CONFIG=true so newly created public addresses are persisted safely.",
    );
  }

  const quoteDecimals = parseInteger(
    environmentValue(environment, "DEVNET_QUOTE_DECIMALS"),
    "DEVNET_QUOTE_DECIMALS",
    DEFAULT_TOKEN_DECIMALS,
    0,
    18,
  );
  const minPayerLamports = toAtomicAmount(
    environmentValue(environment, "DEVNET_MIN_PAYER_SOL") ?? DEFAULT_MIN_PAYER_SOL,
    9,
    "DEVNET_MIN_PAYER_SOL",
  );
  const quotePerRwaValue = environmentValue(environment, "DEVNET_INITIAL_QUOTE_PER_RWA") ?? DEFAULT_QUOTE_PER_RWA;

  return {
    rpcUrl,
    payerKeypairPath: requiredEnvironmentValue(environment, "DEVNET_PAYER_KEYPAIR_PATH"),
    publicConfigPath: resolvePublicConfigPath(environmentValue(environment, "DEVNET_PUBLIC_CONFIG_PATH")),
    externalQuoteMint,
    quoteMintAddress,
    rwaMintAddress,
    poolAddress: environmentValue(environment, "DEVNET_METEORA_POOL"),
    positionAddress: environmentValue(environment, "DEVNET_RWA_LP_POSITION"),
    presetAddress: environmentValue(environment, "DEVNET_METEORA_PRESET"),
    quoteDecimals,
    minPayerLamports,
    quoteLiquidityUi: environmentValue(environment, "DEVNET_INITIAL_QUOTE_LIQUIDITY") ?? DEFAULT_QUOTE_LIQUIDITY,
    rwaLiquidityUi: environmentValue(environment, "DEVNET_INITIAL_RWA_LIQUIDITY") ?? DEFAULT_RWA_LIQUIDITY,
    quotePerRwa: parsePositiveUiDecimal(quotePerRwaValue, "DEVNET_INITIAL_QUOTE_PER_RWA"),
    liquidityRangeBins: parseInteger(
      environmentValue(environment, "DEVNET_LIQUIDITY_RANGE_BINS"),
      "DEVNET_LIQUIDITY_RANGE_BINS",
      DEFAULT_LIQUIDITY_RANGE_BINS,
      1,
      700,
    ),
    writePublicConfig,
  };
}

async function verifyDevnet(connection: Connection) {
  let genesisHash: string;
  try {
    genesisHash = await connection.getGenesisHash();
  } catch (error) {
    throw new BootstrapError("RPC_BLOCKER", "Could not query the configured Solana RPC endpoint.", error);
  }
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new BootstrapError(
      "RPC_BLOCKER",
      `Configured RPC is not Solana Devnet (received genesis hash ${genesisHash}).`,
    );
  }
}

async function ensureMinimumSol(connection: Connection, payer: Keypair, minLamports: bigint) {
  let balance: number;
  try {
    balance = await connection.getBalance(payer.publicKey, "confirmed");
  } catch (error) {
    throw new BootstrapError("RPC_BLOCKER", "Could not read the devnet payer SOL balance.", error);
  }
  const balanceAtomic = BigInt(balance);
  if (balanceAtomic < minLamports) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `Devnet payer ${payer.publicKey.toBase58()} has ${formatAtomic(balanceAtomic, 9)} SOL; at least ${formatAtomic(minLamports, 9)} SOL is required. Fund it from https://faucet.solana.com and rerun.`,
    );
  }
  return balanceAtomic;
}

async function ensureMint(
  connection: Connection,
  payer: Keypair,
  label: MintSetup["label"],
  configuredAddress: string | null,
  decimals: number,
  externalQuoteMint = false,
): Promise<MintSetup> {
  const configuredMint = optionalPublicKey(configuredAddress, `DEVNET_${label === "QUOTE-DEMO" ? "QUOTE" : "RWA"}_MINT`);
  if (!configuredMint) {
    if (externalQuoteMint) {
      throw new BootstrapError(
        "MISSING_CONFIG",
        "DEVNET_EXTERNAL_QUOTE_MINT=true requires DEVNET_QUOTE_MINT. The bootstrap will not create an external quote mint.",
      );
    }
    try {
      const address = await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        decimals,
        undefined,
        { commitment: "confirmed", preflightCommitment: "confirmed" },
        TOKEN_PROGRAM_ID,
      );
      const mint = await getMint(connection, address, "confirmed", TOKEN_PROGRAM_ID);
      return { label, address, mint, created: true, externalQuoteMint: false };
    } catch (error) {
      throw new BootstrapError("RPC_BLOCKER", `Could not create the ${label} devnet mint.`, error);
    }
  }

  try {
    const mint = await getMint(connection, configuredMint, "confirmed", TOKEN_PROGRAM_ID);
    return {
      label,
      address: configuredMint,
      mint,
      created: false,
      externalQuoteMint,
    };
  } catch (error) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `Configured ${label} mint ${configuredMint.toBase58()} is not a readable SPL Token mint on Devnet.`,
      error,
    );
  }
}

function requireMintAuthority(mint: MintSetup, payer: Keypair) {
  if (mint.externalQuoteMint) {
    throw new BootstrapError(
      "REPO_BLOCKER",
      "Invariant failed: the bootstrap must never mint an external quote token.",
    );
  }
  if (!mint.mint.mintAuthority?.equals(payer.publicKey)) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `${mint.label} mint authority is not the configured devnet payer. Provide a payer-controlled demo mint or pre-fund its associated token account before seeding.`,
    );
  }
}

function assertQuoteDecimals(quoteMint: MintSetup, expectedDecimals: number) {
  if (quoteMint.mint.decimals !== expectedDecimals) {
    const label = quoteMint.externalQuoteMint ? "external quote" : "QUOTE-DEMO";
    throw new BootstrapError(
      "MISSING_CONFIG",
      `Configured ${label} mint uses ${quoteMint.mint.decimals} decimals, but DEVNET_QUOTE_DECIMALS is ${expectedDecimals}. Align the public configuration before bootstrapping.`,
    );
  }
}

function assertDistinctMints(quoteMint: MintSetup, rwaMint: MintSetup) {
  if (quoteMint.address.equals(rwaMint.address)) {
    throw new BootstrapError("MISSING_CONFIG", "DEVNET_QUOTE_MINT and DEVNET_RWA_MINT must be different SPL Token mints.");
  }
}

/**
 * External quote mode is intentionally read-only: a bootstrap must not create
 * an ATA or mint a third-party Devnet token. Keep this helper separate so it
 * can be called before *any* RWA mint/pool transaction and called again just
 * before liquidity is added, in case the balance changed meanwhile.
 */
async function requireExistingExternalQuoteLiquidity(
  connection: Connection,
  payer: Keypair,
  mint: MintSetup,
  targetAmount: bigint,
) {
  if (!mint.externalQuoteMint) {
    throw new BootstrapError(
      "REPO_BLOCKER",
      "Invariant failed: external quote liquidity checks require an external quote mint.",
    );
  }

  const associatedTokenAddress = await getAssociatedTokenAddress(
    mint.address,
    payer.publicKey,
    false,
    TOKEN_PROGRAM_ID,
  );
  let tokenAccount: Account;
  try {
    // Do not use getOrCreateAssociatedTokenAccount here. In external-quote
    // mode this account must already exist and be funded independently.
    tokenAccount = await getAccount(
      connection,
      associatedTokenAddress,
      "confirmed",
      TOKEN_PROGRAM_ID,
    );
  } catch (error) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `External quote mint ${mint.address.toBase58()} requires the payer's existing ATA ${associatedTokenAddress.toBase58()} to hold at least ${formatAtomic(targetAmount, mint.mint.decimals)} tokens. Fund that ATA outside this bootstrap; it never creates an ATA or mints external quote tokens.`,
      error,
    );
  }

  if (!tokenAccount.owner.equals(payer.publicKey) || !tokenAccount.mint.equals(mint.address)) {
    throw new BootstrapError(
      "REPO_BLOCKER",
      "Derived external quote ATA did not match the configured payer and mint.",
    );
  }
  if (tokenAccount.amount < targetAmount) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `External quote ATA ${associatedTokenAddress.toBase58()} has ${formatAtomic(tokenAccount.amount, mint.mint.decimals)} tokens, but DEVNET_INITIAL_QUOTE_LIQUIDITY requires ${formatAtomic(targetAmount, mint.mint.decimals)}. Fund the payer ATA with the external Devnet token and rerun; the bootstrap never mints external quote tokens.`,
    );
  }
  return tokenAccount;
}

async function ensureTokenBalance(
  connection: Connection,
  payer: Keypair,
  mint: MintSetup,
  targetAmount: bigint,
): Promise<{ account: Account; signature: string | null }> {
  if (mint.externalQuoteMint) {
    return {
      // Recheck immediately before a liquidity transaction to fail safely if
      // a separate process has spent the preflighted balance.
      account: await requireExistingExternalQuoteLiquidity(connection, payer, mint, targetAmount),
      signature: null,
    };
  }

  let tokenAccount: Account;
  try {
    tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint.address,
      payer.publicKey,
      true,
      "confirmed",
      { commitment: "confirmed", preflightCommitment: "confirmed" },
      TOKEN_PROGRAM_ID,
    );
  } catch (error) {
    throw new BootstrapError("RPC_BLOCKER", `Could not create or read the payer ${mint.label} token account.`, error);
  }

  if (tokenAccount.amount >= targetAmount) return { account: tokenAccount, signature: null };
  requireMintAuthority(mint, payer);
  try {
    const signature = await mintTo(
      connection,
      payer,
      mint.address,
      tokenAccount.address,
      payer,
      targetAmount - tokenAccount.amount,
      [],
      { commitment: "confirmed", preflightCommitment: "confirmed" },
      TOKEN_PROGRAM_ID,
    );
    tokenAccount = await getAccount(connection, tokenAccount.address, "confirmed", TOKEN_PROGRAM_ID);
    return { account: tokenAccount, signature };
  } catch (error) {
    throw new BootstrapError("RPC_BLOCKER", `Could not issue ${mint.label} liquidity to the payer token account.`, error);
  }
}

function selectPreset(
  presets: PresetParameter2[],
  configuredAddress: string | null,
) {
  if (configuredAddress) {
    const configuredKey = asPublicKey(configuredAddress, "DEVNET_METEORA_PRESET");
    const preset = presets.find(({ publicKey }) => publicKey.equals(configuredKey));
    if (!preset) {
      throw new BootstrapError(
        "SDK_BLOCKER",
        "DEVNET_METEORA_PRESET was not found in the Devnet preset accounts returned by the current SDK.",
      );
    }
    return preset;
  }

  const candidates = presets
    .filter(({ account }) => (
      account.concreteFunctionType === ConcreteFunctionType.LiquidityMining
      && account.collectFeeMode === CollectFeeMode.InputOnly
      && account.binStep > 0
      && account.baseFactor > 0
      && account.baseFeePowerFactor >= 0
    ))
    .sort((left, right) => (
      left.account.binStep - right.account.binStep
      || left.account.baseFactor - right.account.baseFactor
      || left.account.baseFeePowerFactor - right.account.baseFeePowerFactor
      || left.publicKey.toBase58().localeCompare(right.publicKey.toBase58())
    ));
  const preset = candidates[0];
  if (!preset) {
    throw new BootstrapError(
      "SDK_BLOCKER",
      "No Devnet PresetParameter2 suitable for a liquidity-mining, input-fee DLMM pool was returned by the SDK.",
    );
  }
  return preset;
}

async function fetchDevnetPreset(
  connection: Connection,
  configuredAddress: string | null,
) {
  try {
    const presets = await DLMM.getAllPresetParameters(connection, { cluster: "devnet" });
    return selectPreset(presets.presetParameter2, configuredAddress);
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError("RPC_BLOCKER", "Could not query valid Meteora DLMM Devnet presets.", error);
  }
}

function assertPoolMints(pool: DLMM, quoteMint: PublicKey, rwaMint: PublicKey) {
  const hasQuote = pool.tokenX.publicKey.equals(quoteMint) || pool.tokenY.publicKey.equals(quoteMint);
  const hasRwa = pool.tokenX.publicKey.equals(rwaMint) || pool.tokenY.publicKey.equals(rwaMint);
  if (!hasQuote || !hasRwa) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      `Meteora pool ${pool.pubkey.toBase58()} does not contain the configured QUOTE-DEMO and RWA-DEMO mints.`,
    );
  }
}

async function loadPool(connection: Connection, address: PublicKey, quoteMint: PublicKey, rwaMint: PublicKey) {
  try {
    const pool = await DLMM.create(connection, address, { cluster: "devnet" });
    assertPoolMints(pool, quoteMint, rwaMint);
    return pool;
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError("RPC_BLOCKER", `Could not load Meteora pool ${address.toBase58()} on Devnet.`, error);
  }
}

async function findExistingPool(
  connection: Connection,
  quoteMint: MintSetup,
  rwaMint: MintSetup,
  preset: PresetParameter2,
) {
  try {
    return await DLMM.getPairPubkeyIfExists(
      connection,
      rwaMint.address,
      quoteMint.address,
      new BN(preset.account.binStep),
      new BN(preset.account.baseFactor),
      new BN(preset.account.baseFeePowerFactor),
      preset.account.concreteFunctionType,
      preset.account.collectFeeMode,
      { cluster: "devnet" },
    );
  } catch (error) {
    throw new BootstrapError(
      "RPC_BLOCKER",
      "Could not look up the RWA-DEMO / QUOTE-DEMO Meteora pair on Devnet. The configured RPC must allow the SDK's account lookup.",
      error,
    );
  }
}

async function createOrReusePool(
  connection: Connection,
  payer: Keypair,
  config: BootstrapConfig,
  quoteMint: MintSetup,
  rwaMint: MintSetup,
) {
  const configuredPool = optionalPublicKey(config.poolAddress, "DEVNET_METEORA_POOL");
  if (configuredPool) {
    return { pool: await loadPool(connection, configuredPool, quoteMint.address, rwaMint.address), created: false, signature: null, preset: null };
  }

  const preset = await fetchDevnetPreset(connection, config.presetAddress);
  const opt = { cluster: "devnet" as const };
  const existingPool = await findExistingPool(connection, quoteMint, rwaMint, preset);
  if (existingPool) {
    return { pool: await loadPool(connection, existingPool, quoteMint.address, rwaMint.address), created: false, signature: null, preset };
  }

  const pricePerLamport = DLMM.getPricePerLamport(
    rwaMint.mint.decimals,
    quoteMint.mint.decimals,
    config.quotePerRwa,
  );
  const activeIdNumber = DLMM.getBinIdFromPrice(pricePerLamport, preset.account.binStep, true);
  if (!Number.isSafeInteger(activeIdNumber)) {
    throw new BootstrapError("MISSING_CONFIG", "Initial demo price produces an unsafe Meteora active bin ID.");
  }

  let transaction: Transaction;
  try {
    transaction = await DLMM.createLbPair2(
      connection,
      payer.publicKey,
      rwaMint.address,
      quoteMint.address,
      preset.publicKey,
      new BN(activeIdNumber),
      opt,
    );
  } catch (error) {
    throw new BootstrapError("SDK_BLOCKER", "Meteora SDK could not build the Devnet V2 pool creation transaction.", error);
  }

  let signature: string | null = null;
  try {
    signature = await sendConfirmed(connection, transaction, [payer]);
  } catch (error) {
    const concurrentPool = await findExistingPool(connection, quoteMint, rwaMint, preset).catch(() => null);
    if (!concurrentPool) throw error;
    return { pool: await loadPool(connection, concurrentPool, quoteMint.address, rwaMint.address), created: false, signature: null, preset };
  }

  const createdPool = await findExistingPool(connection, quoteMint, rwaMint, preset);
  if (!createdPool) {
    throw new BootstrapError("RPC_BLOCKER", "Meteora V2 pool transaction confirmed but its pool account could not be found.");
  }
  return {
    pool: await loadPool(connection, createdPool, quoteMint.address, rwaMint.address),
    created: true,
    signature,
    preset,
  };
}

async function getPayerPositions(pool: DLMM, payer: PublicKey) {
  try {
    const result = await pool.getPositionsByUserAndLbPair(payer);
    return result.userPositions;
  } catch (error) {
    throw new BootstrapError("RPC_BLOCKER", "Could not query existing DLMM liquidity positions for the configured payer.", error);
  }
}

function positionTotals(position: PayerPosition) {
  return {
    x: BigInt(position.positionData.totalXAmount.toString()),
    y: BigInt(position.positionData.totalYAmount.toString()),
  };
}

function hasLiquidity(position: PayerPosition) {
  const totals = positionTotals(position);
  return totals.x > BigInt(0) || totals.y > BigInt(0);
}

function findConfiguredPosition(payerPositions: PayerPosition[], positionAddress: string | null) {
  if (!positionAddress) return null;
  const address = asPublicKey(positionAddress, "DEVNET_RWA_LP_POSITION");
  const position = payerPositions.find(({ publicKey }) => publicKey.equals(address));
  if (!position) {
    throw new BootstrapError(
      "MISSING_CONFIG",
      "DEVNET_RWA_LP_POSITION is not a readable position owned by the configured payer in the configured Meteora pool.",
    );
  }
  return position;
}

function seededPositionFrom(position: PayerPosition, created: boolean, signature: string | null): SeededPosition {
  const totals = positionTotals(position);
  return {
    publicKey: position.publicKey,
    totalXAmount: totals.x,
    totalYAmount: totals.y,
    created,
    signature,
  };
}

async function loadPoolPosition(pool: DLMM, address: PublicKey) {
  try {
    return await pool.getPosition(address);
  } catch (error) {
    throw new BootstrapError("RPC_BLOCKER", `Could not reload DLMM position ${address.toBase58()} after its transaction confirmed.`, error);
  }
}

function tokenAmountsForPool(
  pool: DLMM,
  quoteMint: MintSetup,
  rwaMint: MintSetup,
  quoteAmount: bigint,
  rwaAmount: bigint,
) {
  if (pool.tokenX.publicKey.equals(rwaMint.address) && pool.tokenY.publicKey.equals(quoteMint.address)) {
    return { totalXAmount: rwaAmount, totalYAmount: quoteAmount };
  }
  if (pool.tokenX.publicKey.equals(quoteMint.address) && pool.tokenY.publicKey.equals(rwaMint.address)) {
    return { totalXAmount: quoteAmount, totalYAmount: rwaAmount };
  }
  throw new BootstrapError("MISSING_CONFIG", "Loaded pool token order does not match configured demo mints.");
}

async function seedLiquidity(
  connection: Connection,
  payer: Keypair,
  config: BootstrapConfig,
  pool: DLMM,
  quoteMint: MintSetup,
  rwaMint: MintSetup,
): Promise<{ position: SeededPosition; quoteMintSignature: string | null; rwaMintSignature: string | null }> {
  const payerPositions = [...await getPayerPositions(pool, payer.publicKey)]
    .sort((left, right) => left.publicKey.toBase58().localeCompare(right.publicKey.toBase58()));
  const configuredPosition = findConfiguredPosition(payerPositions, config.positionAddress);
  const existingWithLiquidity = configuredPosition ?? payerPositions.find(hasLiquidity);

  if (existingWithLiquidity && hasLiquidity(existingWithLiquidity)) {
    return {
      position: seededPositionFrom(existingWithLiquidity, false, null),
      quoteMintSignature: null,
      rwaMintSignature: null,
    };
  }

  const quoteTarget = toAtomicAmount(config.quoteLiquidityUi, quoteMint.mint.decimals, "DEVNET_INITIAL_QUOTE_LIQUIDITY");
  const rwaTarget = toAtomicAmount(config.rwaLiquidityUi, rwaMint.mint.decimals, "DEVNET_INITIAL_RWA_LIQUIDITY");
  const [quoteFunding, rwaFunding] = await Promise.all([
    ensureTokenBalance(connection, payer, quoteMint, quoteTarget),
    ensureTokenBalance(connection, payer, rwaMint, rwaTarget),
  ]);
  const amounts = tokenAmountsForPool(pool, quoteMint, rwaMint, quoteTarget, rwaTarget);
  const reusablePosition = configuredPosition ?? payerPositions[0] ?? null;

  if (reusablePosition) {
    let transaction: Transaction;
    try {
      transaction = await pool.addLiquidityByStrategy({
        positionPubKey: reusablePosition.publicKey,
        user: payer.publicKey,
        totalXAmount: new BN(amounts.totalXAmount.toString()),
        totalYAmount: new BN(amounts.totalYAmount.toString()),
        strategy: {
          minBinId: reusablePosition.positionData.lowerBinId,
          maxBinId: reusablePosition.positionData.upperBinId,
          strategyType: StrategyType.Spot,
        },
      });
    } catch (error) {
      throw new BootstrapError("SDK_BLOCKER", "Meteora SDK could not build the transaction to seed the existing LP position.", error);
    }
    const signature = await sendConfirmed(connection, transaction, [payer]);
    const position = await loadPoolPosition(pool, reusablePosition.publicKey);
    return {
      position: seededPositionFrom(position, false, signature),
      quoteMintSignature: quoteFunding.signature,
      rwaMintSignature: rwaFunding.signature,
    };
  }

  // A DLMM position is a newly created account and must sign its own creation.
  // This ephemeral account signer is never written to disk and is not a wallet authority.
  const pendingPosition = Keypair.generate();
  let transaction: Transaction;
  try {
    const activeId = pool.lbPair.activeId;
    transaction = await pool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: pendingPosition.publicKey,
      user: payer.publicKey,
      totalXAmount: new BN(amounts.totalXAmount.toString()),
      totalYAmount: new BN(amounts.totalYAmount.toString()),
      strategy: {
        minBinId: activeId - config.liquidityRangeBins,
        maxBinId: activeId + config.liquidityRangeBins,
        strategyType: StrategyType.Spot,
      },
    });
  } catch (error) {
    throw new BootstrapError("SDK_BLOCKER", "Meteora SDK could not build the transaction to initialize and seed the LP position.", error);
  }
  const signature = await sendConfirmed(connection, transaction, [payer, pendingPosition]);
  const position = await loadPoolPosition(pool, pendingPosition.publicKey);
  return {
    position: seededPositionFrom(position, true, signature),
    quoteMintSignature: quoteFunding.signature,
    rwaMintSignature: rwaFunding.signature,
  };
}

async function sendConfirmed(connection: Connection, transaction: Transaction, signers: Keypair[]) {
  const options: ConfirmOptions = {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    skipPreflight: false,
  };
  try {
    return await sendAndConfirmTransaction(connection, transaction, signers, options);
  } catch (error) {
    throw new BootstrapError("RPC_BLOCKER", "Devnet transaction preflight or confirmation failed.", error);
  }
}

function setEnvironmentValue(contents: string, name: string, value: string) {
  const pattern = new RegExp(`^(?:export\\s+)?${name}=.*$`, "m");
  const line = `${name}=${value}`;
  if (pattern.test(contents)) return contents.replace(pattern, line);
  const separator = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
  return `${contents}${separator}${line}\n`;
}

async function persistPublicConfig(values: Record<string, string>, enabled: boolean, configPath: string) {
  if (!enabled) return;
  let contents = "";
  try {
    const metadata = await lstat(configPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new BootstrapError(
        "REPO_BLOCKER",
        "DEVNET_PUBLIC_CONFIG_PATH must be a regular file, not a directory or symlink, before public bootstrap configuration can be written.",
      );
    }
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
  for (const [name, value] of Object.entries(values)) {
    contents = setEnvironmentValue(contents, name, value);
  }
  await writeFile(configPath, contents, { encoding: "utf8", mode: 0o600 });
}

function printBootstrapSummary({
  payer,
  payerBalance,
  quoteMint,
  rwaMint,
  pool,
  poolCreated,
  poolSignature,
  preset,
  seeded,
  writePublicConfig,
}: {
  payer: Keypair;
  payerBalance: bigint;
  quoteMint: MintSetup;
  rwaMint: MintSetup;
  pool: DLMM;
  poolCreated: boolean;
  poolSignature: string | null;
  preset: Awaited<ReturnType<typeof fetchDevnetPreset>> | null;
  seeded: Awaited<ReturnType<typeof seedLiquidity>>;
  writePublicConfig: boolean;
}) {
  const output = {
    network: "devnet",
    payer: payer.publicKey.toBase58(),
    payerSol: formatAtomic(payerBalance, 9),
    quoteToken: {
      mode: quoteMint.externalQuoteMint ? "external-prefunded" : "quote-demo",
      mint: quoteMint.address.toBase58(),
      decimals: quoteMint.mint.decimals,
      created: quoteMint.created,
      explorer: explorerAddress(quoteMint.address),
      fundingSignature: seeded.quoteMintSignature,
    },
    rwaDemo: {
      mint: rwaMint.address.toBase58(),
      decimals: rwaMint.mint.decimals,
      created: rwaMint.created,
      explorer: explorerAddress(rwaMint.address),
      fundingSignature: seeded.rwaMintSignature,
    },
    meteora: {
      pool: pool.pubkey.toBase58(),
      poolCreated,
      poolExplorer: explorerAddress(pool.pubkey),
      poolCreationSignature: poolSignature,
      preset: preset?.publicKey.toBase58() ?? "configured pool reused",
      tokenX: pool.tokenX.publicKey.toBase58(),
      tokenY: pool.tokenY.publicKey.toBase58(),
    },
    lpPosition: {
      address: seeded.position.publicKey.toBase58(),
      explorer: explorerAddress(seeded.position.publicKey),
      created: seeded.position.created,
      signature: seeded.position.signature,
      tokenXAtomic: seeded.position.totalXAmount.toString(),
      tokenYAtomic: seeded.position.totalYAmount.toString(),
    },
    persistedPublicConfig: writePublicConfig,
  };
  console.log(JSON.stringify(output, null, 2));

  for (const signature of [poolSignature, seeded.position.signature, seeded.quoteMintSignature, seeded.rwaMintSignature]) {
    if (signature) console.log(`Explorer transaction: ${explorerTransaction(signature)}`);
  }
  if (!writePublicConfig) {
    console.log("Public addresses were not written. Persist them manually, or rerun with WRITE_DEVNET_DEMO_CONFIG=true.");
  }
  console.log("Next step: use DEVNET_QUOTE_MINT, DEVNET_RWA_MINT, DEVNET_METEORA_POOL, and DEVNET_RWA_LP_POSITION in the Devnet demo configuration. Never expose the payer keypair in client code.");
  if (quoteMint.externalQuoteMint) {
    console.log("External quote mode never creates an ATA or mints the quote token; replenish the payer ATA outside this bootstrap before adding more liquidity.");
  }
}

async function main() {
  const environment = await readLocalEnvironment();
  const config = parseConfig(environment);
  const connection = new Connection(config.rpcUrl, "confirmed");

  await verifyDevnet(connection);
  const payer = await loadPayer(config.payerKeypairPath);
  const payerBalance = await ensureMinimumSol(connection, payer, config.minPayerLamports);
  const quoteMint = await ensureMint(
    connection,
    payer,
    "QUOTE-DEMO",
    config.quoteMintAddress,
    config.quoteDecimals,
    config.externalQuoteMint,
  );
  assertQuoteDecimals(quoteMint, config.quoteDecimals);
  if (config.externalQuoteMint) {
    const quoteLiquidityTarget = toAtomicAmount(
      config.quoteLiquidityUi,
      quoteMint.mint.decimals,
      "DEVNET_INITIAL_QUOTE_LIQUIDITY",
    );
    // This is deliberately before RWA mint creation, config persistence, pool
    // creation, or LP seeding. A missing external USDC/quote balance must not
    // leave behind partial Devnet bootstrap state.
    await requireExistingExternalQuoteLiquidity(
      connection,
      payer,
      quoteMint,
      quoteLiquidityTarget,
    );
  }
  const rwaMint = await ensureMint(connection, payer, "RWA-DEMO", config.rwaMintAddress, config.quoteDecimals);
  assertDistinctMints(quoteMint, rwaMint);

  await persistPublicConfig({
    DEVNET_QUOTE_MINT: quoteMint.address.toBase58(),
    DEVNET_RWA_MINT: rwaMint.address.toBase58(),
  }, config.writePublicConfig, config.publicConfigPath);

  const poolSetup = await createOrReusePool(connection, payer, config, quoteMint, rwaMint);
  await persistPublicConfig({
    DEVNET_METEORA_POOL: poolSetup.pool.pubkey.toBase58(),
  }, config.writePublicConfig, config.publicConfigPath);

  const seeded = await seedLiquidity(connection, payer, config, poolSetup.pool, quoteMint, rwaMint);
  await persistPublicConfig({
    DEVNET_RWA_LP_POSITION: seeded.position.publicKey.toBase58(),
  }, config.writePublicConfig, config.publicConfigPath);

  printBootstrapSummary({
    payer,
    payerBalance,
    quoteMint,
    rwaMint,
    pool: poolSetup.pool,
    poolCreated: poolSetup.created,
    poolSignature: poolSetup.signature,
    preset: poolSetup.preset,
    seeded,
    writePublicConfig: config.writePublicConfig,
  });
}

main().catch((error: unknown) => {
  if (error instanceof BootstrapError) {
    console.error(`${error.kind}: ${error.message}`);
  } else {
    console.error("REPO_BLOCKER: Unexpected bootstrap failure.");
    console.error(error);
  }
  process.exitCode = 1;
});
