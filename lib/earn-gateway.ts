/**
 * Pure, dependency-free contract for the first Universal Earn catalog.
 *
 * This catalog deliberately models only a controlled Devnet environment. It does not build,
 * sign, submit, or confirm transactions; integrations must apply their own
 * wallet/RPC checks in addition to the guards below.
 */

export const EARN_DEVNET_CLUSTER = "devnet" as const;

export type EarnNetwork = typeof EARN_DEVNET_CLUSTER;
export type EarnProviderId = "SIMULATED_DEMO" | "KAMINO" | "NATIVE_STAKE";
export type EarnStrategyMode = "SIMULATED_DEMO" | "KAMINO" | "NATIVE_STAKE";
/**
 * `REDEMPTION_ONLY` is a migration state, not a second marketed strategy:
 * old Devnet demo shares may exit, while no quote, funding, or deposit can
 * begin for that record.
 */
export type EarnStrategyAvailability = "ENABLED" | "DISABLED" | "REDEMPTION_ONLY";
export type EarnFundingKind = "SIMULATED" | "UNAVAILABLE";
export type EarnPayoutKind = "SIMULATED" | "UNAVAILABLE";
export type EarnYieldKind = "ILLUSTRATIVE" | "UNAVAILABLE";

export const EARN_REQUIRED_DISCLOSURE_LABELS = [
  "SOLANA DEVNET",
  "SIMULATED FUNDING",
  "ILLUSTRATIVE YIELD",
  "NO MONETARY VALUE",
] as const;

export type EarnDisclosureLabel = (typeof EARN_REQUIRED_DISCLOSURE_LABELS)[number];

export type EarnDisclosure = Readonly<{
  label: EarnDisclosureLabel;
  text: string;
}>;

export type EarnStrategyOperation =
  | "quote"
  | "fund"
  | "deposit"
  | "withdraw"
  | "exit"
  | "payout"
  | "position";

export type EarnStrategyCapabilities = Readonly<Record<EarnStrategyOperation, boolean>>;

export type EarnSourceMetadata = Readonly<{
  provider: EarnProviderId;
  label: string;
  /** A human-readable reason when an external provider has not passed its gate. */
  statusNote: string;
  referenceUrl: string | null;
}>;

export type EarnFundingMetadata = Readonly<{
  kind: EarnFundingKind;
  label: string;
  description: string;
  acceptsFiat: false;
}>;

export type EarnPayoutMetadata = Readonly<{
  kind: EarnPayoutKind;
  label: string;
  description: string;
  sendsFiat: false;
}>;

export type EarnYieldMetadata = Readonly<{
  kind: EarnYieldKind;
  label: string;
  /**
   * BPS is an integer representation, never a floating-point APY. The first
   * demo deliberately has no numeric claim, so this remains null.
   */
  apyBps: number | null;
  sourceNote: string;
}>;

export type EarnStrategyId =
  | "devnet-simulated-demo"
  | "legacy-devnet-redemption"
  | "kamino-devnet-placeholder"
  | "native-sol-stake-placeholder";

/**
 * The normalized catalog shape consumed by adapters and UI mappings. Keep the
 * top-level compatibility fields explicit instead of requiring consumers to
 * infer claims from a provider name.
 */
export type EarnStrategy = Readonly<{
  id: EarnStrategyId;
  name: string;
  provider: EarnProviderId;
  source: EarnSourceMetadata;
  sourceLabel: string;
  network: EarnNetwork;
  mode: EarnStrategyMode;
  availability: EarnStrategyAvailability;
  availabilityReason: string | null;
  capabilities: EarnStrategyCapabilities;
  fundingKind: EarnFundingKind;
  funding: EarnFundingMetadata;
  payoutKind: EarnPayoutKind;
  payout: EarnPayoutMetadata;
  yieldKind: EarnYieldKind;
  yield: EarnYieldMetadata;
  disclosures: readonly EarnDisclosure[];
}>;

/**
 * Browser-facing catalog values deliberately describe the actual cluster and
 * product surface without exposing internal implementation identifiers. The
 * explicit funding, payout, yield, and no-value disclosures remain intact.
 */
