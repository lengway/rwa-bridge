import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  KaminoExecutionClaimError,
  KaminoExecutionClaimStore,
  type KaminoExecutionClaimInput,
} from "../lib/kamino-execution-claims";

const walletA = "11111111111111111111111111111111";
const walletB = "22222222222222222222222222222222";
const signatureA = "1".repeat(64);

function input(overrides: Partial<KaminoExecutionClaimInput> = {}): KaminoExecutionClaimInput {
  return {
    walletAddress: walletA,
    actionId: randomUUID(),
    action: "deposit",
    amountAtomic: "1000000",
    providerUUID: randomUUID(),
    ...overrides,
  };
}

async function temporaryStore(options: { lockTimeoutMs?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "kamino-execution-claims-"));
  const filePath = join(directory, "actions.json");
  return {
    directory,
    filePath,
    store: new KaminoExecutionClaimStore(filePath, options),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function rejectsWithCode(promise: Promise<unknown>, code: string) {
  return assert.rejects(promise, (error: unknown) =>
    error instanceof KaminoExecutionClaimError && error.code === code,
  );
}

test("provider execution UUID claims replay idempotently and persist across store instances", async () => {
  const fixture = await temporaryStore();
  try {
    const action = input();
    const first = await fixture.store.claimExecution(action);
    const second = await new KaminoExecutionClaimStore(fixture.filePath).claimExecution(action);
    assert.equal(first.replayed, false);
    assert.equal(second.replayed, true);
    assert.deepEqual(second.claim, first.claim);
    assert.equal(second.leaseActive, true);
    assert.deepEqual(await fixture.store.getByProviderUUID(action.providerUUID), first.claim);
  } finally {
    await fixture.cleanup();
  }
});

test("one wallet lease blocks a different action until explicitly released", async () => {
  const fixture = await temporaryStore();
  try {
    const first = input();
    await fixture.store.claimExecution(first);
    const other = input({ walletAddress: first.walletAddress });
    await rejectsWithCode(fixture.store.claimExecution(other), "WALLET_IN_FLIGHT");

    await fixture.store.markSubmissionUncertain(first.providerUUID, first.actionId);
    await fixture.store.claimSignature(first.providerUUID, first.actionId, signatureA);
    await rejectsWithCode(
      fixture.store.releaseWalletLease({ ...first, resolution: "never-submitted" }),
      "LEASE_MISMATCH",
    );
    const released = await fixture.store.releaseWalletLease({ ...first, resolution: "verified-terminal" });
    assert.equal(released.released, true);
    const next = await fixture.store.claimExecution(other);
    assert.equal(next.leaseActive, true);
  } finally {
    await fixture.cleanup();
  }
});

test("concurrent store instances cannot claim one wallet for two actions", async () => {
  const fixture = await temporaryStore();
  try {
    const left = input();
    const right = input({ walletAddress: left.walletAddress });
    const secondStore = new KaminoExecutionClaimStore(fixture.filePath);
    const results = await Promise.allSettled([
      fixture.store.claimExecution(left),
      secondStore.claimExecution(right),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof KaminoExecutionClaimError);
    assert.equal(rejected.reason.code, "WALLET_IN_FLIGHT");
  } finally {
    await fixture.cleanup();
  }
});

test("signature claims use a SHA-256 index, deduplicate races, and recover signature after restart", async () => {
  const fixture = await temporaryStore();
  try {
    const left = input({ walletAddress: walletA });
    const right = input({ walletAddress: walletB });
    await Promise.all([
      fixture.store.claimExecution(left),
      fixture.store.claimExecution(right),
    ]);
    const storeAfterRestart = new KaminoExecutionClaimStore(fixture.filePath);
    const results = await Promise.allSettled([
      fixture.store.claimSignature(left.providerUUID, left.actionId, signatureA),
      storeAfterRestart.claimSignature(right.providerUUID, right.actionId, signatureA),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof KaminoExecutionClaimError);
    assert.equal(rejected.reason.code, "SIGNATURE_REUSED");

    const winner = results.find((result) => result.status === "fulfilled");
    assert.ok(winner && winner.status === "fulfilled");
    const claim = winner.value.claim;
    assert.equal(claim.signature, signatureA);
    const hash = createHash("sha256").update(signatureA).digest("hex");
    const signatureRecord = JSON.parse(await readFile(
      join(`${fixture.filePath}.execution-claims`, "signatures", `${hash}.json`), "utf8",
    )) as { signature: string };
    assert.equal(signatureRecord.signature, signatureA);
    assert.equal((await storeAfterRestart.getByProviderUUID(claim.providerUUID))?.signature, signatureA);
  } finally {
    await fixture.cleanup();
  }
});

test("provider UUID and action ID cannot be rebound to another intent", async () => {
  const fixture = await temporaryStore();
  try {
    const claim = input();
    await fixture.store.claimExecution(claim);
    await rejectsWithCode(
      fixture.store.claimExecution({ ...claim, action: "withdraw" }),
      "PROVIDER_UUID_REUSED",
    );
    await rejectsWithCode(
      fixture.store.claimExecution({ ...input(), actionId: claim.actionId, walletAddress: walletB }),
      "ACTION_ALREADY_CLAIMED",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("rebuilds a missing wallet lease from the durable provider claim after partial failure", async () => {
  const fixture = await temporaryStore();
  try {
    const action = input();
    await fixture.store.claimExecution(action);
    const walletHash = createHash("sha256").update(action.walletAddress).digest("hex");
    const walletPath = join(`${fixture.filePath}.execution-claims`, "wallets", `${walletHash}.json`);
    await rm(walletPath);

    const afterRestart = new KaminoExecutionClaimStore(fixture.filePath);
    const other = input({ walletAddress: action.walletAddress });
    await rejectsWithCode(afterRestart.claimExecution(other), "WALLET_IN_FLIGHT");
    const restored = JSON.parse(await readFile(walletPath, "utf8")) as { providerUUID: string };
    assert.equal(restored.providerUUID, action.providerUUID);
  } finally {
    await fixture.cleanup();
  }
});

test("does not steal an existing lock when waiting times out", async () => {
  const fixture = await temporaryStore({ lockTimeoutMs: 30 });
  try {
    const lockPath = join(`${fixture.filePath}.execution-claims`, ".lock");
    await mkdir(lockPath, { recursive: true });
    await rejectsWithCode(fixture.store.claimExecution(input()), "LOCK_TIMEOUT");
    await writeFile(join(lockPath, "owner"), "still-held", "utf8");
    assert.equal(await readFile(join(lockPath, "owner"), "utf8"), "still-held");
  } finally {
    await fixture.cleanup();
  }
});
