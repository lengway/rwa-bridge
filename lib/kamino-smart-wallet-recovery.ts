export type SmartWalletAction = "deposit" | "withdraw";

export type SmartWalletExecutionState =
  | "prepared"
  | "initrequired"
  | "awaitingapproval"
  | "approvalunknown"
  | "submitted"
  | "finalizedfailed"
  | "finalizedverified";

export type VerifiedSmartWalletReceipt = {
  finalized: true;
  signature: string;
  actionId: string;
  providerUUID: string;
  walletAddress: string;
  action: SmartWalletAction;
  amountAtomic: string;
  /** The executor's exact-message and token-delta checks both passed. */
  executionVerified: true;
};

export type SmartWalletExecutionRecord = {
  version: 1;
  actionId: string;
  providerUUID: string;
  walletAddress: string;
  action: SmartWalletAction;
  amountAtomic: string;
  state: SmartWalletExecutionState;
  signature: string | null;
  initializationVerified: boolean;
  receipt: VerifiedSmartWalletReceipt | null;
  failure: { source: "provider-no-submit" | "chain-finalized"; reason: string } | null;
  createdAt: number;
  updatedAt: number;
};

export type SmartWalletRecoveryEvent =
  | { type: "require-init"; at?: number }
  | { type: "init-verified"; providerUUID: string; at?: number }
  | { type: "init-unknown"; at?: number }
  | { type: "approval-unknown"; at?: number }
  | { type: "provider-pending"; providerUUID: string; at?: number }
  | { type: "provider-success"; providerUUID: string; signature?: string | null; at?: number }
  | { type: "verified-failure"; providerUUID: string; source: "provider-no-submit" | "chain-finalized"; reason: string; signature?: string | null; at?: number }
  | { type: "chain-receipt-verified"; receipt: VerifiedSmartWalletReceipt; at?: number };

export type SmartWalletRecoveryErrorCode =
  | "INVALID_RECORD"
  | "INVALID_EVENT"
  | "ILLEGAL_TRANSITION"
  | "PROVIDER_UUID_MISMATCH"
  | "SIGNATURE_COLLISION"
  | "SIGNATURE_MISMATCH"
  | "RECEIPT_MISMATCH"
  | "FAILURE_NOT_VERIFIED";

