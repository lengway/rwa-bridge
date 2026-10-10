import "server-only";

import { createHash, randomUUID } from "node:crypto";
import BN from "bn.js";
import bs58 from "bs58";
import {
  KaminoAction,
  KaminoMarket,
  LendingMarket,
  Reserve,
  VanillaObligation,
  getCurrentLedgerInstant,
} from "@kamino-finance/klend-sdk";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type TransactionSigner,
} from "@solana/kit";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SOLANA_DEVNET_GENESIS_HASH } from "@/lib/rwa-demo";
import {
  KAMINO_LEND_DEVNET,
  KaminoLendDevnetError,
  type KaminoLendAction,
  parseKaminoLendAtomicAmount,
} from "@/lib/kamino-lend-devnet-config";

export {
  KAMINO_LEND_DEVNET,
  KaminoLendDevnetError,
  type KaminoLendAction,
  isKaminoLendDevnetCluster,
  parseKaminoLendAtomicAmount,
} from "@/lib/kamino-lend-devnet-config";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const PREPARED_ACTION_TTL_MS = 90_000;
const PREPARED_ACTION_LIMIT = 512;

type KaminoLendDevnetConfig = {
  rpcUrl: string;
  maxAmountAtomic: bigint;
};

type VerifiedKaminoLend = {
  config: KaminoLendDevnetConfig;
  connection: Connection;
  rpc: ReturnType<typeof createSolanaRpc>;
  market: KaminoMarket;
  reserve: ReturnType<KaminoMarket["getExistingReserveByAddress"]>;
  availableLiquidityAtomic: bigint;
};

type PreparedKaminoAction = {
  id: string;
  action: KaminoLendAction;
  walletAddress: string;
  amountAtomic: string;
  collateralAmountAtomic: string | null;
  messageDigest: string;
  blockhash: string;
  lastValidBlockHeight: number;
  expiresAt: number;
  kaminoInstructionDigests: string[];
  status: "PREPARED" | "CONFIRMED" | "FAILED";
  result?: ConfirmedKaminoLendAction;
};

type ConfirmedKaminoLendAction = {
  confirmed: true;
  status: "COMPLETED";
  actionId: string;
  action: KaminoLendAction;
  network: "devnet";
  signature: string;
  market: string;
  reserve: string;
  mint: string;
  amountAtomic: string;
  collateralAmountAtomic: string | null;
  actualLiquidityAmountAtomic: string;
  actualCollateralAmountAtomic: string;
};

const preparedActions = new Map<string, PreparedKaminoAction>();
const confirmingActionIds = new Set<string>();

function error(code: string, message: string): never {
  throw new KaminoLendDevnetError(code, message);
}

function readEnabled() {
  return process.env.ENABLE_KAMINO_LEND_DEVNET === "true";
}

function readMaxAmountAtomic() {
  const raw = process.env.KAMINO_LEND_DEVNET_MAX_AMOUNT_ATOMIC?.trim();
  if (!raw) return KAMINO_LEND_DEVNET.maximumAmountAtomic;
  if (!/^[1-9]\d*$/.test(raw)) {
    error("INVALID_CONFIG", "KAMINO_LEND_DEVNET_MAX_AMOUNT_ATOMIC must be a positive atomic integer.");
  }
  const value = BigInt(raw);
  if (value > KAMINO_LEND_DEVNET.maximumAmountAtomic) {
    error("INVALID_CONFIG", "KAMINO_LEND_DEVNET_MAX_AMOUNT_ATOMIC cannot exceed the hard safety cap.");
  }
  return value;
}

function readConfig(): KaminoLendDevnetConfig {
  if (!readEnabled()) {
    error("KAMINO_DISABLED", "Kamino Lend Devnet is not enabled.");
  }
  if (process.env.SOLANA_CLUSTER !== KAMINO_LEND_DEVNET.network) {
    error("INVALID_CLUSTER", "Kamino Lend is restricted to canonical Solana Devnet.");
  }
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
  if (!rpcUrl) error("RPC_UNAVAILABLE", "SOLANA_RPC_URL is required for Kamino Lend Devnet.");
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:") {
      error("INVALID_CONFIG", "Kamino Lend Devnet requires an HTTPS RPC endpoint.");
    }
  } catch (cause) {
    if (cause instanceof KaminoLendDevnetError) throw cause;
    error("INVALID_CONFIG", "SOLANA_RPC_URL is not a valid HTTPS URL.");
  }
  return { rpcUrl, maxAmountAtomic: readMaxAmountAtomic() };
}

