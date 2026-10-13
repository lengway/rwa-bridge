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
    /does not match the request/,
  );
  assert.throws(
    () => parsePreparedSmartWalletOperation({ ...prepared, simulation: { ok: false } }, { walletAddress, action: "deposit", amountAtomic: "100000", requestId: actionId }),
    /simulation failed/,
  );
  assert.throws(
    () => parsePreparedSmartWalletOperation({ ...prepared, feeMode: "user" }, { walletAddress, action: "deposit", amountAtomic: "100000", requestId: actionId }),
    /pay the network fee/,
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
  }, { walletAddress, action: "initialize", amountAtomic: "0", requestId: actionId }), /separate setup operation with no token transfer/);
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
    /does not match this wallet/,
  );
  assert.throws(
    () => parseSmartWalletOperationStatus({ ...status, stage: "COMPLETED", confirmed: false }, { actionId, walletAddress, action: "deposit" }),
    /has not confirmed the operation yet/,
  );
});

import { continueSmartWalletChain, type PreparedSmartWalletOperation, type SmartWalletChainDependencies, type StoredSmartWalletOperation } from "../lib/kamino-smart-wallet-client";

function chainFixture() {
  const ids = [actionId, "d15fa0b4-a790-4704-b616-4204cb36b320", "d15fa0b4-a790-4704-b616-4204cb36b321", "d15fa0b4-a790-4704-b616-4204cb36b322"];
  const journal: StoredSmartWalletOperation[] = [];
  const calls: string[] = [];
  const approved = new Set<string>();
  let setup = false;
  const response = (operation: StoredSmartWalletOperation, stage: "READY" | "SETUP_REQUIRED"): PreparedSmartWalletOperation => ({
    ...prepared, ...operation, network: "devnet", feeMode: "project", stage, simulation: { ok: true },
    ...(stage === "READY" ? { providerTransactionId: operation.actionId } : { providerTransactionId: undefined }),
  });
  const dependencies: SmartWalletChainDependencies = {
    newId: () => ids.shift()!,
    store: operation => { journal.push(operation); calls.push(`store:${operation.actionId}`); },
    clear: () => { calls.push("clear"); },
    prepare: async (request, walletAddress) => {
      calls.push(`prepare:${request.requestId}`);
      return response({ ...request, actionId: request.requestId, walletAddress }, setup ? "SETUP_REQUIRED" : "READY");
    },
    initialize: async (requestId, walletAddress, parentActionId) => {
      calls.push(`initialize:${parentActionId}`);
      return response({ actionId: requestId, walletAddress, action: "initialize", amountAtomic: "0" }, "READY");
    },
    status: async (id, walletAddress, action) => {
      calls.push(`status:${id}`);
      const done = approved.has(id);
      if (done && action === "initialize") setup = false;
      return { actionId: id, action, walletAddress, network: "devnet", feeMode: "project",
        stage: done ? "COMPLETED" : setup && action !== "initialize" ? "SETUP_REQUIRED" : "READY",
        confirmed: done, ...(done ? { signature: "s".repeat(64) } : {}) };
    },
    wait: async () => {},
  };
  const options = {
    operation: null as StoredSmartWalletOperation | null,
    action: "withdraw" as const, amountAtomic: "1000000", walletAddress,
    userTap: true, signal: new AbortController().signal,
    approve: async (id: string) => {
      assert.equal(journal.at(-1)?.approvalRequested, true);
      calls.push(`approve:${id}`); approved.add(id);
    },
    onOperation: () => {}, onProgress: () => {}, dependencies,
  };
  return { options, dependencies, calls, journal, approved, requireSetup: () => { setup = true; } };
}

test("one tap initializes, verifies completion, then automatically executes the original withdrawal", async () => {
  const fixture = chainFixture();
  fixture.requireSetup();
  const result = await continueSmartWalletChain(fixture.options);
  assert.equal(result?.action, "withdraw");
  assert.equal(result?.stage, "COMPLETED");
  const initialization = fixture.journal.find(operation => operation.action === "initialize")!;
  assert.equal(initialization.continuation?.action, "withdraw");
  assert.equal(initialization.continuation?.amountAtomic, "1000000");
  const approvalCalls = fixture.calls.filter(call => call.startsWith("approve:"));
  assert.equal(approvalCalls.length, 2);
  assert.ok(fixture.calls.indexOf(`status:${initialization.actionId}`)
    < fixture.calls.indexOf(`prepare:${initialization.continuation!.actionId}`));
  assert.equal(fixture.calls.at(-1), "clear");
});

test("recovery never approves a legacy saved operation without a review tap", async () => {
  const fixture = chainFixture();
  const result = await continueSmartWalletChain({ ...fixture.options, userTap: false,
    operation: { actionId, action: "deposit", amountAtomic: "100000", walletAddress, providerTransactionId: actionId } });
  assert.equal(result, null);
  assert.deepEqual(fixture.calls, [`status:${actionId}`]);
});

