import "server-only";

import { createHash } from "node:crypto";
import DLMM, { LBCLMM_PROGRAM_IDS } from "@meteora-ag/dlmm";
import BN from "bn.js";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  demoExplorerTransactionUrl,
  getVerifiedRwaDemoConnection,
  type ConfiguredRwaDemoConfig,
} from "@/lib/rwa-demo-config";
import {
  RWA_DEMO_ASSET_ID,
  RWA_DEMO_NETWORK,
  RWA_DEMO_ROUTE,
  type RwaDemoSide,
} from "@/lib/rwa-demo";

const QUOTE_TTL_MS = 30_000;

export class MeteoraDevnetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MeteoraDevnetError";
    this.code = code;
  }
}

export class MeteoraConfirmationTimeoutError extends MeteoraDevnetError {
  constructor() {
    super("CONFIRMATION_TIMEOUT", "The Devnet transaction has not reached confirmed status yet.");
    this.name = "MeteoraConfirmationTimeoutError";
  }
}

export type MeteoraDemoQuote = {
  assetId: typeof RWA_DEMO_ASSET_ID;
  side: RwaDemoSide;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  minimumOutputAtomic: string;
  feeAmountAtomic: string;
  protocolFeeAtomic: string;
  priceImpact: string | null;
  slippageBps: number;
  poolAddress: string;
  route: typeof RWA_DEMO_ROUTE;
  network: typeof RWA_DEMO_NETWORK;
  isDemo: true;
  expiresAt: number;
};

export type BuiltMeteoraDemoSwap = {
  quote: MeteoraDemoQuote;
  serializedTransaction: string;
  transactionMessageDigest: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

type LoadedPool = {
  config: ConfiguredRwaDemoConfig;
  connection: Connection;
  pool: DLMM;
  quoteDecimals: number;
  rwaDecimals: number;
};

function amountBn(value: string, label: string) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new MeteoraDevnetError("INVALID_AMOUNT", `${label} must be a positive atomic amount.`);
  }
  return new BN(value, 10);
}

function publicKey(value: string, label: string) {
  try {
    return new PublicKey(value);
  } catch {
    throw new MeteoraDevnetError("INVALID_WALLET", `${label} is not a valid Solana public key.`);
  }
}

async function loadVerifiedPool(): Promise<LoadedPool> {
  const { config, connection } = await getVerifiedRwaDemoConnection();
  let pool: DLMM;
  try {
    pool = await DLMM.create(connection, config.pool, { cluster: "devnet" });
  } catch {
    throw new MeteoraDevnetError("POOL_UNAVAILABLE", "The configured Meteora Devnet pool could not be loaded.");
  }
  const poolMints = [pool.tokenX.publicKey.toBase58(), pool.tokenY.publicKey.toBase58()];
  const expectedMints = [config.quoteMint.toBase58(), config.rwaMint.toBase58()];
  if (!expectedMints.every((mint) => poolMints.includes(mint))) {
    throw new MeteoraDevnetError("POOL_MINT_MISMATCH", "Configured demo mints do not match the configured Meteora pool.");
  }
  let quoteMintInfo;
  let rwaMintInfo;
  try {
    [quoteMintInfo, rwaMintInfo] = await Promise.all([
      getMint(connection, config.quoteMint, "confirmed", TOKEN_PROGRAM_ID),
      getMint(connection, config.rwaMint, "confirmed", TOKEN_PROGRAM_ID),
    ]);
  } catch {
    throw new MeteoraDevnetError("MINT_UNAVAILABLE", "Configured demo mint account could not be verified on Devnet.");
  }
  if (quoteMintInfo.decimals !== config.quoteDecimals) {
    throw new MeteoraDevnetError("QUOTE_DECIMALS_MISMATCH", "DEVNET_QUOTE_DECIMALS does not match DEVNET_QUOTE_MINT.");
  }
  return { config, connection, pool, quoteDecimals: quoteMintInfo.decimals, rwaDecimals: rwaMintInfo.decimals };
}

