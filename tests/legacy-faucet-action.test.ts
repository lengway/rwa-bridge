import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

type ModuleWithResolver = typeof Module & {
  _resolveFilename: (...args: unknown[]) => string;
};

async function loadLedgerAt(ledgerPath: string) {
  // `server-only` is a Next.js compile-time marker and is intentionally not
  // installed as a Node package in this repository. Stub only that marker so
  // this test can exercise the durable action functions without a Next build.
  const nodeModule = Module as unknown as ModuleWithResolver;
  const originalResolveFilename = nodeModule._resolveFilename;
  const markerStub = resolve(process.cwd(), "lib/rwa-demo.ts");
  const previousLedgerPath = process.env.DEMO_LEDGER_PATH;
  process.env.DEMO_LEDGER_PATH = ledgerPath;
  nodeModule._resolveFilename = ((request: unknown, ...args: unknown[]) => (
    request === "server-only" ? markerStub : originalResolveFilename(request, ...args)
  ));

  try {
    const loaded = await import("../lib/devnet-ledger");
    return (
      (loaded as unknown as { default?: typeof import("../lib/devnet-ledger") }).default ?? loaded
    ) as typeof import("../lib/devnet-ledger");
  } finally {
    nodeModule._resolveFilename = originalResolveFilename;
    if (previousLedgerPath === undefined) delete process.env.DEMO_LEDGER_PATH;
    else process.env.DEMO_LEDGER_PATH = previousLedgerPath;
  }
}

test("legacy faucet actions persist exact replays and lock terminal outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "plain-legacy-faucet-"));
  try {
    const ledger = await loadLedgerAt(join(directory, "ledger.json"));
    const walletAddress = "11111111111111111111111111111111";
    const requestId = "faucet-test-0001";
    const pendingAction = {
      walletAddress,
      requestId,
      amountUsd: 10,
      status: "MINT_PENDING" as const,
      createdAt: 1,
      updatedAt: 1,
    };

    assert.equal(ledger.isLegacyDevnetFaucetRequestId(requestId), true);
    assert.equal(ledger.isLegacyDevnetFaucetRequestId("short"), false);
    assert.equal(ledger.isLegacyDevnetFaucetRequestId("contains space"), false);

    const first = await ledger.reserveLegacyDevnetFaucetAction(pendingAction);
    assert.equal(first.reused, false);
    assert.equal(first.action.status, "MINT_PENDING");

    const replay = await ledger.reserveLegacyDevnetFaucetAction({ ...pendingAction, createdAt: 2, updatedAt: 2 });
    assert.equal(replay.reused, true);
    assert.equal(replay.action.createdAt, 1);

    await assert.rejects(
      () => ledger.reserveLegacyDevnetFaucetAction({ ...pendingAction, amountUsd: 11 }),
      ledger.LegacyDevnetFaucetActionConflictError,
    );

    const completed = await ledger.updateLegacyDevnetFaucetAction({
      walletAddress,
      requestId,
      status: "COMPLETED",
      mintSignature: "test-mint-signature",
      now: 3,
    });
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.mintSignature, "test-mint-signature");

    const stored = await ledger.getLegacyDevnetFaucetAction(walletAddress, requestId);
    assert.deepEqual(stored, completed);
    assert.equal(await ledger.findUnresolvedLegacyDevnetFaucetAction(walletAddress), null);

    await assert.rejects(
      () => ledger.updateLegacyDevnetFaucetAction({
        walletAddress,
        requestId,
        status: "NEEDS_REVIEW",
        errorCode: "MUST_NOT_REOPEN",
      }),
      ledger.LegacyDevnetFaucetActionConflictError,
    );

    const ambiguousRequestId = "faucet-test-0002";
    await ledger.reserveLegacyDevnetFaucetAction({
      ...pendingAction,
      requestId: ambiguousRequestId,
    });
    assert.equal(
      (await ledger.findUnresolvedLegacyDevnetFaucetAction(walletAddress))?.requestId,
      ambiguousRequestId,
    );
    const needsReview = await ledger.updateLegacyDevnetFaucetAction({
      walletAddress,
      requestId: ambiguousRequestId,
      status: "NEEDS_REVIEW",
      errorCode: "MINT_SUBMISSION_UNVERIFIED",
    });
    assert.equal(needsReview.status, "NEEDS_REVIEW");
    await assert.rejects(
      () => ledger.updateLegacyDevnetFaucetAction({
        walletAddress,
        requestId: ambiguousRequestId,
        status: "COMPLETED",
        mintSignature: "must-not-mint-after-review",
      }),
      ledger.LegacyDevnetFaucetActionConflictError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
