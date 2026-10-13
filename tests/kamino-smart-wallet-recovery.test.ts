import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createSmartWalletExecution,
  isVerifiedDepositCredit,
  SmartWalletRecoveryError,
  smartWalletExecutionCreditState,
  smartWalletRecoveryPlan,
  transitionSmartWalletExecution,
  type SmartWalletExecutionRecord,
  type VerifiedSmartWalletReceipt,
} from "../lib/kamino-smart-wallet-recovery";

const wallet = "11111111111111111111111111111111";
const signature = "1".repeat(64);

function prepared(overrides: Partial<Parameters<typeof createSmartWalletExecution>[0]> = {}) {
  return createSmartWalletExecution({
    actionId: randomUUID(),
    providerUUID: randomUUID(),
    walletAddress: wallet,
    action: "deposit",
    amountAtomic: "1000000",
    now: 100,
    ...overrides,
  });
}

function toAwaitingApproval(record = prepared()) {
  const initRequired = transitionSmartWalletExecution(record, { type: "require-init", at: 101 });
  return transitionSmartWalletExecution(initRequired, {
    type: "init-verified",
    providerUUID: record.providerUUID,
    at: 102,
  });
}

function receiptFor(record: SmartWalletExecutionRecord): VerifiedSmartWalletReceipt {
  return {
    finalized: true,
    signature,
    actionId: record.actionId,
    providerUUID: record.providerUUID,
    walletAddress: record.walletAddress,
    action: record.action,
    amountAtomic: record.amountAtomic,
    executionVerified: true,
  };
}

function rejectsCode(run: () => unknown, code: string) {
  assert.throws(run, (error: unknown) =>
    error instanceof SmartWalletRecoveryError && error.code === code,
  );
}

test("verified provider initialization does not credit a deposit", () => {
  const record = toAwaitingApproval();
  assert.equal(record.state, "awaitingapproval");
  assert.equal(record.initializationVerified, true);
  assert.equal(record.receipt, null);
  assert.equal(smartWalletExecutionCreditState(record), "pending");
  assert.equal(isVerifiedDepositCredit(record), false);
});

test("provider success without a finalized chain receipt remains submitted and pending", () => {
  const awaiting = toAwaitingApproval();
  const submitted = transitionSmartWalletExecution(awaiting, {
    type: "provider-success",
    providerUUID: awaiting.providerUUID,
    signature,
    at: 103,
  });
  assert.equal(submitted.state, "submitted");
  assert.equal(submitted.receipt, null);
  assert.equal(smartWalletExecutionCreditState(submitted), "pending");
  assert.equal(isVerifiedDepositCredit(submitted), false);
});

test("timeouts and reloads recover by action and provider IDs without resubmitting", () => {
  const record = transitionSmartWalletExecution(prepared(), { type: "require-init", at: 101 });
  const unknown = transitionSmartWalletExecution(record, { type: "init-unknown", at: 102 });
  const plan = smartWalletRecoveryPlan(unknown);
  assert.equal(unknown.state, "approvalunknown");
  assert.equal(plan.lookupActionId, record.actionId);
  assert.equal(plan.lookupProviderUUID, record.providerUUID);
  assert.equal(plan.resubmit, false);
  assert.equal(plan.next, "lookup-provider-and-chain");

  const stillUnknown = transitionSmartWalletExecution(unknown, {
    type: "provider-pending",
    providerUUID: record.providerUUID,
    at: 103,
  });
  assert.equal(stillUnknown.state, "approvalunknown");
  assert.equal(smartWalletRecoveryPlan(stillUnknown).lookupProviderUUID, record.providerUUID);
});

test("signature collision blocks provider acceptance from binding the signature", () => {
  const awaiting = toAwaitingApproval();
  rejectsCode(() => transitionSmartWalletExecution(awaiting, {
    type: "provider-success",
    providerUUID: awaiting.providerUUID,
    signature,
    at: 103,
  }, { knownSignatureOwners: { [signature]: randomUUID() } }), "SIGNATURE_COLLISION");
});

test("only a matching finalized, independently verified receipt credits a deposit", () => {
  const awaiting = toAwaitingApproval();
  const submitted = transitionSmartWalletExecution(awaiting, {
    type: "provider-success",
    providerUUID: awaiting.providerUUID,
    signature,
    at: 103,
  });
  const verified = transitionSmartWalletExecution(submitted, {
    type: "chain-receipt-verified",
    receipt: receiptFor(submitted),
    at: 104,
  });
  assert.equal(verified.state, "finalizedverified");
  assert.equal(smartWalletExecutionCreditState(verified), "verified");
  assert.equal(isVerifiedDepositCredit(verified), true);

  rejectsCode(() => transitionSmartWalletExecution(submitted, {
    type: "chain-receipt-verified",
    receipt: { ...receiptFor(submitted), amountAtomic: "1000001" },
    at: 104,
  }), "RECEIPT_MISMATCH");
});

test("verified failure is terminal and recovery requires a new action ID", () => {
  const awaiting = toAwaitingApproval();
  const failed = transitionSmartWalletExecution(awaiting, {
    type: "verified-failure",
    providerUUID: awaiting.providerUUID,
    source: "provider-no-submit",
    reason: "Provider confirmed this request was rejected before submission.",
    at: 103,
  });
  assert.equal(failed.state, "finalizedfailed");
  assert.equal(smartWalletExecutionCreditState(failed), "failed");
  assert.equal(smartWalletRecoveryPlan(failed).next, "create-new-action");
  assert.equal(smartWalletRecoveryPlan(failed).resubmit, false);
  rejectsCode(() => transitionSmartWalletExecution(failed, { type: "require-init", at: 104 }), "ILLEGAL_TRANSITION");
  assert.notEqual(prepared().actionId, failed.actionId);
});

test("a signature-bound execution cannot be classified as provider no-submit", () => {
  const awaiting = toAwaitingApproval();
  const submitted = transitionSmartWalletExecution(awaiting, {
    type: "provider-success",
    providerUUID: awaiting.providerUUID,
    signature,
    at: 103,
  });
  rejectsCode(() => transitionSmartWalletExecution(submitted, {
    type: "verified-failure",
    providerUUID: submitted.providerUUID,
    source: "provider-no-submit",
    reason: "Rejected",
    at: 104,
  }), "FAILURE_NOT_VERIFIED");
});

test("terminal verified withdrawals never create deposit credits", () => {
  const awaiting = toAwaitingApproval(prepared({ action: "withdraw" }));
  const submitted = transitionSmartWalletExecution(awaiting, {
    type: "provider-success",
    providerUUID: awaiting.providerUUID,
    signature,
    at: 103,
  });
  const verified = transitionSmartWalletExecution(submitted, {
    type: "chain-receipt-verified",
    receipt: receiptFor(submitted),
    at: 104,
  });
  assert.equal(verified.state, "finalizedverified");
  assert.equal(isVerifiedDepositCredit(verified), false);
});
