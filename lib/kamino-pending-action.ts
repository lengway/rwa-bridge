export type KaminoPendingActionType = "deposit" | "withdraw";

type KaminoPendingActionIdentity = Readonly<{
  actionId: string;
  action: KaminoPendingActionType;
  walletAddress: string;
  amountAtomic: string;
}>;

export type KaminoPendingAction = KaminoPendingActionIdentity & (
  | Readonly<{ stage: "awaiting-signature"; signature?: never }>
  | Readonly<{ stage: "signature"; signature: string }>
);

export type KaminoPendingActionValidation =
  | { kind: "empty" }
  | { kind: "valid"; pending: KaminoPendingAction }
  | { kind: "invalid" }
  | { kind: "wallet-mismatch" };

const WALLET_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ACTION_ID = /^[A-Za-z0-9_-]{8,160}$/;
const POSITIVE_ATOMIC = /^[1-9]\d*$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

/** Pure validation boundary for public, client-only recovery data. */
export function validateKaminoPendingAction(
  value: unknown,
  expectedWalletAddress: string,
): KaminoPendingActionValidation {
  if (value === undefined) return { kind: "empty" };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "invalid" };

  const source = value as Record<string, unknown>;
  if (
    (source.stage !== "awaiting-signature" && source.stage !== "signature")
    || typeof source.actionId !== "string"
    || !ACTION_ID.test(source.actionId)
    || (source.action !== "deposit" && source.action !== "withdraw")
    || typeof source.walletAddress !== "string"
    || !WALLET_ADDRESS.test(source.walletAddress)
    || typeof source.amountAtomic !== "string"
    || !POSITIVE_ATOMIC.test(source.amountAtomic)
  ) {
    return { kind: "invalid" };
  }

  if (source.stage === "signature") {
    if (typeof source.signature !== "string" || !SIGNATURE.test(source.signature)) {
      return { kind: "invalid" };
    }
  } else if (source.signature !== undefined && source.signature !== null) {
    return { kind: "invalid" };
  }

  if (!WALLET_ADDRESS.test(expectedWalletAddress) || source.walletAddress !== expectedWalletAddress) {
    return { kind: "wallet-mismatch" };
  }

  const identity = {
    actionId: source.actionId,
    action: source.action,
    walletAddress: source.walletAddress,
    amountAtomic: source.amountAtomic,
  } as const;
  return source.stage === "signature"
    ? { kind: "valid", pending: { ...identity, stage: "signature", signature: source.signature as string } }
    : { kind: "valid", pending: { ...identity, stage: "awaiting-signature" } };
}

export function kaminoPendingActionStorageKey(walletAddress: string) {
  return `kamino-lend-pending:v1:${walletAddress}`;
}
