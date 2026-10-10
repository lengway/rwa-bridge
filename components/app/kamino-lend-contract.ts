/**
 * Browser-side contract guards for the Kamino Lend Devnet route.
 *
 * The API is intentionally treated as untrusted at this boundary: a wallet
 * transaction is never offered for signing unless the server declares the
 * Devnet route ready and returns a successful simulation for the exact
 * market, reserve, mint, action, and atomic amount selected by the user.
 */

export type KaminoLendAction = "deposit" | "withdraw";

export type KaminoLendMarket = Readonly<{
  ready: boolean;
  network: "devnet";
  reason: string | null;
  market: Readonly<{
    address: string;
    name: string | null;
  }> | null;
  reserve: Readonly<{
    address: string;
    mint: string;
    collateralMint: string;
    decimals: number;
    maximumAmountAtomic: string | null;
    availableLiquidityAtomic: string | null;
  }> | null;
  wallet?: Readonly<{
    address: string;
    liquidityBalanceAtomic: string;
    collateralBalanceAtomic: string;
  }>;
}>;

export type PreparedKaminoLendAction = Readonly<{
  action: KaminoLendAction;
  actionId: string;
  network: "devnet";
  serializedTransaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  transactionMessageDigest: string;
  market: string;
  reserve: string;
  amountAtomic: string;
  collateralAmountAtomic: string | null;
  simulation: Readonly<{
    ok: true;
    unitsConsumed: number | null;
  }>;
}>;

export type KaminoLendConfirmation = Readonly<{
  action: KaminoLendAction;
  actionId: string;
  confirmed: true;
  signature: string;
  explorerUrl: string;
  status: string | null;
}>;

type UnknownRecord = Record<string, unknown>;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Crossmint's raw Solana transaction path forwards this value unchanged. Its
// object-based overload encodes a VersionedTransaction as base58, so retain
// that wire format end-to-end rather than treating arbitrary base64 as safe.
const BASE58_TRANSACTION = /^[1-9A-HJ-NP-Za-km-z]+$/;
const POSITIVE_ATOMIC = /^(?:[1-9]\d*)$/;
const NON_NEGATIVE_ATOMIC = /^(?:0|[1-9]\d*)$/;

/**
 * Normalizes the market endpoint while keeping an unavailable route useful to
 * the UI. A ready route must still contain every verified on-chain address.
 */
export function normalizeKaminoLendMarket(value: unknown): KaminoLendMarket | null {
  const source = asRecord(value);
  if (!source || source.network !== "devnet") return null;

  const ready = source.ready === true && source.configured === true;
  const reason = readText(source.reason) ?? readText(source.unavailableReason);
  if (!ready) {
    return {
      ready: false,
      network: "devnet",
      reason: reason ?? "Маршрут Kamino Lend временно недоступен.",
      market: null,
      reserve: null,
    };
  }

  const marketSource = asRecord(source.market);
  const reserveSource = asRecord(source.reserve);
  const limits = asRecord(source.limits);
  const marketAddress = readAddress(marketSource?.address ?? source.marketAddress ?? source.market);
  const reserveAddress = readAddress(reserveSource?.address ?? source.reserveAddress ?? source.reserve);
  const mint = readAddress(reserveSource?.mint ?? source.mint);
  const collateralMint = readAddress(reserveSource?.collateralMint ?? source.collateralMint);
  const decimals = readDecimals(reserveSource?.decimals ?? source.decimals);

  if (!marketAddress || !reserveAddress || !mint || !collateralMint || decimals === null) return null;

  const walletSource = asRecord(source.wallet);
  const walletAddress = readAddress(walletSource?.address);
  const liquidityBalanceAtomic = readAtomic(walletSource?.liquidityBalanceAtomic);
  const collateralBalanceAtomic = readAtomic(walletSource?.collateralBalanceAtomic);
  const wallet = walletAddress && liquidityBalanceAtomic && collateralBalanceAtomic
    ? { address: walletAddress, liquidityBalanceAtomic, collateralBalanceAtomic }
    : undefined;

  return {
    ready: true,
    network: "devnet",
    reason: null,
    market: {
      address: marketAddress,
      name: readText(marketSource?.name ?? source.marketName),
    },
    reserve: {
      address: reserveAddress,
      mint,
      collateralMint,
      decimals,
      maximumAmountAtomic: readAtomic(limits?.maxAmountAtomic ?? source.maximumAmountAtomic),
      availableLiquidityAtomic: readAtomic(reserveSource?.availableLiquidityAtomic ?? source.availableLiquidityAtomic),
    },
    ...(wallet ? { wallet } : {}),
  };
}

/**
 * A prepare response is deliberately strict. In particular, a transaction
 * without an explicit successful simulation is never passed to a wallet.
 */
