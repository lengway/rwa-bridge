export const RWA_DEMO_ASSET_ID = "rwa-demo";

export const RWA_DEMO_FUNDING_DISCLOSURE = "SIMULATED — no fiat payment. DEVNET TEST TOKEN — no monetary value.";
export const RWA_DEMO_SWAP_DISCLOSURE = "DEVNET SWAP — no real asset rights.";
export const RWA_DEMO_PAYOUT_DISCLOSURE = "SIMULATED — no KZT payout.";

export const RWA_DEMO_ROUTE = "meteora-dlmm-devnet" as const;
export const RWA_DEMO_NETWORK = "devnet" as const;

// This is intentionally a pure, exported guard so configuration can be
// validated without making an RPC request. The RPC check still happens at
// runtime before any quote, swap, or faucet operation.
export const SOLANA_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export function isCanonicalDevnetTarget(cluster: unknown, genesisHash: unknown) {
  return cluster === RWA_DEMO_NETWORK && genesisHash === SOLANA_DEVNET_GENESIS_HASH;
}

export type RwaDemoSide = "BUY" | "SELL";

export type RwaDemoOrderStatus =
  | "QUOTE_READY"
  | "ORDER_CREATED"
  | "WALLET_APPROVAL_PENDING"
  | "TRANSACTION_SUBMITTED"
  | "ONCHAIN_CONFIRMED"
  | "COMPLETED"
  | "QUOTE_EXPIRED"
  | "USER_REJECTED"
  | "TRANSACTION_FAILED"
  | "CONFIRMATION_TIMEOUT"
  | "NEEDS_REVIEW";

export type RwaDemoFundingStatus =
  | "SIMULATED_CREATED"
  | "SIMULATED_CONFIRMED"
  | "TEST_TOKEN_ISSUED"
  | "FAILED"
  | "NEEDS_REVIEW";

export type RwaDemoPayoutStatus = "SIMULATED_CREATED" | "SIMULATED_CONFIRMED";

const ATOMIC_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export class RwaDemoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RwaDemoValidationError";
  }
}

export function parseAtomicAmount(value: unknown, label = "amount"): bigint {
  if (typeof value !== "string" || !ATOMIC_AMOUNT_PATTERN.test(value)) {
    throw new RwaDemoValidationError(`${label} must be a non-negative atomic integer string.`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new RwaDemoValidationError(`${label} is not a valid atomic integer.`);
  }
}

export function requirePositiveAtomicAmount(value: unknown, label = "amount", maximum?: bigint): bigint {
  const amount = parseAtomicAmount(value, label);
  if (amount <= BigInt(0)) throw new RwaDemoValidationError(`${label} must be greater than zero.`);
  if (maximum !== undefined && amount > maximum) {
    throw new RwaDemoValidationError(`${label} exceeds the configured limit.`);
  }
  return amount;
}

export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function parseKztAmount(value: unknown, maximum: bigint): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RwaDemoValidationError("requestedKztAmount must be a positive whole-tenge amount.");
    }
    value = String(value);
  }
  const amount = requirePositiveAtomicAmount(value, "requestedKztAmount", maximum);
  return amount;
}

export function tokenScale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RwaDemoValidationError("Token decimals must be an integer between 0 and 18.");
  }
  return BigInt(10) ** BigInt(decimals);
}

export function quoteAtomicFromKzt({
  requestedKzt,
  kztPerQuoteToken,
  quoteDecimals,
}: {
  requestedKzt: bigint;
  kztPerQuoteToken: bigint;
  quoteDecimals: number;
}): bigint {
  if (kztPerQuoteToken <= BigInt(0)) {
    throw new RwaDemoValidationError("Simulated KZT rate must be greater than zero.");
  }
  return (requestedKzt * tokenScale(quoteDecimals)) / kztPerQuoteToken;
}

export function kztFromQuoteAtomic({
  quoteAmountAtomic,
  kztPerQuoteToken,
  quoteDecimals,
}: {
  quoteAmountAtomic: bigint;
  kztPerQuoteToken: bigint;
  quoteDecimals: number;
}): bigint {
  if (quoteAmountAtomic < BigInt(0) || kztPerQuoteToken <= BigInt(0)) {
    throw new RwaDemoValidationError("Cannot calculate the simulated KZT amount.");
  }
  return (quoteAmountAtomic * kztPerQuoteToken) / tokenScale(quoteDecimals);
}

export function isQuoteExpired(expiresAt: number, now = Date.now()) {
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function assertOrderTransition(from: RwaDemoOrderStatus, to: RwaDemoOrderStatus) {
  if (from === to) return;
  const transitions: Record<RwaDemoOrderStatus, ReadonlySet<RwaDemoOrderStatus>> = {
    QUOTE_READY: new Set(["ORDER_CREATED", "QUOTE_EXPIRED"]),
    ORDER_CREATED: new Set(["WALLET_APPROVAL_PENDING", "QUOTE_EXPIRED", "USER_REJECTED"]),
    WALLET_APPROVAL_PENDING: new Set(["WALLET_APPROVAL_PENDING", "TRANSACTION_SUBMITTED", "QUOTE_EXPIRED", "USER_REJECTED"]),
    TRANSACTION_SUBMITTED: new Set(["ONCHAIN_CONFIRMED", "TRANSACTION_FAILED", "CONFIRMATION_TIMEOUT", "NEEDS_REVIEW"]),
    ONCHAIN_CONFIRMED: new Set(["COMPLETED", "NEEDS_REVIEW"]),
    COMPLETED: new Set(),
    QUOTE_EXPIRED: new Set(["WALLET_APPROVAL_PENDING", "USER_REJECTED"]),
    USER_REJECTED: new Set(["WALLET_APPROVAL_PENDING"]),
    TRANSACTION_FAILED: new Set(),
    CONFIRMATION_TIMEOUT: new Set(["WALLET_APPROVAL_PENDING", "TRANSACTION_SUBMITTED", "ONCHAIN_CONFIRMED", "TRANSACTION_FAILED", "NEEDS_REVIEW"]),
    NEEDS_REVIEW: new Set(),
  };
  if (!transitions[from].has(to)) {
    throw new RwaDemoValidationError(`Invalid Devnet test-asset order state transition: ${from} -> ${to}.`);
  }
}

export function isCompletedSell(order: { side: RwaDemoSide; status: RwaDemoOrderStatus }) {
  return order.side === "SELL" && order.status === "COMPLETED";
}

export function serializeAtomic(value: bigint) {
  return value.toString(10);
}
