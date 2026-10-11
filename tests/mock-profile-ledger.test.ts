import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createMockIdentityProfile } from "../lib/mock-identity";

test("demo identity is user-scoped and resetting it preserves wallets and preferences", async () => {
  const folder = await mkdtemp(join(tmpdir(), "plain-mock-profile-"));
  const previousPath = process.env.DEMO_LEDGER_PATH;
  const nodeModule = Module as unknown as typeof Module & { _resolveFilename: (...args: unknown[]) => string };
  const originalResolve = nodeModule._resolveFilename;
  process.env.DEMO_LEDGER_PATH = join(folder, "ledger.json");
  nodeModule._resolveFilename = (request: unknown, ...args: unknown[]) => request === "server-only"
    ? resolve(process.cwd(), "lib/action-errors.ts") : originalResolve(request, ...args);
  try {
    const loaded = await import("../lib/devnet-ledger");
    const ledger = (loaded as unknown as { default?: typeof loaded }).default ?? loaded;
    const email = "fixture@example.invalid";
    await ledger.linkEmailWallet(email, "11111111111111111111111111111111");
    await ledger.setEmailPreferences(email, false);
    const profile = createMockIdentityProfile({ country: "KZ", adultAttested: true, mockAcknowledged: true, dataUsageAccepted: true }, undefined, 100);
    await ledger.saveMockIdentityProfile(email, profile);
    assert.deepEqual(await ledger.getMockIdentityProfile(email), profile);
    assert.equal(await ledger.getMockIdentityProfile("different@example.invalid"), null);
    await ledger.clearMockIdentityProfile(email);
    assert.equal(await ledger.getMockIdentityProfile(email), null);
    assert.equal(await ledger.getEmailWalletAddress(email), "11111111111111111111111111111111");
    assert.equal((await ledger.getEmailPreferences(email)).receiptsEnabled, false);
  } finally {
    nodeModule._resolveFilename = originalResolve;
    if (previousPath === undefined) delete process.env.DEMO_LEDGER_PATH; else process.env.DEMO_LEDGER_PATH = previousPath;
    await rm(folder, { recursive: true, force: true });
  }
});
