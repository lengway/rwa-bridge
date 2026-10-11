/** Display-only legacy balance. Never confuse the Kamino USDC mint with TEST QUOTE. */
export function legacyWalletBalance(
  holdings: readonly { mint: string; balance: number }[] | null,
  mint: string | null,
): number | null {
  if (holdings === null) return null;
  if (!mint) return 0;
  let balance = 0;
  for (const holding of holdings) {
    if (holding.mint !== mint) continue;
    if (!Number.isFinite(holding.balance) || holding.balance < 0) return null;
    balance += holding.balance;
  }
  return Number.isFinite(balance) ? balance : null;
}