test("authorized initialization recovery retains the original amount and action", async () => {
  const fixture = chainFixture();
  const result = await continueSmartWalletChain({ ...fixture.options, userTap: false, amountAtomic: "0",
    operation: { actionId: "d15fa0b4-a790-4704-b616-4204cb36b322", action: "initialize", amountAtomic: "0", walletAddress,
      providerTransactionId: "d15fa0b4-a790-4704-b616-4204cb36b322", userStarted: true,
      continuation: { actionId, action: "deposit", amountAtomic: "2500000" } } });
  assert.equal(result?.action, "deposit");
  assert.equal(fixture.journal.at(-1)?.amountAtomic, "2500000");
});

test("an unknown saved operation is silently cleared without preparing or approving anything", async () => {
  const fixture = chainFixture();
  fixture.dependencies.status = async () => { throw new Error("Operation was not found for this wallet."); };
  const result = await continueSmartWalletChain({ ...fixture.options,
    operation: { actionId, action: "withdraw", amountAtomic: "1000000", walletAddress } });
  assert.equal(result, null);
  assert.deepEqual(fixture.calls, ["clear"]);
});

test("a pending recovery keeps polling and never resubmits or approves", async () => {
  const fixture = chainFixture();
  const abort = new AbortController();
  let polls = 0;
  fixture.dependencies.status = async (id, walletAddress, action) => {
    polls += 1;
    return { actionId: id, action, walletAddress, stage: "PENDING", confirmed: false, network: "devnet", feeMode: "project" };
  };
  fixture.dependencies.wait = async () => { if (polls === 14) abort.abort(); };
  await assert.rejects(continueSmartWalletChain({ ...fixture.options, signal: abort.signal, userTap: false,
    operation: { actionId, action: "withdraw", amountAtomic: "1000000", walletAddress,
      providerTransactionId: actionId, userStarted: true, approvalRequested: true } }), { name: "AbortError" });
  assert.equal(polls, 14);
  assert.deepEqual(fixture.calls, []);
});

test("interrupted approval reconciles status before a retry and never approves twice in one run", async () => {
  const fixture = chainFixture();
  let approvals = 0;
  const approve = async () => { approvals += 1; throw new Error("interrupted"); };
  await assert.rejects(continueSmartWalletChain({ ...fixture.options, approve }), /interrupted/);
  assert.equal(approvals, 1);
  const stored = fixture.journal.at(-1)!;
  await assert.rejects(continueSmartWalletChain({ ...fixture.options, operation: stored, userTap: false, approve }));
  assert.equal(approvals, 1);
  await assert.rejects(continueSmartWalletChain({ ...fixture.options, operation: stored, approve }), /interrupted/);
  assert.equal(approvals, 2);
  assert.equal(fixture.journal.at(-1)?.actionId, stored.actionId);
});

test("a newly failed action stops with an error instead of automatically creating another action", async () => {
  const fixture = chainFixture();
  fixture.dependencies.status = async (id, walletAddress, action) => ({
    actionId: id, action, walletAddress, stage: "FAILED", confirmed: false, network: "devnet", feeMode: "project",
  });
  await assert.rejects(continueSmartWalletChain(fixture.options), /FAILED/);
  assert.equal(fixture.calls.filter(call => call.startsWith("prepare:")).length, 1);
  assert.equal(fixture.calls.filter(call => call.startsWith("approve:")).length, 1);
});

test("a saved preparation reuses its request ID and does not create a fresh request", async () => {
  const fixture = chainFixture();
  const result = await continueSmartWalletChain({ ...fixture.options, userTap: false,
    operation: { actionId, action: "deposit", amountAtomic: "1000000", walletAddress, userStarted: true } });
  assert.equal(result?.stage, "COMPLETED");
  assert.deepEqual(fixture.calls.filter(call => call.startsWith("prepare:")), [`prepare:${actionId}`]);
  assert.ok(fixture.journal.every(operation => operation.actionId === actionId));
});

test("transport interruptions during recovery keep checking the same saved transaction", async () => {
  const fixture = chainFixture();
  const status = fixture.dependencies.status;
  let polls = 0;
  fixture.dependencies.status = async (...args) => {
    if (++polls < 3) {
      const { KaminoSmartWalletClientError } = await import("../lib/kamino-smart-wallet-client");
      throw new KaminoSmartWalletClientError("Couldn't reach the wallet service. Check the status before retrying.");
    }
    return status(...args);
  };
  fixture.approved.add(actionId);
  const result = await continueSmartWalletChain({ ...fixture.options, userTap: false,
    operation: { actionId, action: "withdraw", amountAtomic: "1000000", walletAddress,
      providerTransactionId: actionId, userStarted: true, approvalRequested: true } });
  assert.equal(result?.stage, "COMPLETED");
  assert.equal(polls, 3);
  assert.deepEqual(fixture.calls, [`status:${actionId}`, "clear"]);
});