function publicKey(value: string, label: string) {
  try {
    return new PublicKey(value);
  } catch {
    error("INVALID_WALLET", `${label} is not a valid Solana address.`);
  }
}

function validateRequestedAmount(value: unknown, maxAmountAtomic: bigint) {
  const amount = parseKaminoLendAtomicAmount(value);
  if (amount > maxAmountAtomic) {
    error("AMOUNT_LIMIT", "The requested amount exceeds the configured Kamino Lend Devnet safety limit.");
  }
  return amount;
}

async function medianRecentSlotDurationMs(connection: Connection) {
  try {
    const samples = await connection.getRecentPerformanceSamples(10);
    const values = samples
      .map((sample) => sample.numSlots > 0 ? (sample.samplePeriodSecs * 1_000) / sample.numSlots : NaN)
      .filter((value) => Number.isFinite(value) && value >= 50 && value <= 2_000)
      .sort((left, right) => left - right);
    if (values.length > 0) return Math.round(values[Math.floor(values.length / 2)]);
  } catch {
    // The SDK only needs this value for reserve-rate estimations. A bounded
    // fallback remains safe because every prepared transaction is simulated.
  }
  return 400;
}

function assertAddress(actual: Address | string, expected: string, code: string, message: string) {
  if (actual.toString() !== expected) error(code, message);
}

