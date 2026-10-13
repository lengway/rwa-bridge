import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePreparedSmartWalletOperation,
  parseSmartWalletOperationStatus,
} from "../lib/kamino-smart-wallet-client";

const walletAddress = "ACreLvLZcmPgHZHjzUzQWnvLtWHiqENjWNLQ7iqLewcc";
const actionId = "d15fa0b4-a790-4704-b616-4204cb36b319";
const prepared = {
  actionId,
  providerTransactionId: "crossmint-transaction-id",
  action: "deposit",
  amountAtomic: "100000",
  network: "devnet",
  stage: "READY",
  feeMode: "project",
  walletAddress,
  simulation: { ok: true },
};

test("accepts a prepared operation only when wallet, action, amount, simulation, and fee policy match", () => {
  assert.deepEqual(
    parsePreparedSmartWalletOperation(prepared, { walletAddress, action: "deposit", amountAtomic: "100000", requestId: actionId }),
    { ...prepared, simulation: { ok: true } },
  );
  assert.throws(
    () => parsePreparedSmartWalletOperation(prepared, { walletAddress, action: "withdraw", amountAtomic: "100000", requestId: actionId }),
    /не совпадает с запросом/,
  );
  assert.throws(
    () => parsePreparedSmartWalletOperation({ ...prepared, simulation: { ok: false } }, { walletAddress, action: "deposit", amountAtomic: "100000", requestId: actionId }),
    /симуляция операции не прошла/,
  );
  assert.throws(
    () => parsePreparedSmartWalletOperation({ ...prepared, feeMode: "user" }, { walletAddress, action: "deposit", amountAtomic: "100000", requestId: actionId }),
    /оплата сетевой комиссии/,
  );
});

test("accepts setup-required operations without simulation success but only a tagged zero-token initialization", () => {
  const setupRequired = {
    ...prepared,
    stage: "SETUP_REQUIRED",
    providerTransactionId: null,
    simulation: { ok: false, unitsConsumed: null },
  };
  assert.equal(parsePreparedSmartWalletOperation(setupRequired, {
    walletAddress, action: "deposit", amountAtomic: "100000", requestId: actionId,
  }).stage, "SETUP_REQUIRED");

  const initialization = {
    ...prepared,
    action: "initialize",
    amountAtomic: "0",
    simulation: { ok: false },
    initializationOnly: true,
  };
  assert.equal(parsePreparedSmartWalletOperation(initialization, {
    walletAddress, action: "initialize", amountAtomic: "0", requestId: actionId,
  }).initializationOnly, true);
  assert.throws(() => parsePreparedSmartWalletOperation({
    ...initialization,
    initializationOnly: false,
  }, { walletAddress, action: "initialize", amountAtomic: "0", requestId: actionId }), /отдельная операция без перевода/);
});

test("requires status to match the persisted wallet, action, and operation and rejects unconfirmed completion", () => {
  const status = {
    actionId,
    action: "deposit",
    stage: "PENDING",
    confirmed: false,
    walletAddress,
    network: "devnet",
    feeMode: "project",
  };
  assert.equal(parseSmartWalletOperationStatus(status, { actionId, walletAddress, action: "deposit" }).stage, "PENDING");
  assert.throws(
    () => parseSmartWalletOperationStatus(status, { actionId, walletAddress, action: "initialize" }),
    /не совпадает с этим кошельком/,
  );
  assert.throws(
    () => parseSmartWalletOperationStatus({ ...status, stage: "COMPLETED", confirmed: false }, { actionId, walletAddress, action: "deposit" }),
    /ещё не подтвердил операцию/,
  );
});