export type PublicEarnProviderId = "PLAIN_DEVNET" | Exclude<EarnProviderId, "SIMULATED_DEMO">;
export type PublicEarnStrategyMode = "DEVNET" | Exclude<EarnStrategyMode, "SIMULATED_DEMO">;
export type PublicEarnStrategy = Readonly<
  Omit<EarnStrategy, "id" | "provider" | "mode" | "source"> & {
    id: string;
    provider: PublicEarnProviderId;
    mode: PublicEarnStrategyMode;
    source: Omit<EarnSourceMetadata, "provider"> & { provider: PublicEarnProviderId };
  }
>;

/**
 * A normalized, JSON-safe position shape for provider adapters. The current
 * demo keeps its durable action records in the Devnet ledger; this contract
 * keeps later providers from reintroducing floating-point balances or inferred
 * yield claims at the UI/API boundary.
 */
export type EarnPosition = Readonly<{
  strategyId: EarnStrategyId;
  shareBalanceAtomic: string;
  redemptionValueAtomic: string;
  state: "ACTIVE" | "EXIT_PENDING" | "EXITED" | "NEEDS_REVIEW";
  yieldKind: EarnYieldKind;
  updatedAt: number;
}>;

/** Capability-aware provider boundary; implementations must return a gate. */
export interface YieldProvider {
  readonly provider: EarnProviderId;
  readonly network: EarnNetwork;
  getStrategy(strategyId: EarnStrategyId): EarnStrategy | null;
  getOperationGate(
    strategy: EarnStrategy | EarnStrategyId,
    operation: EarnStrategyOperation,
  ): EarnStrategyOperationGate;
}

/** Funding adapters expose their non-fiat guarantee explicitly. */
export interface FundingProvider {
  readonly kind: EarnFundingKind;
  readonly network: EarnNetwork;
  readonly acceptsFiat: false;
  getFunding(strategy: EarnStrategy | EarnStrategyId): EarnFundingMetadata;
  getOperationGate(
    strategy: EarnStrategy | EarnStrategyId,
  ): EarnStrategyOperationGate;
}

/** What the existing embedded wallet must prove before an Earn action starts. */
export type EarnWalletCapabilities = Readonly<{
  network: EarnNetwork;
  canSignSplTransfer: boolean;
  canSignRawTransaction: boolean;
}>;

export type EarnGatewayErrorCode =
  | "INVALID_DECIMALS"
  | "INVALID_DECIMAL_AMOUNT"
  | "INVALID_ATOMIC_AMOUNT"
  | "STRATEGY_NOT_FOUND"
  | "INVALID_OPERATION"
  | "OPERATION_NOT_SUPPORTED"
  | "QUOTE_EXPIRED"
  | "QUOTE_NOT_READY"
  | "INVALID_QUOTE_TRANSITION"
  | "INVALID_OPERATION_TRANSITION"
  | "UNSAFE_CLUSTER"
  | "INVALID_DISCLOSURES"
  | "INVALID_CATALOG";

export class EarnGatewayError extends Error {
  readonly code: EarnGatewayErrorCode;

  constructor(code: EarnGatewayErrorCode, message: string) {
    super(message);
    this.name = "EarnGatewayError";
    this.code = code;
  }
}

const REQUIRED_DISCLOSURES: readonly EarnDisclosure[] = [
  {
    label: "SOLANA DEVNET",
    text: "SOLANA DEVNET — this strategy is limited to the Solana Devnet cluster.",
  },
  {
    label: "SIMULATED FUNDING",
    text: "SIMULATED FUNDING — no fiat payment is accepted or processed.",
  },
  {
    label: "ILLUSTRATIVE YIELD",
    text: "ILLUSTRATIVE YIELD — any displayed return is illustrative, not earned or on-chain yield.",
  },
  {
    label: "NO MONETARY VALUE",
    text: "NO MONETARY VALUE — Devnet tokens, balances, and payout records have no monetary value.",
  },
];