async function loadVerifiedKaminoLend(config = readConfig()): Promise<VerifiedKaminoLend> {
  const connection = new Connection(config.rpcUrl, "confirmed");
  let genesisHash: string;
  try {
    genesisHash = await connection.getGenesisHash();
  } catch {
    error("RPC_UNAVAILABLE", "Unable to verify the configured Solana RPC.");
  }
  if (genesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    error("INVALID_CLUSTER", "Configured RPC is not canonical Solana Devnet.");
  }

  const program = publicKey(KAMINO_LEND_DEVNET.programId, "Kamino program");
  const marketAddress = publicKey(KAMINO_LEND_DEVNET.market, "Kamino market");
  const reserveAddress = publicKey(KAMINO_LEND_DEVNET.reserve, "Kamino reserve");
  const [programAccount, marketAccount, reserveAccount] = await connection.getMultipleAccountsInfo(
    [program, marketAddress, reserveAddress],
    "confirmed",
  );
  if (!programAccount || !programAccount.executable || !programAccount.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) {
    error("PROGRAM_UNVERIFIED", "Pinned Kamino program could not be verified on Devnet.");
  }
  if (!marketAccount || !marketAccount.owner.equals(program) || marketAccount.data.length < 8) {
    error("MARKET_UNVERIFIED", "Pinned Kamino market could not be verified on Devnet.");
  }
  if (!reserveAccount || !reserveAccount.owner.equals(program) || reserveAccount.data.length < 8) {
    error("RESERVE_UNVERIFIED", "Pinned Kamino reserve could not be verified on Devnet.");
  }

  let reserveState: Reserve;
  try {
    LendingMarket.decode(marketAccount.data);
    reserveState = Reserve.decode(reserveAccount.data);
  } catch {
    error("ACCOUNT_LAYOUT_INVALID", "Pinned Kamino market or reserve account has an unexpected layout.");
  }
  assertAddress(reserveState.lendingMarket, KAMINO_LEND_DEVNET.market, "RESERVE_MARKET_MISMATCH", "Pinned reserve does not belong to the pinned market.");
  assertAddress(reserveState.liquidity.mintPubkey, KAMINO_LEND_DEVNET.liquidityMint, "RESERVE_MINT_MISMATCH", "Pinned reserve has an unexpected liquidity mint.");
  assertAddress(reserveState.collateral.mintPubkey, KAMINO_LEND_DEVNET.collateralMint, "RESERVE_COLLATERAL_MISMATCH", "Pinned reserve has an unexpected collateral mint.");
  assertAddress(reserveState.liquidity.supplyVault, KAMINO_LEND_DEVNET.supplyVault, "RESERVE_VAULT_MISMATCH", "Pinned reserve has an unexpected supply vault.");
  assertAddress(reserveState.liquidity.tokenProgram, KAMINO_LEND_DEVNET.liquidityTokenProgram, "RESERVE_TOKEN_PROGRAM_MISMATCH", "Pinned reserve uses an unsupported token program.");
  if (reserveState.config.status.toString() !== "0") {
    error("RESERVE_INACTIVE", "Pinned Kamino reserve is not active.");
  }
  if (reserveState.config.emergencyMode !== 0 || reserveState.config.blockCtokenUsage !== 0) {
    error("RESERVE_INACTIVE", "Pinned Kamino reserve is not available for direct liquidity actions.");
  }

  const liquidityMint = publicKey(KAMINO_LEND_DEVNET.liquidityMint, "liquidity mint");
  const collateralMint = publicKey(KAMINO_LEND_DEVNET.collateralMint, "collateral mint");
  const supplyVault = publicKey(KAMINO_LEND_DEVNET.supplyVault, "supply vault");
  let liquidityMintInfo;
  let collateralMintInfo;
  let supplyVaultInfo;
  try {
    [liquidityMintInfo, collateralMintInfo, supplyVaultInfo] = await Promise.all([
      getMint(connection, liquidityMint, "confirmed", TOKEN_PROGRAM_ID),
      getMint(connection, collateralMint, "confirmed", TOKEN_PROGRAM_ID),
      getAccount(connection, supplyVault, "confirmed", TOKEN_PROGRAM_ID),
    ]);
  } catch {
    error("TOKEN_ACCOUNT_UNVERIFIED", "Pinned Kamino token accounts could not be verified on Devnet.");
  }
  if (liquidityMintInfo.decimals !== KAMINO_LEND_DEVNET.decimals || collateralMintInfo.decimals !== KAMINO_LEND_DEVNET.decimals) {
    error("MINT_DECIMALS_MISMATCH", "Pinned Kamino token decimals are unexpected.");
  }
  if (!supplyVaultInfo.mint.equals(liquidityMint)) {
    error("RESERVE_VAULT_MISMATCH", "Pinned supply vault does not hold the configured liquidity mint.");
  }
  if (!supplyVaultInfo.owner.equals(publicKey(KAMINO_LEND_DEVNET.lendingMarketAuthority, "market authority"))) {
    error("RESERVE_AUTHORITY_MISMATCH", "Pinned supply vault is not controlled by the pinned market authority.");
  }
  if (!collateralMintInfo.mintAuthority?.equals(publicKey(KAMINO_LEND_DEVNET.lendingMarketAuthority, "market authority"))) {
    error("RESERVE_AUTHORITY_MISMATCH", "Pinned collateral mint is not controlled by the pinned market authority.");
  }

  const rpc = createSolanaRpc(config.rpcUrl);
  const programAddress = address(KAMINO_LEND_DEVNET.programId);
  const slotDurationMs = await medianRecentSlotDurationMs(connection);
  let market: KaminoMarket | null;
  try {
    market = await KaminoMarket.load(rpc, address(KAMINO_LEND_DEVNET.market), slotDurationMs, programAddress);
  } catch {
    error("MARKET_UNAVAILABLE", "Unable to load the pinned Kamino market from Devnet.");
  }
  if (!market) error("MARKET_UNAVAILABLE", "Pinned Kamino market was not found on Devnet.");
  const reserve = market.getReserveByAddress(address(KAMINO_LEND_DEVNET.reserve));
  if (!reserve) error("RESERVE_UNAVAILABLE", "Pinned Kamino reserve was not found in the pinned market.");
  assertAddress(reserve.getLiquidityMint(), KAMINO_LEND_DEVNET.liquidityMint, "RESERVE_MINT_MISMATCH", "SDK reserve liquidity mint does not match the pinned mint.");
  assertAddress(reserve.getCTokenMint(), KAMINO_LEND_DEVNET.collateralMint, "RESERVE_COLLATERAL_MISMATCH", "SDK reserve collateral mint does not match the pinned mint.");
  assertAddress(await market.getLendingMarketAuthority(), KAMINO_LEND_DEVNET.lendingMarketAuthority, "RESERVE_AUTHORITY_MISMATCH", "SDK market authority does not match the pinned authority.");

  const available = reserve.getLiquidityAvailableAmount().floor().toFixed(0);
  if (!/^\d+$/.test(available)) error("RESERVE_UNAVAILABLE", "Pinned reserve returned an invalid liquidity amount.");
  return {
    config,
    connection,
    rpc,
    market,
    reserve,
    availableLiquidityAtomic: BigInt(available),
  };
}

function noopSigner(owner: Address): TransactionSigner {
  return {
    address: owner,
    async signTransactions() {
      // The server never signs. The resulting unsigned v0 transaction is sent
      // to the connected wallet only after a successful simulation.
      return [];
    },
  } as TransactionSigner;
}

function actionInstructionDigests(action: KaminoAction) {
  return KaminoAction.actionToIxs(action)
    .filter((instruction) => instruction.programAddress === KAMINO_LEND_DEVNET.programId)
    .map((instruction) => {
      if (!instruction.data) {
        error("TRANSACTION_LAYOUT_INVALID", "Kamino instruction did not include instruction data.");
      }
      return createHash("sha256").update(Buffer.from([...instruction.data])).digest("hex");
    });
}

