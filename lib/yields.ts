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

/**
 * The sole executable Earn strategy. Its stable legacy id remains `ondo-usdy`
 * so users with already-issued Devnet shares can still discover and redeem
 * them, but it is intentionally not presented as an Ondo deposit.
 */
export const ONDO_USDY: YieldStrategy = {
  id: "ondo-usdy",
  slug: "devnet-yield-demo",
  name: "Devnet Demo Strategy",
  ticker: "vUSDY-DEMO",
  issuer: "Plain · Devnet demo shares",
  description: "A user-signed Devnet test-token transfer is verified before a demo share is issued. The displayed rate is illustrative only.",
  fallbackApy: 0,
  riskLabel: "This is an application-controlled Devnet demo, not an external yield protocol, bank deposit, or issuer token.",
  eligibilityLabel: "Available only as a non-monetary Solana Devnet demonstration. No production or jurisdictional availability is implied.",
  mintAddress: null,
  sourceUrl: null,
  depositFlow: "onchain",
  gateway: getEarnStrategy("devnet-simulated-demo"),
};

/**
 * Kept only to recognize and let existing Devnet demo-share holders exit a
 * historic position. It is deliberately not offered as a new Earn strategy.
 */
export const KZ_BOND: YieldStrategy = {
  id: "kz-bond-demo",
  slug: "kz-bond",
  name: "Legacy KZT demo shares",
  ticker: "vKZGB-DEMO",
  issuer: "Legacy Devnet demo",
  description: "New deposits are unavailable. Historic Devnet demo shares can only be redeemed for their configured test-token value.",
  fallbackApy: 0,
  riskLabel: "No KASE, KZT rail, issuer token, or production provider is connected by this legacy demo entry.",
  eligibilityLabel: "Not available for new deposits. It exists only so historic Devnet demo-share holders can exit.",
  mintAddress: null,
  sourceUrl: null,
  depositFlow: "onchain",
  gateway: getEarnStrategy("legacy-devnet-redemption"),
};

/** The public discovery catalog has exactly one enabled first strategy. */
export const YIELD_STRATEGIES: YieldStrategy[] = [ONDO_USDY];

/** Historic holdings remain readable/redeemable without being marketed as a new product. */
export const LEGACY_YIELD_STRATEGIES: YieldStrategy[] = [KZ_BOND];
export const ALL_YIELD_STRATEGIES: YieldStrategy[] = [...YIELD_STRATEGIES, ...LEGACY_YIELD_STRATEGIES];

export function findYieldStrategy(id: string) {
  return ALL_YIELD_STRATEGIES.find((strategy) => strategy.id === id || strategy.slug === id) ?? null;
}