function poolDirection(pool: DLMM, config: ConfiguredRwaDemoConfig, side: RwaDemoSide) {
  const input = side === "BUY" ? config.quoteMint : config.rwaMint;
  const output = side === "BUY" ? config.rwaMint : config.quoteMint;
  const swapForY = input.equals(pool.tokenX.publicKey);
  const expectedOutput = swapForY ? pool.tokenY.publicKey : pool.tokenX.publicKey;
  if (!expectedOutput.equals(output)) {
    throw new MeteoraDevnetError("POOL_MINT_MISMATCH", "Configured demo token direction is not valid for the Meteora pool.");
  }
  return { input, output, swapForY };
}

async function quoteLoadedPool({
  loaded,
  side,
  inputAmountAtomic,
  expiresAt = Date.now() + QUOTE_TTL_MS,
}: {
  loaded: LoadedPool;
  side: RwaDemoSide;
  inputAmountAtomic: string;
  expiresAt?: number;
}) {
  const inAmount = amountBn(inputAmountAtomic, "inputAmountAtomic");
  const { input, output, swapForY } = poolDirection(loaded.pool, loaded.config, side);
  try {
    await loaded.pool.refetchStates();
    const binArrays = await loaded.pool.getBinArrayForSwap(swapForY, 4);
    const sdkQuote = loaded.pool.swapQuote(
      inAmount,
      swapForY,
      new BN(loaded.config.swapSlippageBps),
      binArrays,
      false,
    );
    // Exact-input orders must not silently degrade to a partial fill.
    if (!sdkQuote.consumedInAmount.eq(inAmount) || sdkQuote.outAmount.lte(new BN(0))) {
      throw new MeteoraDevnetError("INSUFFICIENT_LIQUIDITY", "The Devnet pool cannot fill this exact-input demo swap.");
    }
    const quote: MeteoraDemoQuote = {
      assetId: RWA_DEMO_ASSET_ID,
      side,
      inputMint: input.toBase58(),
      outputMint: output.toBase58(),
      inputAmountAtomic: sdkQuote.consumedInAmount.toString(10),
      expectedOutputAtomic: sdkQuote.outAmount.toString(10),
      minimumOutputAtomic: sdkQuote.minOutAmount.toString(10),
      feeAmountAtomic: sdkQuote.fee.toString(10),
      protocolFeeAtomic: sdkQuote.protocolFee.toString(10),
      priceImpact: sdkQuote.priceImpact?.toString() ?? null,
      slippageBps: loaded.config.swapSlippageBps,
      poolAddress: loaded.config.pool.toBase58(),
      route: RWA_DEMO_ROUTE,
      network: RWA_DEMO_NETWORK,
      isDemo: true,
      expiresAt,
    };
    return { quote, sdkQuote, input, output };
  } catch (error) {
    if (error instanceof MeteoraDevnetError) throw error;
    throw new MeteoraDevnetError("QUOTE_UNAVAILABLE", "Unable to get a fresh Meteora Devnet quote.");
  }
}

export async function getMeteoraDemoQuote({
  side,
  inputAmountAtomic,
}: {
  side: RwaDemoSide;
  inputAmountAtomic: string;
}) {
  const loaded = await loadVerifiedPool();
  return (await quoteLoadedPool({ loaded, side, inputAmountAtomic })).quote;
}

/**
 * Do not issue a replacement message while the old blockhash can still land.
 * This is deliberately verified through the same fail-closed Devnet RPC path.
 */
export async function isMeteoraDemoTransactionStillValid(lastValidBlockHeight: number) {
  if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0) {
    throw new MeteoraDevnetError("TRANSACTION_MISMATCH", "Order does not contain a valid transaction expiry height.");
  }
  const { connection } = await getVerifiedRwaDemoConnection();
  try {
    return (await connection.getBlockHeight("confirmed")) <= lastValidBlockHeight;
  } catch {
    throw new MeteoraDevnetError("RPC_UNAVAILABLE", "Unable to verify whether the prior Devnet transaction has expired.");
  }
}