type VersionedMessageTransaction = {
  message: {
    staticAccountKeys: readonly PublicKey[];
    compiledInstructions: readonly { programIdIndex: number; data: Uint8Array }[];
  };
};

function compiledKaminoInstructionDigests(transaction: VersionedMessageTransaction) {
  return transaction.message.compiledInstructions
    .filter((instruction) => transaction.message.staticAccountKeys[instruction.programIdIndex]?.toBase58() === KAMINO_LEND_DEVNET.programId)
    .map((instruction) => createHash("sha256").update(Buffer.from([...instruction.data])).digest("hex"));
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertSafePreparedTransaction(
  transaction: VersionedTransaction,
  action: KaminoLendAction,
  expectedWalletAddress: string,
) {
  if (transaction.version !== 0 || transaction.message.addressTableLookups.length !== 0) {
    error("TRANSACTION_LAYOUT_INVALID", "Kamino transaction must be a direct v0 transaction without lookup tables.");
  }
  if (transaction.message.staticAccountKeys[0]?.toBase58() !== expectedWalletAddress) {
    error("TRANSACTION_LAYOUT_INVALID", "Kamino transaction fee payer does not match the authenticated wallet.");
  }
  const allowedPrograms = new Set([
    KAMINO_LEND_DEVNET.programId,
    COMPUTE_BUDGET_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ]);
  const programIds = transaction.message.compiledInstructions.map((instruction) => {
    const program = transaction.message.staticAccountKeys[instruction.programIdIndex];
    if (!program) error("TRANSACTION_LAYOUT_INVALID", "Kamino transaction references an unknown program index.");
    return program.toBase58();
  });
  if (programIds.some((program) => !allowedPrograms.has(program))) {
    error("TRANSACTION_LAYOUT_INVALID", "Kamino transaction includes an unexpected program.");
  }
  const kaminoCount = programIds.filter((program) => program === KAMINO_LEND_DEVNET.programId).length;
  if (kaminoCount !== 1) {
    error("TRANSACTION_LAYOUT_INVALID", `Kamino ${action} transaction must contain exactly one Kamino instruction.`);
  }
  const requiredAccounts = [
    expectedWalletAddress,
    KAMINO_LEND_DEVNET.market,
    KAMINO_LEND_DEVNET.reserve,
    KAMINO_LEND_DEVNET.liquidityMint,
    KAMINO_LEND_DEVNET.collateralMint,
    KAMINO_LEND_DEVNET.supplyVault,
  ];
  const accountSet = new Set(transaction.message.staticAccountKeys.map((key) => key.toBase58()));
  if (requiredAccounts.some((key) => !accountSet.has(key))) {
    error("TRANSACTION_LAYOUT_INVALID", "Kamino transaction is missing a pinned market account.");
  }
}

function trimPreparedActions(now = Date.now()) {
  for (const [id, prepared] of preparedActions) {
    if (prepared.expiresAt < now && prepared.status !== "CONFIRMED") preparedActions.delete(id);
  }
  while (preparedActions.size >= PREPARED_ACTION_LIMIT) {
    const first = preparedActions.keys().next().value;
    if (!first) break;
    preparedActions.delete(first);
  }
}

async function userTokenBalanceAtomic({
  connection,
  mint,
  owner,
}: {
  connection: Connection;
  mint: PublicKey;
  owner: PublicKey;
}) {
  const ata = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID);
  try {
    return (await getAccount(connection, ata, "confirmed", TOKEN_PROGRAM_ID)).amount;
  } catch {
    return BigInt(0);
  }
}

function balanceDeltaAtomic(
  balances: readonly { mint: string; owner?: string; uiTokenAmount: { amount: string } }[] | null | undefined,
  owner: string,
  mint: string,
) {
  return (balances ?? []).reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint || !/^\d+$/.test(balance.uiTokenAmount.amount)) return total;
    return total + BigInt(balance.uiTokenAmount.amount);
  }, BigInt(0));
}

function signatureLooksValid(value: unknown): value is string {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(value);
}

function messageDigest(transaction: VersionedTransaction) {
  return createHash("sha256").update(transaction.message.serialize()).digest("hex");
}

