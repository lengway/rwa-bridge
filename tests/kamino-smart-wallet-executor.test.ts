import assert from "node:assert/strict";
import { test } from "node:test";
import Module from "node:module";
import { resolve } from "node:path";
import type { SmartWalletStage } from "../lib/kamino-smart-wallet-executor";

type ModuleWithResolver = typeof Module & { _resolveFilename: (...args: unknown[]) => string };

// `server-only` is a Next.js compile-time marker that is not installed as a Node
// package; stub only that marker so the executor can load under node:test.
async function loadExecutor() {
  const nodeModule = Module as unknown as ModuleWithResolver;
  const originalResolveFilename = nodeModule._resolveFilename;
  const markerStub = resolve(process.cwd(), "lib/action-errors.ts");
  nodeModule._resolveFilename = ((request: unknown, ...args: unknown[]) => (
    request === "server-only" ? markerStub : originalResolveFilename(request, ...args)
  )) as ModuleWithResolver["_resolveFilename"];
  try {
    return await import("../lib/kamino-smart-wallet-executor");
  } finally {
    nodeModule._resolveFilename = originalResolveFilename;
  }
}
import type { CrossmintKaminoTransaction } from "../lib/crossmint-kamino-provider";

function record() {
  return { stage: "CREATE_UNKNOWN" as SmartWalletStage, status: "CREATE_UNKNOWN" as SmartWalletStage,
    immutableWire: "immutable-intent-wire", providerTransactionId: null as string | null,
    providerStatus: null as CrossmintKaminoTransaction["status"] | null };
}
function provider(transaction = "immutable-intent-wire"): CrossmintKaminoTransaction {
  return { id: "provider-id", chainType: "solana", walletType: "smart", status: "awaiting-approval",
    params: { transaction, feeConfig: { feePayer: "crossmint" } }, onChain: { transaction: "wrapped" }, fees: { mode: "project" } };
}
function harness(options: { reserveFirst?: boolean; create?: () => Promise<CrossmintKaminoTransaction>; inspect?: () => Promise<void> } = {}) {
  let creates = 0;
  const persisted: string[] = [];
  return {
    persisted,
    calls: () => creates,
    run: async (value = record()) => (await loadExecutor()).executeDurableProviderCreate(value, {
      reserve: async () => ({ first: options.reserveFirst ?? true }),
      persist: async current => { persisted.push(current.stage); },
      create: async () => { creates += 1; return options.create ? options.create() : provider(); },
      inspect: async () => options.inspect?.(),
    }),
  };
}

test("provider submission is durably marked unknown before exactly one create", async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(h.persisted[0], "CREATE_UNKNOWN");
  assert.equal(result.providerTransactionId, "provider-id");
  assert.equal(h.calls(), 1);
});

test("duplicate request reservation never calls provider create", async () => {
  const h = harness({ reserveFirst: false });
  await assert.rejects(h.run(), /already reserved/);
  assert.equal(h.calls(), 0);
});

test("provider transaction with altered amount/intent wire is rejected", async () => {
  const h = harness({ create: async () => provider("altered-amount-or-instructions") });
  await assert.rejects(h.run(), /differs from the immutable request/);
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.persisted, ["CREATE_UNKNOWN", "CREATE_UNKNOWN"]);
});

for (const attack of ["wrong vault", "unexpected wrapper instruction"]) {
  test(`envelope inspection rejection (${attack}) leaves operation blocked`, async () => {
    const h = harness({ inspect: async () => { throw new Error(`rejected: ${attack}`); } });
    await assert.rejects(h.run(), new RegExp(attack));
    assert.equal(h.calls(), 1);
    assert.deepEqual(h.persisted, ["CREATE_UNKNOWN", "CREATE_UNKNOWN"]);
  });
}

test("uncertain provider response remains blocked and does not trigger a second create", async () => {
  let attempt = 0;
  const h = harness({ create: async () => { attempt += 1; throw new Error("connection lost after submit"); } });
  await assert.rejects(h.run(), /connection lost/);
  await assert.rejects(h.run(), /connection lost/);
  assert.equal(attempt, 2); // second invocation is an intentionally invalid fresh reservation in this harness
  assert.deepEqual(h.persisted, ["CREATE_UNKNOWN", "CREATE_UNKNOWN", "CREATE_UNKNOWN", "CREATE_UNKNOWN"]);
});