/** Exported so every presentation layer renders the exact same disclosures. */
export const EARN_REQUIRED_DISCLOSURES = REQUIRED_DISCLOSURES;

const ENABLED_DEMO_CAPABILITIES: EarnStrategyCapabilities = {
  quote: true,
  fund: true,
  deposit: true,
  withdraw: true,
  exit: true,
  payout: true,
  position: true,
};

const DISABLED_CAPABILITIES: EarnStrategyCapabilities = {
  quote: false,
  fund: false,
  deposit: false,
  withdraw: false,
  exit: false,
  payout: false,
  position: false,
};

const REDEMPTION_ONLY_CAPABILITIES: EarnStrategyCapabilities = {
  quote: false,
  fund: false,
  deposit: false,
  withdraw: true,
  exit: true,
  payout: true,
  position: true,
};

/**
 * One executable catalog entry is intentional. Kamino and native staking are
 * visible only as typed, fail-closed placeholders until a specific Devnet
 * route, asset, eligibility, and lifecycle have been independently verified.
 */
export const EARN_STRATEGIES: readonly EarnStrategy[] = [
  {
    id: "devnet-simulated-demo",
    name: "Devnet Earn Strategy",
    provider: "SIMULATED_DEMO",
    source: {
      provider: "SIMULATED_DEMO",
      label: "Internal Solana Devnet ledger",
      statusNote: "A Devnet strategy with explicit simulated funding, payout, and illustrative yield metadata.",
      referenceUrl: null,
    },
    sourceLabel: "Internal Solana Devnet ledger",
    network: EARN_DEVNET_CLUSTER,
    mode: "SIMULATED_DEMO",
    availability: "ENABLED",
    availabilityReason: null,
    capabilities: ENABLED_DEMO_CAPABILITIES,
    fundingKind: "SIMULATED",
    funding: {
      kind: "SIMULATED",
      label: "SIMULATED FUNDING",
      description: "Records a simulated Devnet funding intent only; no fiat payment is collected.",
      acceptsFiat: false,
    },
    payoutKind: "SIMULATED",
    payout: {
      kind: "SIMULATED",
      label: "SIMULATED PAYOUT",
      description: "Records a simulated Devnet payout only; no fiat or off-ramp transfer is sent.",
      sendsFiat: false,
    },
    yieldKind: "ILLUSTRATIVE",
    yield: {
      kind: "ILLUSTRATIVE",
      label: "ILLUSTRATIVE YIELD",
      apyBps: null,
      sourceNote: "Yield is illustrative only and is excluded from real balance accounting.",
    },
    disclosures: REQUIRED_DISCLOSURES,
  },
  {
    id: "legacy-devnet-redemption",
    name: "Legacy Devnet redemption",
    provider: "SIMULATED_DEMO",
    source: {
      provider: "SIMULATED_DEMO",
      label: "Legacy Solana Devnet ledger",
      statusNote: "Historic Devnet shares may be redeemed only; new funding, quotes, and deposits are disabled.",
      referenceUrl: null,
    },
    sourceLabel: "Legacy Solana Devnet ledger",
    network: EARN_DEVNET_CLUSTER,
    mode: "SIMULATED_DEMO",
    availability: "REDEMPTION_ONLY",
    availabilityReason: "This historic Devnet entry supports exit only and is not offered for new deposits.",
    capabilities: REDEMPTION_ONLY_CAPABILITIES,
    fundingKind: "UNAVAILABLE",
    funding: {
      kind: "UNAVAILABLE",
      label: "Funding unavailable",
      description: "Historic Devnet shares cannot receive new funding.",
      acceptsFiat: false,
    },
    payoutKind: "SIMULATED",
    payout: {
      kind: "SIMULATED",
      label: "SIMULATED PAYOUT",
      description: "A legacy redemption returns Devnet test tokens only; no fiat or off-ramp transfer is sent.",
      sendsFiat: false,
    },
    yieldKind: "ILLUSTRATIVE",
    yield: {
      kind: "ILLUSTRATIVE",
      label: "ILLUSTRATIVE YIELD",
      apyBps: null,
      sourceNote: "Historic Devnet positions do not accrue real or on-chain yield.",
    },
    disclosures: REQUIRED_DISCLOSURES,
  },
  {
    id: "kamino-devnet-placeholder",
    name: "Kamino (verification required)",
    provider: "KAMINO",
    source: {
      provider: "KAMINO",
      label: "Kamino",
      statusNote: "Disabled until a specific, supported Devnet market or vault and user route are verified.",
      referenceUrl: "https://github.com/Kamino-Finance/klend",
    },
    sourceLabel: "Kamino — disabled pending verified Devnet route",
    network: EARN_DEVNET_CLUSTER,
    mode: "KAMINO",
    availability: "DISABLED",
    availabilityReason: "No verified, supported Devnet Kamino user strategy is configured.",
    capabilities: DISABLED_CAPABILITIES,
    fundingKind: "UNAVAILABLE",
    funding: {
      kind: "UNAVAILABLE",
      label: "Funding unavailable",
      description: "No funding route is enabled for this placeholder.",
      acceptsFiat: false,
    },
    payoutKind: "UNAVAILABLE",
    payout: {
      kind: "UNAVAILABLE",
      label: "Payout unavailable",
      description: "No payout route is enabled for this placeholder.",
      sendsFiat: false,
    },
    yieldKind: "UNAVAILABLE",
    yield: {
      kind: "UNAVAILABLE",
      label: "Yield unavailable",
      apyBps: null,
      sourceNote: "No provider-derived yield value has been verified for this route.",
    },
    disclosures: REQUIRED_DISCLOSURES,
  },
  {
    id: "native-sol-stake-placeholder",
    name: "Native SOL staking (verification required)",
    provider: "NATIVE_STAKE",
    source: {
      provider: "NATIVE_STAKE",
      label: "Solana native staking",
      statusNote: "Disabled until a stake-account lifecycle, activation, and epoch-bound exit path are implemented.",
      referenceUrl: "https://solana.com/docs/core/staking/stake-accounts",
    },
    sourceLabel: "Native SOL staking — disabled pending lifecycle support",
    network: EARN_DEVNET_CLUSTER,
    mode: "NATIVE_STAKE",
    availability: "DISABLED",
    availabilityReason: "Native staking withdrawal is epoch-bound and no lifecycle adapter is configured.",
    capabilities: DISABLED_CAPABILITIES,
    fundingKind: "UNAVAILABLE",
    funding: {
      kind: "UNAVAILABLE",
      label: "Funding unavailable",
      description: "No funding route is enabled for this placeholder.",
      acceptsFiat: false,
    },
    payoutKind: "UNAVAILABLE",
    payout: {
      kind: "UNAVAILABLE",
      label: "Payout unavailable",
      description: "No payout route is enabled for this placeholder.",
      sendsFiat: false,
    },
    yieldKind: "UNAVAILABLE",
    yield: {
      kind: "UNAVAILABLE",
      label: "Yield unavailable",
      apyBps: null,
      sourceNote: "No staking yield value is exposed until the lifecycle adapter is verified.",
    },
    disclosures: REQUIRED_DISCLOSURES,
  },
];