function publicResponse(prepared: PreparedKaminoAction, serializedTransaction: string, simulation: { unitsConsumed: number | null }) {
  return {
    actionId: prepared.id,
    action: prepared.action,
    network: KAMINO_LEND_DEVNET.network,
    serializedTransaction,
    transactionEncoding: "base58" as const,
    transactionVersion: 0,
    blockhash: prepared.blockhash,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
    transactionMessageDigest: prepared.messageDigest,
    expiresAt: prepared.expiresAt,
    market: KAMINO_LEND_DEVNET.market,
    reserve: KAMINO_LEND_DEVNET.reserve,
    mint: KAMINO_LEND_DEVNET.liquidityMint,
    collateralMint: KAMINO_LEND_DEVNET.collateralMint,
    amountAtomic: prepared.amountAtomic,
    collateralAmountAtomic: prepared.collateralAmountAtomic,
    simulation: {
      ok: true as const,
      err: null,
      unitsConsumed: simulation.unitsConsumed,
    },
  };
}

export async function getKaminoLendDevnetMarketStatus(walletAddress?: string) {
  try {
    const loaded = await loadVerifiedKaminoLend();
    let wallet: { address: string; liquidityBalanceAtomic: string; collateralBalanceAtomic: string } | undefined;
    if (walletAddress !== undefined) {
      const owner = publicKey(walletAddress, "walletAddress");
      const [liquidityBalance, collateralBalance] = await Promise.all([
        userTokenBalanceAtomic({
          connection: loaded.connection,
          mint: publicKey(KAMINO_LEND_DEVNET.liquidityMint, "liquidity mint"),
          owner,
        }),
        userTokenBalanceAtomic({
          connection: loaded.connection,
          mint: publicKey(KAMINO_LEND_DEVNET.collateralMint, "collateral mint"),
          owner,
        }),
      ]);
      wallet = {
        address: owner.toBase58(),
        liquidityBalanceAtomic: liquidityBalance.toString(10),
        collateralBalanceAtomic: collateralBalance.toString(10),
      };
    }
    return {
      configured: true,
      ready: true,
      network: KAMINO_LEND_DEVNET.network,
      programId: KAMINO_LEND_DEVNET.programId,
      market: { address: KAMINO_LEND_DEVNET.market, name: "Kamino Lend" },
      reserve: {
        address: KAMINO_LEND_DEVNET.reserve,
        mint: KAMINO_LEND_DEVNET.liquidityMint,
        collateralMint: KAMINO_LEND_DEVNET.collateralMint,
        supplyVault: KAMINO_LEND_DEVNET.supplyVault,
        symbol: KAMINO_LEND_DEVNET.symbol,
        decimals: KAMINO_LEND_DEVNET.decimals,
        availableLiquidityAtomic: loaded.availableLiquidityAtomic.toString(10),
      },
      limits: {
        minAmountAtomic: "1",
        maxAmountAtomic: loaded.config.maxAmountAtomic.toString(10),
      },
      wallet,
    };
  } catch (cause) {
    const code = cause instanceof KaminoLendDevnetError ? cause.code : "KAMINO_UNAVAILABLE";
    return {
      configured: readEnabled(),
      ready: false,
      network: KAMINO_LEND_DEVNET.network,
      error: { code },
    };
  }
}

/**
 * Reads the user's actual SPL collateral account. It intentionally does not
 * use the application portfolio or any cached client value.
 */
export async function getKaminoLendDevnetPosition(walletAddress: string) {
  const owner = publicKey(walletAddress, "walletAddress");
  const loaded = await loadVerifiedKaminoLend();
  const currentLedgerInstant = await getCurrentLedgerInstant(loaded.rpc, "confirmed");
  const collateralAmount = await userTokenBalanceAtomic({
    connection: loaded.connection,
    mint: publicKey(KAMINO_LEND_DEVNET.collateralMint, "collateral mint"),
    owner,
  });
  const exchangeRate = loaded.reserve.getEstimatedCollateralExchangeRate(
    currentLedgerInstant,
    loaded.market.state.referralFeeBps,
  );
  // The SDK exchange rate is cTokens per liquidity atom. Invert it only for
  // the display estimate; the canonical position remains the exact cToken
  // balance above. Decimal math stays on the server and is converted to an
  // integer only by flooring the estimated redeemable liquidity.
  const estimatedUnderlyingAtomic = exchangeRate
    .pow(-1)
    .mul(collateralAmount.toString(10))
    .floor()
    .toFixed(0);
  if (!/^\d+$/.test(estimatedUnderlyingAtomic)) {
    error("POSITION_UNAVAILABLE", "Unable to estimate the Kamino collateral position.");
  }

  return {
    network: KAMINO_LEND_DEVNET.network,
    walletAddress: owner.toBase58(),
    market: KAMINO_LEND_DEVNET.market,
    reserve: KAMINO_LEND_DEVNET.reserve,
    mint: KAMINO_LEND_DEVNET.liquidityMint,
    collateralMint: KAMINO_LEND_DEVNET.collateralMint,
    decimals: KAMINO_LEND_DEVNET.decimals,
    collateralAmountAtomic: collateralAmount.toString(10),
    estimatedUnderlyingAmountAtomic: estimatedUnderlyingAtomic,
    state: collateralAmount > BigInt(0) ? "OPEN" as const : "EMPTY" as const,
  };
}

