/**
 * Settlement currencies the console, verifier and investor views know by mint. An instrument's
 * settlement mint and decimals are on chain; the display symbol is derived here, falling back to
 * the deployment's default ("USD" for the demo issuer's test USD).
 *
 * KZT is a devnet test token (SPL Token, 2 decimals, the demo issuer is mint authority) that
 * stands in for tenge so a KZT-denominated bond can pay coupons in tenge. It is not KZTE, not
 * issued by any bank or exchange, and has no value.
 */
export const TEST_KZT_MINT_ADDRESS = "2W2oW4Udrs4xo76tCSCCVdgjXZLLDGXvQUp7XBkumGPs";
export const CIRCLE_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export type SettlementCurrency = { symbol: string; sign: string | null; label: string };

const CURRENCIES: Record<string, SettlementCurrency> = {
  USD: { symbol: "USD", sign: "$", label: "Test USD" },
  USDC: { symbol: "USDC", sign: "$", label: "Circle USDC" },
  KZT: { symbol: "KZT", sign: "₸", label: "Test KZT (stands in for tenge)" },
};

/** Display symbol for a settlement mint (instrument settlement metadata). */
export function settlementSymbolForMint(mint: string, fallback = "USD") {
  if (mint === CIRCLE_DEVNET_USDC_MINT) return "USDC";
  if (mint === TEST_KZT_MINT_ADDRESS) return "KZT";
  return fallback;
}

export function settlementCurrency(symbol: string): SettlementCurrency {
  return CURRENCIES[symbol.toUpperCase()] ?? { symbol, sign: null, label: symbol };
}