const PUBLIC_EARN_STRATEGY_IDS: Readonly<Record<EarnStrategyId, string>> = {
  "devnet-simulated-demo": "devnet-simulated-earn",
  "legacy-devnet-redemption": "legacy-devnet-redemption",
  "kamino-devnet-placeholder": "kamino-devnet-placeholder",
  "native-sol-stake-placeholder": "native-sol-stake-placeholder",
};

export function toPublicEarnStrategy(strategy: EarnStrategy): PublicEarnStrategy {
  const provider: PublicEarnProviderId = strategy.provider === "SIMULATED_DEMO"
    ? "PLAIN_DEVNET"
    : strategy.provider;
  const mode: PublicEarnStrategyMode = strategy.mode === "SIMULATED_DEMO"
    ? "DEVNET"
    : strategy.mode;

  return {
    ...strategy,
    id: PUBLIC_EARN_STRATEGY_IDS[strategy.id],
    provider,
    mode,
    source: {
      ...strategy.source,
      provider,
    },
  };
}

export const ENABLED_EARN_STRATEGIES: readonly EarnStrategy[] = EARN_STRATEGIES.filter(
  (strategy) => strategy.availability === "ENABLED",
);

const DECIMAL_AMOUNT_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const ATOMIC_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)$/;
const MAX_TOKEN_DECIMALS = 18;
const ZERO = BigInt(0);
const TEN = BigInt(10);