export class SmartWalletRecoveryError extends Error {
  constructor(readonly code: SmartWalletRecoveryErrorCode, message: string) {
    super(message);
    this.name = "SmartWalletRecoveryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

function reject(code: SmartWalletRecoveryErrorCode, message: string): never {
  throw new SmartWalletRecoveryError(code, message);
}

export function createSmartWalletExecution({
  actionId,
  providerUUID,
  walletAddress,
  action,
  amountAtomic,
  now = Date.now(),
}: {
  actionId: string;
  /** Allocate once and persist before any provider request; use as provider idempotency key. */
  providerUUID: string;
  walletAddress: string;
  action: SmartWalletAction;
  amountAtomic: string;
  now?: number;
}): SmartWalletExecutionRecord {
  if (!UUID.test(actionId) || !UUID.test(providerUUID) || !WALLET.test(walletAddress)
    || (action !== "deposit" && action !== "withdraw") || !/^[1-9]\d*$/.test(amountAtomic)
    || !Number.isFinite(now)) {
    reject("INVALID_RECORD", "Smart-wallet execution identity is invalid.");
  }
  return {
    version: 1,
    actionId,
    providerUUID: providerUUID.toLowerCase(),
    walletAddress,
    action,
    amountAtomic,
    state: "prepared",
    signature: null,
    initializationVerified: false,
    receipt: null,
    failure: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateSmartWalletExecution(value: unknown): value is SmartWalletExecutionRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Partial<SmartWalletExecutionRecord>;
  const receiptShape = record.receipt === null
    || (typeof record.receipt === "object" && record.receipt !== null && isMatchingReceipt(record, record.receipt));
  const failureShape = record.failure === null
    || (typeof record.failure === "object" && record.failure !== null
      && typeof record.failure.reason === "string"
      && (record.failure.source === "provider-no-submit" || record.failure.source === "chain-finalized"));
  const shapeValid = record.version === 1
    && typeof record.actionId === "string" && UUID.test(record.actionId)
    && typeof record.providerUUID === "string" && UUID.test(record.providerUUID)
    && typeof record.walletAddress === "string" && WALLET.test(record.walletAddress)
    && (record.action === "deposit" || record.action === "withdraw")
    && typeof record.amountAtomic === "string" && /^[1-9]\d*$/.test(record.amountAtomic)
    && ["prepared", "initrequired", "awaitingapproval", "approvalunknown", "submitted", "finalizedfailed", "finalizedverified"].includes(record.state ?? "")
    && (record.signature === null || (typeof record.signature === "string" && SIGNATURE.test(record.signature)))
    && typeof record.initializationVerified === "boolean"
    && receiptShape
    && failureShape
    && typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
    && typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt);
  if (!shapeValid) return false;
  const receipt = record.receipt;
  const failure = record.failure;
  if (record.state === "finalizedverified") {
    if (!receipt || !isMatchingReceipt(record, receipt)) return false;
  } else if (receipt !== null) {
    return false;
  }
  if (record.state === "finalizedfailed") {
    if (!failure) return false;
  } else if (failure !== null) {
    return false;
  }
  if (failure?.source === "provider-no-submit" && record.signature !== null) return false;
  if (failure?.source === "chain-finalized" && record.signature === null) return false;
  return true;
}

function isMatchingReceipt(
  record: Partial<SmartWalletExecutionRecord>,
  receipt: VerifiedSmartWalletReceipt,
): receipt is VerifiedSmartWalletReceipt {
  return typeof receipt === "object" && receipt !== null
    && receipt.finalized === true && receipt.executionVerified === true
    && typeof receipt.signature === "string" && SIGNATURE.test(receipt.signature)
    && receipt.signature === record.signature
    && receipt.actionId === record.actionId
    && receipt.providerUUID.toLowerCase() === record.providerUUID?.toLowerCase()
    && receipt.walletAddress === record.walletAddress
    && receipt.action === record.action
    && receipt.amountAtomic === record.amountAtomic;
}

function assertRecord(record: SmartWalletExecutionRecord): void {
  if (!validateSmartWalletExecution(record)) reject("INVALID_RECORD", "Smart-wallet execution record is invalid.");
}

function matchingProvider(record: SmartWalletExecutionRecord, providerUUID: string) {
  if (!UUID.test(providerUUID)) reject("INVALID_EVENT", "Provider transaction UUID is invalid.");
  if (record.providerUUID !== providerUUID.toLowerCase()) {
    reject("PROVIDER_UUID_MISMATCH", "Event provider UUID does not match the persisted execution.");
  }
}

function assertSignatureAvailable(
  record: SmartWalletExecutionRecord,
  signature: string,
  knownSignatureOwners: Readonly<Record<string, string>>,
) {
  if (!SIGNATURE.test(signature)) reject("INVALID_EVENT", "Transaction signature is invalid.");
  const owner = knownSignatureOwners[signature];
  if (owner && owner !== record.actionId) {
    reject("SIGNATURE_COLLISION", "Transaction signature is already bound to another action.");
  }
  if (record.signature && record.signature !== signature) {
    reject("SIGNATURE_MISMATCH", "This execution is already bound to another signature.");
  }
}

/** Apply one verified lifecycle event. Provider acceptance alone never verifies a chain receipt. */
export function transitionSmartWalletExecution(
  record: SmartWalletExecutionRecord,
  event: SmartWalletRecoveryEvent,
  options: { knownSignatureOwners?: Readonly<Record<string, string>> } = {},
): SmartWalletExecutionRecord {
  assertRecord(record);
  const at = event.at ?? Date.now();
  if (!Number.isFinite(at) || at < record.updatedAt) reject("INVALID_EVENT", "Execution event timestamp is invalid.");
  const owners = options.knownSignatureOwners ?? {};
  const next = (changes: Partial<SmartWalletExecutionRecord>): SmartWalletExecutionRecord => ({
    ...record,
    ...changes,
    updatedAt: at,
  });

  if (record.state === "finalizedverified" || record.state === "finalizedfailed") {
    reject("ILLEGAL_TRANSITION", "Finalized executions are immutable; create a new action to retry.");
  }

  switch (event.type) {
    case "require-init":
      if (record.state !== "prepared") reject("ILLEGAL_TRANSITION", "Initialization can only begin from a prepared action.");
      return next({ state: "initrequired" });
    case "init-verified":
      matchingProvider(record, event.providerUUID);
      if (record.state !== "initrequired") reject("ILLEGAL_TRANSITION", "Provider initialization can only be verified after it is required.");
      return next({ state: "awaitingapproval", initializationVerified: true });
    case "init-unknown":
      if (record.state !== "initrequired") reject("ILLEGAL_TRANSITION", "Only an uncertain initialization can enter recovery.");
      return next({ state: "approvalunknown" });
    case "approval-unknown":
      if (record.state !== "awaitingapproval") reject("ILLEGAL_TRANSITION", "Only an uncertain wallet approval can enter recovery.");
      return next({ state: "approvalunknown" });
    case "provider-pending":
      matchingProvider(record, event.providerUUID);
      if (record.state !== "approvalunknown" && record.state !== "submitted") {
        reject("ILLEGAL_TRANSITION", "Provider status can only be reconciled for an uncertain or submitted action.");
      }
      return record.state === "submitted" ? next({}) : next({ state: "approvalunknown" });
    case "provider-success": {
      matchingProvider(record, event.providerUUID);
      if (record.state !== "awaitingapproval" && record.state !== "approvalunknown" && record.state !== "submitted") {
        reject("ILLEGAL_TRANSITION", "Provider success can only follow wallet approval or recovery.");
      }
      let signature = record.signature;
      if (event.signature) {
        assertSignatureAvailable(record, event.signature, owners);
        signature = event.signature;
      }
      // Provider success establishes submission only. The action stays pending
      // until an exact-message, finalized chain receipt is independently checked.
      return next({ state: "submitted", signature });
    }
    case "verified-failure": {
      matchingProvider(record, event.providerUUID);
      if (!event.reason.trim()) reject("FAILURE_NOT_VERIFIED", "A verified failure must include its reason.");
      if (event.source === "provider-no-submit" && (record.signature || event.signature)) {
        reject("FAILURE_NOT_VERIFIED", "A signature-bound action cannot be classified as never submitted.");
      }
      if (event.source === "chain-finalized") {
        const signature = event.signature ?? record.signature;
        if (!signature) reject("FAILURE_NOT_VERIFIED", "A finalized chain failure requires its transaction signature.");
        assertSignatureAvailable(record, signature, owners);
        if (record.signature && record.signature !== signature) reject("SIGNATURE_MISMATCH", "Failure signature does not match this execution.");
        return next({
          state: "finalizedfailed",
          signature,
          failure: { source: event.source, reason: event.reason },
        });
      }
      return next({ state: "finalizedfailed", failure: { source: event.source, reason: event.reason } });
    }
    case "chain-receipt-verified": {
      const { receipt } = event;
      if (record.state !== "submitted") reject("ILLEGAL_TRANSITION", "A verified receipt requires a submitted execution.");
      if (!isMatchingReceipt(record, receipt)) reject("RECEIPT_MISMATCH", "Finalized receipt does not match the prepared wallet action.");
      assertSignatureAvailable(record, receipt.signature, owners);
      return next({ state: "finalizedverified", signature: receipt.signature, receipt });
    }
  }
}

export type SmartWalletRecoveryPlan = {
  lookupActionId: string;
  lookupProviderUUID: string;
  resubmit: false;
  next: "initialize-once" | "lookup-provider-and-chain" | "complete" | "create-new-action";
};

/** Recovery uses durable server identifiers only. It never instructs a browser to resubmit an uncertain action. */
export function smartWalletRecoveryPlan(record: SmartWalletExecutionRecord): SmartWalletRecoveryPlan {
  assertRecord(record);
  if (record.state === "finalizedverified") {
    return { lookupActionId: record.actionId, lookupProviderUUID: record.providerUUID, resubmit: false, next: "complete" };
  }
  if (record.state === "finalizedfailed") {
    return { lookupActionId: record.actionId, lookupProviderUUID: record.providerUUID, resubmit: false, next: "create-new-action" };
  }
  if (record.state === "prepared") {
    return { lookupActionId: record.actionId, lookupProviderUUID: record.providerUUID, resubmit: false, next: "initialize-once" };
  }
  return { lookupActionId: record.actionId, lookupProviderUUID: record.providerUUID, resubmit: false, next: "lookup-provider-and-chain" };
}

export function smartWalletExecutionCreditState(record: SmartWalletExecutionRecord): "pending" | "failed" | "verified" {
  assertRecord(record);
  if (record.state === "finalizedfailed") return "failed";
  if (record.state === "finalizedverified" && record.receipt) return "verified";
  return "pending";
}

/** Only a finalized verified deposit receipt can create an investment credit. */
export function isVerifiedDepositCredit(record: SmartWalletExecutionRecord): boolean {
  return validateSmartWalletExecution(record)
    && record.action === "deposit"
    && record.state === "finalizedverified"
    && record.receipt !== null
    && isMatchingReceipt(record, record.receipt);
}
