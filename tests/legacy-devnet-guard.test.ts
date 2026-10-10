import assert from "node:assert/strict";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

type ModuleWithResolver = typeof Module & {
  _resolveFilename: (...args: unknown[]) => string;
};

async function loadRequestedClusterGuard() {
  // `server-only` is a Next.js compile-time marker and is intentionally not
  // installed as a Node package in this repository. Stub only that marker so
  // this unit test can exercise the exported pure guard without a Next build.
  const nodeModule = Module as unknown as ModuleWithResolver;
  const originalResolveFilename = nodeModule._resolveFilename;
  const markerStub = resolve(process.cwd(), "lib/rwa-demo.ts");
  nodeModule._resolveFilename = ((request: unknown, ...args: unknown[]) => (
    request === "server-only" ? markerStub : originalResolveFilename(request, ...args)
  ));

  try {
    const loaded = await import("../lib/devnet-route");
    const route = (
      (loaded as unknown as { default?: typeof import("../lib/devnet-route") }).default ?? loaded
    ) as typeof import("../lib/devnet-route");
    return route.isRequestedDevnetCluster;
  } finally {
    nodeModule._resolveFilename = originalResolveFilename;
  }
}

test("legacy requested-cluster guard defaults only to Devnet", async () => {
  const isRequestedDevnetCluster = await loadRequestedClusterGuard();

  assert.equal(isRequestedDevnetCluster(undefined), true);
  assert.equal(isRequestedDevnetCluster("devnet"), true);
  assert.equal(isRequestedDevnetCluster("mainnet-beta"), false);
  assert.equal(isRequestedDevnetCluster("unknown"), false);
});