export async function buildMeteoraDemoSwap({
  walletAddress,
  side,
  inputAmountAtomic,
}: {
  walletAddress: string;
  side: RwaDemoSide;
  inputAmountAtomic: string;
}): Promise<BuiltMeteoraDemoSwap> {
  const user = publicKey(walletAddress, "walletAddress");
  const loaded = await loadVerifiedPool();
  const { quote, sdkQuote, input, output } = await quoteLoadedPool({
    loaded,
    side,
    inputAmountAtomic,
  });
  let transaction: Transaction;
  try {
    transaction = await loaded.pool.swap({
      inToken: input,
      outToken: output,
      inAmount: sdkQuote.consumedInAmount,
      minOutAmount: sdkQuote.minOutAmount,
      lbPair: loaded.pool.pubkey,
      user,
      binArraysPubkey: sdkQuote.binArraysPubkey,
    });
  } catch {
    throw new MeteoraDevnetError("TRANSACTION_BUILD_FAILED", "Unable to build the Meteora Devnet swap transaction.");
  }
  const latestBlockhash = await loaded.connection.getLatestBlockhash("confirmed");
  transaction.feePayer = user;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  // Simulate the exact unsigned transaction before asking the user's embedded
  // wallet to sign. Signature verification is deliberately disabled because the
  // user signature does not exist yet.
  let simulation;
  try {
    const versioned = new VersionedTransaction(transaction.compileMessage());
    simulation = await loaded.connection.simulateTransaction(versioned, {
      sigVerify: false,
      commitment: "confirmed",
    });
  } catch {
    throw new MeteoraDevnetError("SIMULATION_UNAVAILABLE", "Unable to simulate the Meteora Devnet swap.");
  }
  if (simulation.value.err) {
    throw new MeteoraDevnetError("SIMULATION_FAILED", "The Meteora Devnet swap simulation failed. Refresh the quote and retry.");
  }
  return {
    quote,
    serializedTransaction: Buffer.from(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString("base64"),
    transactionMessageDigest: createHash("sha256").update(transaction.serializeMessage()).digest("hex"),
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  };
}

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
};

function ownerMintBalance(
  balances: readonly TokenBalance[] | null | undefined,
  owner: string,
  mint: string,
) {
  return (balances ?? []).reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint) return total;
    return total + BigInt(balance.uiTokenAmount.amount);
  }, BigInt(0));
}

async function confirmedParsedTransaction(connection: Connection, signature: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const statusResult = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = statusResult.value[0];
    if (status?.err) {
      throw new MeteoraDevnetError("TRANSACTION_FAILED", "The submitted Devnet transaction failed on-chain.");
    }
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
      const [rawTransaction, transaction] = await Promise.all([
        connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
        connection.getParsedTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }),
      ]);
      if (rawTransaction && transaction) return { rawTransaction, transaction };
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new MeteoraConfirmationTimeoutError();
}

async function getOwnerMintBalanceAtomic(connection: Connection, owner: PublicKey, mint: PublicKey) {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint }, "confirmed");
  return accounts.value.reduce((total, account) => {
    const parsed = account.account.data.parsed as { info?: { tokenAmount?: { amount?: unknown } } };
    const amount = parsed.info?.tokenAmount?.amount;
    return typeof amount === "string" && /^\d+$/.test(amount) ? total + BigInt(amount) : total;
  }, BigInt(0));
}

