import { getEarnStrategy, type EarnStrategy } from "@/lib/earn-gateway";

export type YieldStrategy = {
  /** Stable legacy product id used by existing Devnet share mints and positions. */
  id: string;
  slug: string;
  name: string;
  ticker: string;
  issuer: string;
  description: string;
  /** Retained for legacy shape compatibility; the gateway owns yield disclosure. */
  fallbackApy: number;
  riskLabel: string;
  eligibilityLabel: string;
  mintAddress: string | null;
  sourceUrl: string | null;
  depositFlow: "onchain";
  /** Normalized gateway contract; never infer provider claims from display copy. */
  gateway: EarnStrategy;
};

/** The sole discovery strategy: direct user-signed Kamino Lend on Devnet. */
export const KAMINO_LEND: YieldStrategy = {
  id: "kamino-lend",
  slug: "kamino-lend",
  name: "Kamino Lend",
  ticker: "Devnet USDC",
  issuer: "Kamino Lend · Solana Devnet",
  description: "Supply and withdrawal are built against one pinned Kamino Lend Devnet USDC reserve, simulated by the server, and signed by the connected wallet.",
  fallbackApy: 0,
  riskLabel: "Reserve liquidity and protocol terms are variable. This route uses Solana Devnet assets and positions with no monetary value.",
  eligibilityLabel: "Available only through a connected Solana Devnet wallet. No fiat payment, off-ramp, production availability, or jurisdictional availability is implied.",
  mintAddress: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  sourceUrl: "https://kamino.com/docs/build/developers/borrow/operations/deposit",
  depositFlow: "onchain",
  gateway: getEarnStrategy("kamino-lend-devnet-usdc"),
};

/**
 * Stable historic id kept solely for existing app-controlled Devnet positions.
 * It is not part of the discovery catalog and accepts no new deposits.
 */
export const ONDO_USDY: YieldStrategy = {
  id: "ondo-usdy",
  slug: "legacy-devnet-position",
  name: "Legacy Devnet position",
  ticker: "Legacy position",
  issuer: "Plain · Solana Devnet",
  description: "Historic app-controlled Devnet position. New deposits are unavailable; any supported exit remains limited to Devnet test tokens.",
  fallbackApy: 0,
  riskLabel: "This record is not a current provider position, bank deposit, issuer token, or production asset.",
  eligibilityLabel: "Not available for new deposits. It remains readable only for historic Devnet holders.",
  mintAddress: null,
  sourceUrl: null,
  depositFlow: "onchain",
  gateway: getEarnStrategy("devnet-simulated-demo"),
};

/**
 * Kept only to recognize and let existing Devnet-share holders exit a
 * historic position. It is deliberately not offered as a new Earn strategy.
 */
export const KZ_BOND: YieldStrategy = {
  id: "kz-bond-demo",
  slug: "kz-bond",
  name: "Legacy KZT Devnet shares",
  ticker: "vKZGB",
  issuer: "Legacy Solana Devnet",
  description: "New deposits are unavailable. Historic Devnet shares can only be exited for their configured test-token value.",
  fallbackApy: 0,
  riskLabel: "No KASE, KZT rail, issuer token, or production provider is connected by this legacy Devnet entry.",
  eligibilityLabel: "Not available for new deposits. It exists only so historic Devnet-share holders can exit.",
  mintAddress: null,
  sourceUrl: null,
  depositFlow: "onchain",
  gateway: getEarnStrategy("legacy-devnet-redemption"),
};

/** The public discovery catalog has one enabled route. */
export const YIELD_STRATEGIES: YieldStrategy[] = [KAMINO_LEND];

/** Historic holdings remain readable/redeemable without being marketed as a new product. */
export const LEGACY_YIELD_STRATEGIES: YieldStrategy[] = [ONDO_USDY, KZ_BOND];
/** Routes backed by the app-controlled historic share ledger. */
export const APP_CONTROLLED_LEGACY_YIELD_STRATEGIES: YieldStrategy[] = LEGACY_YIELD_STRATEGIES;
export const ALL_YIELD_STRATEGIES: YieldStrategy[] = [...YIELD_STRATEGIES, ...LEGACY_YIELD_STRATEGIES];

export function findYieldStrategy(id: string) {
  return ALL_YIELD_STRATEGIES.find((strategy) => strategy.id === id || strategy.slug === id) ?? null;
}