export async function prepareKaminoLendDevnetAction({
  action,
  walletAddress,
  amountAtomic,
}: {
  action: KaminoLendAction;
  walletAddress: string;
  amountAtomic: unknown;
}) {
  const config = readConfig();
  const requestedAmount = validateRequestedAmount(amountAtomic, config.maxAmountAtomic);
  const ownerKey = publicKey(walletAddress, "walletAddress");
  const owner = address(ownerKey.toBase58());
  const loaded = await loadVerifiedKaminoLend(config);
  const currentLedgerInstant = await getCurrentLedgerInstant(loaded.rpc, "confirmed");
  const ownerSigner = noopSigner(owner);
  const obligation = new VanillaObligation(address(KAMINO_LEND_DEVNET.programId));
  const reserveAddress = address(KAMINO_LEND_DEVNET.reserve);

  let collateralAmount: BN | null = null;
  let kaminoAction: KaminoAction;
  if (action === "deposit") {
    const liquidityBalance = await userTokenBalanceAtomic({
      connection: loaded.connection,
      mint: publicKey(KAMINO_LEND_DEVNET.liquidityMint, "liquidity mint"),
      owner: ownerKey,
    });
    if (liquidityBalance < requestedAmount) {
      error("INSUFFICIENT_LIQUIDITY_BALANCE", "Wallet does not hold the requested Devnet liquidity amount.");
    }
    kaminoAction = await KaminoAction.buildDepositReserveLiquidityTxns({
      kaminoMarket: loaded.market,
      amount: new BN(requestedAmount.toString(10)),
      reserveAddress,
      owner: ownerSigner,
      obligation,
      scopeRefreshConfig: undefined,
      currentLedgerInstant,
      extraComputeBudget: 300_000,
      includeAtaIxs: true,
    });
  } else {
    const estimatedAvailable = loaded.reserve
      .getEstimatedLiquidityAvailableAmount(currentLedgerInstant, loaded.market.state.referralFeeBps)
      .floor()
      .toFixed(0);
    if (!/^\d+$/.test(estimatedAvailable)) {
      error("RESERVE_UNAVAILABLE", "Pinned reserve returned an invalid available-liquidity amount.");
    }
    if (requestedAmount > BigInt(estimatedAvailable)) {
      error("INSUFFICIENT_RESERVE_LIQUIDITY", "The pinned Kamino reserve does not currently have enough available liquidity.");
    }
    const exchangeRate = loaded.reserve.getEstimatedCollateralExchangeRate(
      currentLedgerInstant,
      loaded.market.state.referralFeeBps,
    );
    collateralAmount = new BN(exchangeRate.mul(requestedAmount.toString(10)).ceil().toFixed(0));
    if (collateralAmount.lten(0)) {
      error("INVALID_AMOUNT", "The requested withdrawal rounds to zero collateral tokens.");
    }
    const collateralBalance = await userTokenBalanceAtomic({
      connection: loaded.connection,
      mint: publicKey(KAMINO_LEND_DEVNET.collateralMint, "collateral mint"),
      owner: ownerKey,
    });
    if (collateralBalance < BigInt(collateralAmount.toString(10))) {
      error("INSUFFICIENT_COLLATERAL_BALANCE", "Wallet does not hold enough Kamino collateral tokens for this withdrawal.");
    }
    kaminoAction = await KaminoAction.buildRedeemReserveCollateralTxns({
      kaminoMarket: loaded.market,
      amount: collateralAmount,
      reserveAddress,
      owner: ownerSigner,
      obligation,
      scopeRefreshConfig: undefined,
      currentLedgerInstant,
      extraComputeBudget: 300_000,
      includeAtaIxs: true,
    });
  }

  const instructions = KaminoAction.actionToIxs(kaminoAction);
  const expectedKaminoInstructionDigests = actionInstructionDigests(kaminoAction);
  if (expectedKaminoInstructionDigests.length !== 1) {
    error("TRANSACTION_LAYOUT_INVALID", "Kamino action did not produce exactly one lending instruction.");
  }
  const latestBlockhash = await loaded.connection.getLatestBlockhash("confirmed");
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (current) => setTransactionMessageFeePayer(owner, current),
    (current) => appendTransactionMessageInstructions(instructions, current),
    (current) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: latestBlockhash.blockhash as Blockhash,
      lastValidBlockHeight: BigInt(latestBlockhash.lastValidBlockHeight),
    }, current),
  );
  const compiled = compileTransaction(message);
  const wireTransaction = Buffer.from(getBase64EncodedWireTransaction(compiled), "base64");
  // Crossmint's serializedTransaction bridge takes a Base58 wire transaction,
  // while Kit exposes the compiled wire as Base64. Decode once here and keep
  // the response encoding explicit so the browser never guesses.
  const serializedTransaction = bs58.encode(wireTransaction);
  const transaction = VersionedTransaction.deserialize(wireTransaction);
  assertSafePreparedTransaction(transaction, action, ownerKey.toBase58());
  if (!sameStringArray(compiledKaminoInstructionDigests(transaction), expectedKaminoInstructionDigests)) {
    error("TRANSACTION_LAYOUT_INVALID", "Kamino instruction data does not match the generated action.");
  }

  let simulation;
  try {
    simulation = await loaded.connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    });
  } catch {
    error("SIMULATION_UNAVAILABLE", "Unable to simulate the Kamino transaction on Devnet.");
  }
  if (simulation.value.err) {
    error("SIMULATION_FAILED", "Kamino transaction simulation failed. Refresh balances and try again.");
  }

  trimPreparedActions();
  const prepared: PreparedKaminoAction = {
    id: randomUUID(),
    action,
    walletAddress: ownerKey.toBase58(),
    amountAtomic: requestedAmount.toString(10),
    collateralAmountAtomic: collateralAmount?.toString(10) ?? null,
    messageDigest: messageDigest(transaction),
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    expiresAt: Date.now() + PREPARED_ACTION_TTL_MS,
    kaminoInstructionDigests: expectedKaminoInstructionDigests,
    status: "PREPARED",
  };
  preparedActions.set(prepared.id, prepared);
  return publicResponse(prepared, serializedTransaction, {
    unitsConsumed: simulation.value.unitsConsumed ?? null,
  });
}