export async function verifyMeteoraDemoSwap({
  signature,
  walletAddress,
  side,
  expectedMessageDigest,
  expectedInputAmountAtomic,
  minimumOutputAtomic,
}: {
  signature: string;
  walletAddress: string;
  side: RwaDemoSide;
  expectedMessageDigest: string;
  expectedInputAmountAtomic: string;
  minimumOutputAtomic: string;
}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(signature)) {
    throw new MeteoraDevnetError("INVALID_SIGNATURE", "Transaction signature is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(expectedMessageDigest)) {
    throw new MeteoraDevnetError("TRANSACTION_MISMATCH", "Order does not contain a valid prepared transaction message.");
  }
  const user = publicKey(walletAddress, "walletAddress");
  const loaded = await loadVerifiedPool();
  let expectedInput: bigint;
  let minimumOutput: bigint;
  try {
    expectedInput = BigInt(expectedInputAmountAtomic);
    minimumOutput = BigInt(minimumOutputAtomic);
  } catch {
    throw new MeteoraDevnetError("INVALID_AMOUNT", "Order amounts are not valid atomic integers.");
  }
  if (expectedInput <= BigInt(0) || minimumOutput <= BigInt(0)) {
    throw new MeteoraDevnetError("INVALID_AMOUNT", "Order amounts must be positive atomic integers.");
  }
  const { rawTransaction, transaction } = await confirmedParsedTransaction(loaded.connection, signature);
  const rawMessage = rawTransaction.transaction.message as { serialize?: () => Uint8Array };
  if (typeof rawMessage.serialize !== "function") {
    throw new MeteoraDevnetError("TRANSACTION_MISMATCH", "Submitted transaction message could not be verified.");
  }
  const actualMessageDigest = createHash("sha256").update(rawMessage.serialize()).digest("hex");
  if (actualMessageDigest !== expectedMessageDigest) {
    throw new MeteoraDevnetError("TRANSACTION_MISMATCH", "Submitted transaction does not match the transaction prepared for this order.");
  }
  if (transaction.meta?.err) {
    throw new MeteoraDevnetError("TRANSACTION_FAILED", "The submitted Devnet transaction failed on-chain.");
  }
  const accountKeys = transaction.transaction.message.accountKeys;
  const includesWalletSigner = accountKeys.some((key) => key.pubkey.equals(user) && key.signer);
  const includesConfiguredPool = accountKeys.some((key) => key.pubkey.equals(loaded.config.pool));
  const dlmmProgram = new PublicKey(LBCLMM_PROGRAM_IDS.devnet);
  const includesDlmmInstruction = transaction.transaction.message.instructions
    .some((instruction) => instruction.programId.equals(dlmmProgram));
  if (!includesWalletSigner || !includesConfiguredPool || !includesDlmmInstruction) {
    throw new MeteoraDevnetError("TRANSACTION_MISMATCH", "Submitted transaction does not match this wallet and configured Devnet pool.");
  }
  const pre = transaction.meta?.preTokenBalances as readonly TokenBalance[] | null | undefined;
  const post = transaction.meta?.postTokenBalances as readonly TokenBalance[] | null | undefined;
  const quoteBefore = ownerMintBalance(pre, walletAddress, loaded.config.quoteMint.toBase58());
  const quoteAfter = ownerMintBalance(post, walletAddress, loaded.config.quoteMint.toBase58());
  const rwaBefore = ownerMintBalance(pre, walletAddress, loaded.config.rwaMint.toBase58());
  const rwaAfter = ownerMintBalance(post, walletAddress, loaded.config.rwaMint.toBase58());
  const quoteDelta = quoteAfter - quoteBefore;
  const rwaDelta = rwaAfter - rwaBefore;
  const { input, output } = poolDirection(loaded.pool, loaded.config, side);
  const inputDelta = input.equals(loaded.config.quoteMint) ? quoteDelta : rwaDelta;
  const outputDelta = output.equals(loaded.config.quoteMint) ? quoteDelta : rwaDelta;
  const actualInput = -inputDelta;
  const actualOutput = outputDelta;
  if (actualInput <= BigInt(0) || actualOutput <= BigInt(0)
    || actualInput !== expectedInput || actualOutput < minimumOutput) {
    throw new MeteoraDevnetError("TRANSACTION_MISMATCH", "Confirmed token deltas do not meet the exact-input and minimum-output order limits.");
  }
  const [quoteBalanceAfter, rwaBalanceAfter] = await Promise.all([
    getOwnerMintBalanceAtomic(loaded.connection, user, loaded.config.quoteMint),
    getOwnerMintBalanceAtomic(loaded.connection, user, loaded.config.rwaMint),
  ]);
  return {
    signature,
    explorerUrl: demoExplorerTransactionUrl(signature),
    inputMint: input.toBase58(),
    outputMint: output.toBase58(),
    actualInputAmountAtomic: actualInput.toString(10),
    actualOutputAmountAtomic: actualOutput.toString(10),
    quoteBalanceAfterAtomic: quoteBalanceAfter.toString(10),
    rwaBalanceAfterAtomic: rwaBalanceAfter.toString(10),
    network: RWA_DEMO_NETWORK,
    route: RWA_DEMO_ROUTE,
    isDemo: true as const,
  };
}

export async function getMeteoraDemoAssetMetadata() {
  const loaded = await loadVerifiedPool();
  return {
    quoteDecimals: loaded.quoteDecimals,
    rwaDecimals: loaded.rwaDecimals,
    poolAddress: loaded.config.pool.toBase58(),
    quoteMint: loaded.config.quoteMint.toBase58(),
    rwaMint: loaded.config.rwaMint.toBase58(),
  };
}