export function normalizePreparedKaminoLendAction(
  value: unknown,
  expectedAction: KaminoLendAction,
): PreparedKaminoLendAction | null {
  const source = asRecord(value);
  if (!source || source.network !== "devnet" || source.action !== expectedAction) return null;

  const actionId = readActionId(source.actionId);
  const serializedTransaction = readSerializedTransaction(source.serializedTransaction);
  const blockhash = readAddress(source.blockhash);
  const lastValidBlockHeight = readNonNegativeSafeInteger(source.lastValidBlockHeight);
  const transactionMessageDigest = readMessageDigest(source.transactionMessageDigest);
  const market = readAddress(source.market);
  const reserve = readAddress(source.reserve);
  const amountAtomic = readPositiveAtomic(source.amountAtomic);
  const collateralAmountAtomic = readAtomic(source.collateralAmountAtomic);
  const simulation = asRecord(source.simulation);

  if (!actionId || !serializedTransaction || !blockhash || lastValidBlockHeight === null || !transactionMessageDigest
    || !market || !reserve || !amountAtomic || !simulation
    || simulation.ok !== true || simulation.err !== null) {
    return null;
  }

  const unitsConsumed = readNonNegativeSafeInteger(simulation.unitsConsumed);
  if (simulation.unitsConsumed !== null && unitsConsumed === null) return null;

  return {
    action: expectedAction,
    actionId,
    network: "devnet",
    serializedTransaction,
    blockhash,
    lastValidBlockHeight,
    transactionMessageDigest,
    market,
    reserve,
    amountAtomic,
    collateralAmountAtomic,
    simulation: { ok: true, unitsConsumed },
  };
}

export function preparedActionMatchesMarket(
  prepared: PreparedKaminoLendAction,
  market: KaminoLendMarket,
  amountAtomic: string,
) {
  return market.ready
    && market.market !== null
    && market.reserve !== null
    && prepared.network === "devnet"
    && prepared.market === market.market.address
    && prepared.reserve === market.reserve.address
    && prepared.amountAtomic === amountAtomic;
}

/** Do not surface success unless the API confirms finalized completion. */
export function normalizeKaminoLendConfirmation(
  value: unknown,
  expectedAction: KaminoLendAction,
  expectedActionId: string,
  expectedSignature: string,
): KaminoLendConfirmation | null {
  const source = asRecord(value);
  if (
    !source
    || source.network !== "devnet"
    || source.action !== expectedAction
    || source.actionId !== expectedActionId
  ) {
    return null;
  }

  const status = readText(source.status);
  const isConfirmed = source.confirmed === true && status === "COMPLETED";
  const signature = readSignature(source.signature) ?? expectedSignature;
  if (!isConfirmed || !signature || signature !== expectedSignature) return null;

  return {
    action: expectedAction,
    actionId: expectedActionId,
    confirmed: true,
    signature,
    explorerUrl: readExplorerUrl(source.explorerUrl) ?? explorerForSignature(signature),
    status,
  };
}

/** Converts a decimal UI amount into exact SPL-token atomic units. */
export function decimalToAtomic(value: string, decimals: number): string | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
  const normalized = value.trim().replace(",", ".");
  if (decimals === 0) {
    if (!/^(0|[1-9]\d*)$/.test(normalized) || normalized === "0") return null;
    return normalized;
  }
  const expression = new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${decimals}}))?$`);
  const match = normalized.match(expression);
  if (!match) return null;

  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  const scale = BigInt(10) ** BigInt(decimals);
  const atomic = BigInt(whole) * scale + BigInt(fraction || "0");
  return atomic > BigInt(0) ? atomic.toString(10) : null;
}

/** Formats an atomic SPL amount without converting it to an unsafe JS number. */
export function formatAtomicAmount(value: string, decimals: number) {
  if (!NON_NEGATIVE_ATOMIC.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return "—";
  const normalized = value.replace(/^0+(?=\d)/, "") || "0";
  if (decimals === 0) return groupDigits(normalized);

  const padded = normalized.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals).replace(/^0+(?=\d)/, "") || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${groupDigits(whole)}.${fraction}` : groupDigits(whole);
}

export function formatBps(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  return `${(value / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

export function explorerForSignature(signature: string) {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}

export function readKaminoApiError(value: unknown, fallback: string) {
  const source = asRecord(value);
  return readText(source?.error) ?? readText(source?.message) ?? fallback;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readAddress(value: unknown) {
  const address = readText(value);
  return address && BASE58_ADDRESS.test(address) ? address : null;
}

function readSignature(value: unknown) {
  return readAddress(value);
}

function readActionId(value: unknown) {
  const id = readText(value);
  return id && /^[A-Za-z0-9_-]{8,160}$/.test(id) ? id : null;
}

function readMessageDigest(value: unknown) {
  const digest = readText(value);
  return digest && /^[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : null;
}

function readSerializedTransaction(value: unknown) {
  const encoded = readText(value);
  return encoded && encoded.length >= 16 && BASE58_TRANSACTION.test(encoded) ? encoded : null;
}

function readAtomic(value: unknown) {
  const atomic = readText(value);
  return atomic && NON_NEGATIVE_ATOMIC.test(atomic) ? atomic : null;
}

function readPositiveAtomic(value: unknown) {
  const atomic = readText(value);
  return atomic && POSITIVE_ATOMIC.test(atomic) ? atomic : null;
}

function readDecimals(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 18 ? value : null;
}

function readNonNegativeSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readExplorerUrl(value: unknown) {
  const url = readText(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "explorer.solana.com" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function groupDigits(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