function assertTokenDecimals(decimals: number): void {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    throw new EarnGatewayError(
      "INVALID_DECIMALS",
      `Token decimals must be a whole number between 0 and ${MAX_TOKEN_DECIMALS}.`,
    );
  }
}

/** Returns the exact integer scale for a token decimal precision. */
export function atomicScale(decimals: number): bigint {
  assertTokenDecimals(decimals);
  return TEN ** BigInt(decimals);
}

/**
 * Converts a canonical decimal string to base units without using Number or a
 * floating-point intermediate. Scientific notation, signs, whitespace, and
 * precision that cannot be represented by the requested token are rejected.
 */
export function parseDecimalToAtomic(value: unknown, decimals: number, label = "amount"): bigint {
  assertTokenDecimals(decimals);
  if (typeof value !== "string") {
    throw new EarnGatewayError("INVALID_DECIMAL_AMOUNT", `${label} must be a decimal string.`);
  }

  const match = DECIMAL_AMOUNT_PATTERN.exec(value);
  if (!match) {
    throw new EarnGatewayError(
      "INVALID_DECIMAL_AMOUNT",
      `${label} must be a non-negative canonical decimal string.`,
    );
  }

  const whole = match[1];
  const fractional = match[2] ?? "";
  if (fractional.length > decimals) {
    throw new EarnGatewayError(
      "INVALID_DECIMAL_AMOUNT",
      `${label} has more than ${decimals} decimal places.`,
    );
  }

  const fractionalAtomic = fractional.padEnd(decimals, "0") || "0";
  return BigInt(whole) * atomicScale(decimals) + BigInt(fractionalAtomic);
}

export function requirePositiveDecimalToAtomic(value: unknown, decimals: number, label = "amount"): bigint {
  const amount = parseDecimalToAtomic(value, decimals, label);
  if (amount <= ZERO) {
    throw new EarnGatewayError("INVALID_DECIMAL_AMOUNT", `${label} must be greater than zero.`);
  }
  return amount;
}

/** Formats a non-negative base-unit amount as a canonical decimal string. */
export function formatAtomicToDecimal(
  amountAtomic: unknown,
  decimals: number,
  options: Readonly<{ trimTrailingZeros?: boolean }> = {},
): string {
  assertTokenDecimals(decimals);
  if (typeof amountAtomic !== "bigint" || amountAtomic < ZERO) {
    throw new EarnGatewayError(
      "INVALID_ATOMIC_AMOUNT",
      "amountAtomic must be a non-negative bigint.",
    );
  }

  if (decimals === 0) return amountAtomic.toString(10);

  const scale = atomicScale(decimals);
  const whole = amountAtomic / scale;
  let fractional = (amountAtomic % scale).toString(10).padStart(decimals, "0");
  if (options.trimTrailingZeros !== false) fractional = fractional.replace(/0+$/, "");

  return fractional.length > 0 ? `${whole.toString(10)}.${fractional}` : whole.toString(10);
}

/** Parses a JSON-safe atomic integer string. */
export function parseAtomicAmount(value: unknown, label = "amountAtomic"): bigint {
  if (typeof value !== "string" || !ATOMIC_AMOUNT_PATTERN.test(value)) {
    throw new EarnGatewayError(
      "INVALID_ATOMIC_AMOUNT",
      `${label} must be a non-negative atomic integer string.`,
    );
  }
  return BigInt(value);
}

export type EarnStrategyOperationGate =
  | Readonly<{
      supported: true;
      strategy: EarnStrategy;
      operation: EarnStrategyOperation;
    }>
  | Readonly<{
      supported: false;
      strategy: EarnStrategy;
      operation: EarnStrategyOperation;
      reason: string;
    }>;

