import assert from "node:assert/strict";
import test from "node:test";
import {
  kaminoPendingActionStorageKey,
  validateKaminoPendingAction,
} from "../lib/kamino-pending-action";

const walletAddress = "11111111111111111111111111111111";
const otherWalletAddress = "22222222222222222222222222222222";
const signature = "1".repeat(64);
const awaitingSignature = {
  stage: "awaiting-signature",
  actionId: "12345678-1234-1234-1234-123456789abc",
  action: "deposit",
  walletAddress,
  amountAtomic: "9007199254740993",
};

test("accepts a minimal awaiting-signature identity and scopes the storage key by wallet", () => {
  assert.deepEqual(validateKaminoPendingAction(awaitingSignature, walletAddress), {
    kind: "valid",
    pending: awaitingSignature,
  });
  assert.notEqual(
    kaminoPendingActionStorageKey(walletAddress),
    kaminoPendingActionStorageKey(otherWalletAddress),
  );
});

test("accepts a signed pending action and rejects malformed stage/signature combinations", () => {
  assert.equal(validateKaminoPendingAction({ ...awaitingSignature, stage: "signature", signature: "5".repeat(64) }, walletAddress).kind, "invalid");
  const signed = { ...awaitingSignature, stage: "signature", signature };
  assert.deepEqual(validateKaminoPendingAction(signed, walletAddress), {
    kind: "valid",
    pending: signed,
  });
  for (const malformed of [
    { ...signed, stage: "prepared" },
    { ...signed, signature: "not-a-signature" },
    { ...awaitingSignature, signature },
    { ...signed, signature: undefined },
  ]) {
    assert.equal(validateKaminoPendingAction(malformed, walletAddress).kind, "invalid");
  }
});

test("rejects malformed records, IDs, and non-canonical or non-positive amount strings", () => {
  for (const malformed of [
    null,
    "not-json-state",
    [],
    { ...awaitingSignature, actionId: "short" },
    { ...awaitingSignature, actionId: "../12345678" },
    { ...awaitingSignature, amountAtomic: 1 },
    { ...awaitingSignature, amountAtomic: "0" },
    { ...awaitingSignature, amountAtomic: "01" },
    { ...awaitingSignature, amountAtomic: "1.0" },
    { ...awaitingSignature, action: "lend" },
  ]) {
    assert.equal(validateKaminoPendingAction(malformed, walletAddress).kind, "invalid");
  }
});

test("does not restore a valid recovery record under a different wallet", () => {
  assert.deepEqual(
    validateKaminoPendingAction(awaitingSignature, otherWalletAddress),
    { kind: "wallet-mismatch" },
  );
});

test("treats absent storage separately from malformed persisted data", () => {
  assert.deepEqual(validateKaminoPendingAction(undefined, walletAddress), { kind: "empty" });
  assert.equal(validateKaminoPendingAction({ broken: true }, walletAddress).kind, "invalid");
});