function extractStaticAccountKeys(transaction: VersionedMessageTransaction) {
  return transaction.message.staticAccountKeys.map((key) => key.toBase58());
}

export async function confirmKaminoLendDevnetAction({
  action,
  actionId,
  walletAddress,
  signature,
}: {
  action: KaminoLendAction;
  actionId: unknown;
  walletAddress: string;
  signature: unknown;
}) {
  if (typeof actionId !== "string" || !/^[0-9a-f-]{36}$/i.test(actionId)) {
    error("INVALID_ACTION", "actionId is invalid.");
  }
  if (!signatureLooksValid(signature)) error("INVALID_SIGNATURE", "Transaction signature is invalid.");
  const prepared = preparedActions.get(actionId);
  if (!prepared || prepared.action !== action) {
    error("ACTION_NOT_FOUND", "Prepared Kamino action was not found.");
  }
  if (prepared.walletAddress !== walletAddress) {
    error("WALLET_MISMATCH", "Prepared Kamino action belongs to another wallet.");
  }
  if (prepared.status === "CONFIRMED" && prepared.result) return prepared.result;
  if (prepared.status === "FAILED") error("TRANSACTION_FAILED", "Prepared Kamino transaction has already failed on-chain.");
  if (prepared.expiresAt < Date.now()) {
    preparedActions.delete(prepared.id);
    error("ACTION_EXPIRED", "Prepared Kamino transaction has expired. Prepare a new transaction.");
  }
  if (confirmingActionIds.has(prepared.id)) {
    return { confirmed: false as const, status: "PENDING" as const, actionId: prepared.id };
  }

  confirmingActionIds.add(prepared.id);
  try {
    const loaded = await loadVerifiedKaminoLend();
    const status = (await loaded.connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    })).value[0];
    if (!status) {
      return { confirmed: false as const, status: "PENDING" as const, actionId: prepared.id };
    }
    if (status.err) {
      prepared.status = "FAILED";
      error("TRANSACTION_FAILED", "Kamino transaction failed on-chain.");
    }
    // A wallet-provider return or a merely processed/confirmed signature is
    // not a completion signal. Keep the action pending until the exact wire
    // message reaches finalized commitment, then inspect its token deltas.
    if (status.confirmationStatus !== "finalized") {
      return { confirmed: false as const, status: "PENDING" as const, actionId: prepared.id };
    }
    const [rawTransaction, parsedTransaction] = await Promise.all([
      loaded.connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      }),
      loaded.connection.getParsedTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      }),
    ]);
    if (!rawTransaction || !parsedTransaction) {
      return { confirmed: false as const, status: "PENDING" as const, actionId: prepared.id };
    }
    if (rawTransaction.meta?.err || parsedTransaction.meta?.err) {
      prepared.status = "FAILED";
      error("TRANSACTION_FAILED", "Kamino transaction failed on-chain.");
    }
    const rawMessage = rawTransaction.transaction.message as { serialize?: () => Uint8Array };
    if (typeof rawMessage.serialize !== "function") {
      error("TRANSACTION_MISMATCH", "Confirmed transaction message could not be verified.");
    }
    const confirmedDigest = createHash("sha256").update(rawMessage.serialize()).digest("hex");
    if (confirmedDigest !== prepared.messageDigest) {
      error("TRANSACTION_MISMATCH", "Confirmed transaction does not match the prepared Kamino transaction.");
    }

    const transaction = rawTransaction.transaction;
    const staticKeys = extractStaticAccountKeys(transaction);
    const requiredAccounts = [
      prepared.walletAddress,
      KAMINO_LEND_DEVNET.market,
      KAMINO_LEND_DEVNET.reserve,
      KAMINO_LEND_DEVNET.liquidityMint,
      KAMINO_LEND_DEVNET.collateralMint,
      KAMINO_LEND_DEVNET.supplyVault,
    ];
    if (requiredAccounts.some((account) => !staticKeys.includes(account))) {
      error("TRANSACTION_MISMATCH", "Confirmed transaction is missing a required Kamino account.");
    }
    if (!sameStringArray(compiledKaminoInstructionDigests(transaction), prepared.kaminoInstructionDigests)) {
      error("TRANSACTION_MISMATCH", "Confirmed transaction does not contain the expected Kamino instruction.");
    }
    const parsedWalletSigner = parsedTransaction.transaction.message.accountKeys.some(
      (key) => key.pubkey.toBase58() === prepared.walletAddress && key.signer,
    );
    if (!parsedWalletSigner) {
      error("TRANSACTION_MISMATCH", "Confirmed transaction was not signed by the prepared wallet.");
    }

    const preLiquidity = balanceDeltaAtomic(parsedTransaction.meta?.preTokenBalances, prepared.walletAddress, KAMINO_LEND_DEVNET.liquidityMint);
    const postLiquidity = balanceDeltaAtomic(parsedTransaction.meta?.postTokenBalances, prepared.walletAddress, KAMINO_LEND_DEVNET.liquidityMint);
    const preCollateral = balanceDeltaAtomic(parsedTransaction.meta?.preTokenBalances, prepared.walletAddress, KAMINO_LEND_DEVNET.collateralMint);
    const postCollateral = balanceDeltaAtomic(parsedTransaction.meta?.postTokenBalances, prepared.walletAddress, KAMINO_LEND_DEVNET.collateralMint);
    const liquidityDelta = postLiquidity - preLiquidity;
    const collateralDelta = postCollateral - preCollateral;
    const requestedAmount = BigInt(prepared.amountAtomic);
    const collateralAmount = prepared.collateralAmountAtomic === null ? null : BigInt(prepared.collateralAmountAtomic);
    if (prepared.action === "deposit") {
      if (liquidityDelta !== -requestedAmount || collateralDelta <= BigInt(0)) {
        error("TRANSACTION_MISMATCH", "Confirmed Kamino deposit token deltas do not match the prepared action.");
      }
    } else if (collateralAmount === null || collateralDelta !== -collateralAmount || liquidityDelta < requestedAmount) {
      error("TRANSACTION_MISMATCH", "Confirmed Kamino withdrawal token deltas do not match the prepared action.");
    }

    const result: ConfirmedKaminoLendAction = {
      confirmed: true,
      status: "COMPLETED",
      actionId: prepared.id,
      action: prepared.action,
      network: KAMINO_LEND_DEVNET.network,
      signature,
      market: KAMINO_LEND_DEVNET.market,
      reserve: KAMINO_LEND_DEVNET.reserve,
      mint: KAMINO_LEND_DEVNET.liquidityMint,
      amountAtomic: prepared.amountAtomic,
      collateralAmountAtomic: prepared.collateralAmountAtomic,
      actualLiquidityAmountAtomic: (prepared.action === "deposit" ? -liquidityDelta : liquidityDelta).toString(10),
      actualCollateralAmountAtomic: (prepared.action === "deposit" ? collateralDelta : -collateralDelta).toString(10),
    };
    prepared.status = "CONFIRMED";
    prepared.result = result;
    return result;
  } finally {
    confirmingActionIds.delete(prepared.id);
  }
}