export const EARN_STRATEGY_OPERATIONS: readonly EarnStrategyOperation[] = [
  "quote",
  "fund",
  "deposit",
  "withdraw",
  "exit",
  "payout",
  "position",
];

export function isEarnStrategyOperation(value: unknown): value is EarnStrategyOperation {
  return typeof value === "string" && EARN_STRATEGY_OPERATIONS.includes(value as EarnStrategyOperation);
}

export function getEarnStrategy(id: unknown): EarnStrategy {
  const strategy = EARN_STRATEGIES.find((candidate) => candidate.id === id);
  if (!strategy) {
    throw new EarnGatewayError("STRATEGY_NOT_FOUND", "The requested Earn strategy does not exist.");
  }
  return strategy;
}

function resolveEarnStrategy(strategyOrId: EarnStrategy | string): EarnStrategy {
  return typeof strategyOrId === "string" ? getEarnStrategy(strategyOrId) : strategyOrId;
}

/**
 * Returns an explicit unsupported result instead of letting adapters silently
 * claim that a disabled provider can execute an operation.
 */
export function getEarnStrategyOperationGate(
  strategyOrId: EarnStrategy | string,
  operation: unknown,
): EarnStrategyOperationGate {
  if (!isEarnStrategyOperation(operation)) {
    throw new EarnGatewayError("INVALID_OPERATION", "The requested Earn operation is not recognized.");
  }

  const strategy = resolveEarnStrategy(strategyOrId);
  if (strategy.availability === "DISABLED") {
    return {
      supported: false,
      strategy,
      operation,
      reason: strategy.availabilityReason ?? "This strategy is not enabled.",
    };
  }
  if (
    strategy.availability === "REDEMPTION_ONLY"
    && operation !== "withdraw"
    && operation !== "exit"
    && operation !== "payout"
    && operation !== "position"
  ) {
    return {
      supported: false,
      strategy,
      operation,
      reason: strategy.availabilityReason ?? "This strategy supports redemption only.",
    };
  }
  if (!strategy.capabilities[operation]) {
    return {
      supported: false,
      strategy,
      operation,
      reason: `The ${operation} operation is not supported by this strategy.`,
    };
  }
  return { supported: true, strategy, operation };
}

export function assertStrategyOperationSupported(
  strategyOrId: EarnStrategy | string,
  operation: unknown,
): EarnStrategy {
  const gate = getEarnStrategyOperationGate(strategyOrId, operation);
  if (!gate.supported) {
    throw new EarnGatewayError("OPERATION_NOT_SUPPORTED", gate.reason);
  }
  return gate.strategy;
}

/**
 * The first strategy's adapters deliberately expose only catalog metadata and
 * capability gates. Sign/confirm logic remains in the session-bound Devnet
 * route handlers, so these objects cannot turn a disabled placeholder into an
 * executable provider by themselves.
 */
export const SIMULATED_DEMO_YIELD_PROVIDER: YieldProvider = {
  provider: "SIMULATED_DEMO",
  network: EARN_DEVNET_CLUSTER,
  getStrategy(strategyId) {
    const strategy = EARN_STRATEGIES.find((candidate) => candidate.id === strategyId);
    return strategy?.provider === "SIMULATED_DEMO" ? strategy : null;
  },
  getOperationGate(strategy, operation) {
    return getEarnStrategyOperationGate(strategy, operation);
  },
};

export const SIMULATED_DEMO_FUNDING_PROVIDER: FundingProvider = {
  kind: "SIMULATED",
  network: EARN_DEVNET_CLUSTER,
  acceptsFiat: false,
  getFunding(strategy) {
    return resolveEarnStrategy(strategy).funding;
  },
  getOperationGate(strategy) {
    return getEarnStrategyOperationGate(strategy, "fund");
  },
};

export type EarnQuoteState = "READY" | "ACCEPTED" | "EXPIRED" | "CANCELLED";

