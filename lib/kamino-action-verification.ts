import { createHash } from "node:crypto";
import { KAMINO_LEND_DEVNET, KaminoLendDevnetError, type KaminoLendAction } from "@/lib/kamino-lend-devnet-config";

type TokenBalance = { mint: string; owner?: string; uiTokenAmount: { amount: string } };

export function assertKaminoReceiptIdentity({
  preparedDigest, serializedMessage, expectedWallet, staticKeys,
  expectedInstructionDigests, actualInstructionDigests, walletIsSigner,
}: {
  preparedDigest: string;
  serializedMessage: Uint8Array;
  expectedWallet: string;
  staticKeys: readonly string[];
  expectedInstructionDigests: readonly string[];
  actualInstructionDigests: readonly string[];
  walletIsSigner: boolean;
}) {
  const digest = createHash("sha256").update(serializedMessage).digest("hex");
  const required = [expectedWallet, KAMINO_LEND_DEVNET.market, KAMINO_LEND_DEVNET.reserve,
    KAMINO_LEND_DEVNET.liquidityMint, KAMINO_LEND_DEVNET.collateralMint, KAMINO_LEND_DEVNET.supplyVault];
  if (digest !== preparedDigest || !walletIsSigner || staticKeys[0] !== expectedWallet
    || required.some((key) => !staticKeys.includes(key))
    || expectedInstructionDigests.length !== 1
    || actualInstructionDigests.length !== expectedInstructionDigests.length
    || actualInstructionDigests.some((value, index) => value !== expectedInstructionDigests[index])) {
    throw new KaminoLendDevnetError("TRANSACTION_MISMATCH", "Confirmed transaction does not match the prepared Kamino message, accounts, instruction and signer.");
  }
}

function sum(balances: readonly TokenBalance[] | null | undefined, owner: string, mint: string) {
  return (balances ?? []).reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint) return total;
    if (!/^\d+$/.test(balance.uiTokenAmount.amount)) {
      throw new KaminoLendDevnetError("TRANSACTION_MISMATCH", "Transaction contains an invalid token balance.");
    }
    return total + BigInt(balance.uiTokenAmount.amount);
  }, BigInt(0));
}

export function verifyKaminoTokenDeltas({
  action, walletAddress, amountAtomic, collateralAmountAtomic, preBalances, postBalances,
}: {
  action: KaminoLendAction;
  walletAddress: string;
  amountAtomic: string;
  collateralAmountAtomic: string | null;
  preBalances: readonly TokenBalance[] | null | undefined;
  postBalances: readonly TokenBalance[] | null | undefined;
}) {
  const liquidity = sum(postBalances, walletAddress, KAMINO_LEND_DEVNET.liquidityMint)
    - sum(preBalances, walletAddress, KAMINO_LEND_DEVNET.liquidityMint);
  const collateral = sum(postBalances, walletAddress, KAMINO_LEND_DEVNET.collateralMint)
    - sum(preBalances, walletAddress, KAMINO_LEND_DEVNET.collateralMint);
  const requested = BigInt(amountAtomic);
  if (action === "deposit"
    ? liquidity !== -requested || collateral <= BigInt(0)
    : collateralAmountAtomic === null || collateral !== -BigInt(collateralAmountAtomic) || liquidity < requested) {
    throw new KaminoLendDevnetError("TRANSACTION_MISMATCH", "Confirmed Kamino token deltas do not match the prepared action.");
  }
  return {
    actualLiquidityAmountAtomic: (action === "deposit" ? -liquidity : liquidity).toString(),
    actualCollateralAmountAtomic: (action === "deposit" ? collateral : -collateral).toString(),
  };
}