export type EarnQuote = Readonly<{
  id: string;
  strategyId: EarnStrategyId;
  state: EarnQuoteState;
  createdAt: number;
  expiresAt: number;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
}>;

/** Invalid, missing, or elapsed expiry values fail closed as expired. */
export function isEarnQuoteExpired(expiresAt: unknown, now = Date.now()): boolean {
  return typeof expiresAt !== "number"
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(now)
    || expiresAt <= now;
}

export function getEffectiveEarnQuoteState(
  quote: Pick<EarnQuote, "state" | "expiresAt">,
  now = Date.now(),
): EarnQuoteState {
  return quote.state === "READY" && isEarnQuoteExpired(quote.expiresAt, now)
    ? "EXPIRED"
    : quote.state;
}

export function assertEarnQuoteUsable(
  quote: Pick<EarnQuote, "state" | "expiresAt">,
  now = Date.now(),
): void {
  if (isEarnQuoteExpired(quote.expiresAt, now)) {
    throw new EarnGatewayError("QUOTE_EXPIRED", "The Earn quote has expired and must be refreshed.");
  }
  if (quote.state !== "READY") {
    throw new EarnGatewayError("QUOTE_NOT_READY", `The Earn quote is ${quote.state.toLowerCase()}.`);
  }
}

const QUOTE_TRANSITIONS: Readonly<Record<EarnQuoteState, readonly EarnQuoteState[]>> = {
  READY: ["ACCEPTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function assertEarnQuoteTransition(from: EarnQuoteState, to: EarnQuoteState): void {
  if (from === to) return;
  if (!QUOTE_TRANSITIONS[from].includes(to)) {
    throw new EarnGatewayError(
      "INVALID_QUOTE_TRANSITION",
      `Invalid Earn quote transition: ${from} -> ${to}.`,
    );
  }
}

export type EarnOperationState =
  | "QUOTE_READY"
  | "WALLET_APPROVAL_PENDING"
  | "TRANSACTION_SUBMITTED"
  | "ONCHAIN_CONFIRMED"
  | "COMPLETED"
  | "QUOTE_EXPIRED"
  | "USER_REJECTED"
  | "TRANSACTION_FAILED"
  | "CONFIRMATION_TIMEOUT"
  | "NEEDS_REVIEW";

const OPERATION_TRANSITIONS: Readonly<Record<EarnOperationState, readonly EarnOperationState[]>> = {
  QUOTE_READY: ["WALLET_APPROVAL_PENDING", "QUOTE_EXPIRED"],
  WALLET_APPROVAL_PENDING: ["TRANSACTION_SUBMITTED", "QUOTE_EXPIRED", "USER_REJECTED"],
  TRANSACTION_SUBMITTED: ["ONCHAIN_CONFIRMED", "TRANSACTION_FAILED", "CONFIRMATION_TIMEOUT", "NEEDS_REVIEW"],
  ONCHAIN_CONFIRMED: ["COMPLETED", "NEEDS_REVIEW"],
  COMPLETED: [],
  QUOTE_EXPIRED: [],
  USER_REJECTED: [],
  TRANSACTION_FAILED: [],
  CONFIRMATION_TIMEOUT: ["WALLET_APPROVAL_PENDING", "TRANSACTION_SUBMITTED", "ONCHAIN_CONFIRMED", "TRANSACTION_FAILED", "NEEDS_REVIEW"],
  NEEDS_REVIEW: [],
};

/** A completed action is impossible before an independently confirmed chain state. */
export function assertEarnOperationTransition(from: EarnOperationState, to: EarnOperationState): void {
  if (from === to) return;
  if (!OPERATION_TRANSITIONS[from].includes(to)) {
    throw new EarnGatewayError(
      "INVALID_OPERATION_TRANSITION",
      `Invalid Earn operation transition: ${from} -> ${to}.`,
    );
  }
}

/** The first Earn delivery allows writes only when the explicit request is devnet. */
export function isRequestedEarnDevnetCluster(requestedCluster: unknown): requestedCluster is EarnNetwork {
  return requestedCluster === EARN_DEVNET_CLUSTER;
}

export function assertDevnetEarnCluster(requestedCluster: unknown): EarnNetwork {
  if (!isRequestedEarnDevnetCluster(requestedCluster)) {
    throw new EarnGatewayError(
      "UNSAFE_CLUSTER",
      "Earn write operations are restricted to the explicit devnet cluster.",
    );
  }
  return EARN_DEVNET_CLUSTER;
}

/** Ensures all mandatory demo labels are present with non-empty copy. */
export function hasRequiredEarnDisclosures(disclosures: unknown): disclosures is readonly EarnDisclosure[] {
  if (!Array.isArray(disclosures)) return false;

  const labels = new Set<EarnDisclosureLabel>();
  for (const disclosure of disclosures) {
    if (!disclosure || typeof disclosure !== "object") return false;
    const candidate = disclosure as { label?: unknown; text?: unknown };
    if (
      typeof candidate.label !== "string"
      || !EARN_REQUIRED_DISCLOSURE_LABELS.includes(candidate.label as EarnDisclosureLabel)
      || typeof candidate.text !== "string"
      || candidate.text.trim().length === 0
    ) {
      return false;
    }
    labels.add(candidate.label as EarnDisclosureLabel);
  }

  return EARN_REQUIRED_DISCLOSURE_LABELS.every((label) => labels.has(label));
}

export function assertRequiredEarnDisclosures(disclosures: unknown): asserts disclosures is readonly EarnDisclosure[] {
  if (!hasRequiredEarnDisclosures(disclosures)) {
    throw new EarnGatewayError(
      "INVALID_DISCLOSURES",
      "Earn strategies must include every required Devnet demo disclosure.",
    );
  }
}

/**
 * Guards the catalog itself, including the deliberate single-enabled-strategy
 * product decision. It is exported for tests and future catalog loaders.
 */
export function assertEarnCatalogInvariants(catalog: readonly EarnStrategy[] = EARN_STRATEGIES): void {
  const enabled = catalog.filter((strategy) => strategy.availability === "ENABLED");
  if (enabled.length !== 1 || enabled[0]?.mode !== "SIMULATED_DEMO") {
    throw new EarnGatewayError(
      "INVALID_CATALOG",
      "Exactly one enabled Earn strategy is required, and it must be SIMULATED_DEMO.",
    );
  }

  for (const strategy of catalog) {
    if (strategy.network !== EARN_DEVNET_CLUSTER) {
      throw new EarnGatewayError("INVALID_CATALOG", "Every current Earn strategy must target devnet.");
    }
    if (strategy.sourceLabel !== strategy.source.label && strategy.provider === "SIMULATED_DEMO") {
      throw new EarnGatewayError("INVALID_CATALOG", "The enabled strategy source label must match its source metadata.");
    }
    assertRequiredEarnDisclosures(strategy.disclosures);

    if (strategy.availability === "DISABLED") {
      const hasEnabledOperation = EARN_STRATEGY_OPERATIONS.some(
        (operation) => strategy.capabilities[operation],
      );
      if (hasEnabledOperation) {
        throw new EarnGatewayError(
          "INVALID_CATALOG",
          "Disabled Earn strategies cannot advertise executable capabilities.",
        );
      }
    }
    if (strategy.availability === "REDEMPTION_ONLY") {
      for (const operation of ["quote", "fund", "deposit"] as const) {
        if (strategy.capabilities[operation]) {
          throw new EarnGatewayError(
            "INVALID_CATALOG",
            "Redemption-only strategies cannot advertise new funding, quotes, or deposits.",
          );
        }
      }
    }
  }

  const kamino = catalog.find((strategy) => strategy.provider === "KAMINO");
  const nativeStake = catalog.find((strategy) => strategy.provider === "NATIVE_STAKE");
  if (kamino?.availability !== "DISABLED" || nativeStake?.availability !== "DISABLED") {
    throw new EarnGatewayError(
      "INVALID_CATALOG",
      "Kamino and native staking must remain disabled placeholders in the first delivery.",
    );
  }
}

assertEarnCatalogInvariants();
