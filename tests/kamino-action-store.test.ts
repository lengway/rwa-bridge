import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

type ModuleWithResolver = typeof Module & {
  _resolveFilename: (...args: unknown[]) => string;
};

type KaminoActionRecord = {
  id: string;
  walletAddress: string;
  action: string;
  status: string;
  createdAt?: number;
};

async function loadStore() {
  // `server-only` is a Next.js compile-time marker and is intentionally not
  // installed as a Node package in this repository. Stub only that marker so
  // this test can exercise the durable store without a Next build.
  const nodeModule = Module as unknown as ModuleWithResolver;
  const originalResolveFilename = nodeModule._resolveFilename;
  const markerStub = resolve(process.cwd(), "lib/action-errors.ts");

  nodeModule._resolveFilename = ((request: unknown, ...args: unknown[]) => (
    request === "server-only" ? markerStub : originalResolveFilename(request, ...args)
  )) as typeof originalResolveFilename;

  try {
    const loaded = await import("../lib/kamino-action-store");
    return (
      (loaded as unknown as { default?: typeof import("../lib/kamino-action-store") }).default ?? loaded
    ) as typeof import("../lib/kamino-action-store");
  } finally {
    nodeModule._resolveFilename = originalResolveFilename;
  }
}

function makeRecord(overrides: Partial<KaminoActionRecord> = {}): KaminoActionRecord {
  return {
    id: randomUUID(),
    walletAddress: "11111111111111111111111111111111",
    action: "deposit",
    status: "PENDING",
    ...overrides,
  };
}

test("concurrent puts persist independently and list newest first", async () => {
  const { KaminoActionStore } = await loadStore();
  const directory = await mkdtemp(join(tmpdir(), "kamino-action-store-"));
  const filePath = join(directory, "actions.json");
  const store = new KaminoActionStore<KaminoActionRecord>(filePath);

  try {
    const older = makeRecord({ createdAt: 1 });
    const newer = makeRecord({ createdAt: 2 });

    await Promise.all([store.put(older), store.put(newer)]);

    assert.deepEqual(await store.get(older.id), older);
    assert.deepEqual(await store.get(newer.id), newer);
    assert.deepEqual(await store.list(older.walletAddress), [newer, older]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a new store instance reads persisted files back from disk", async () => {
  const { KaminoActionStore } = await loadStore();
  const directory = await mkdtemp(join(tmpdir(), "kamino-action-store-"));
  const filePath = join(directory, "actions.json");
  const first = new KaminoActionStore<KaminoActionRecord>(filePath);
  const second = new KaminoActionStore<KaminoActionRecord>(filePath);
  const record = makeRecord({ createdAt: 5 });

  try {
    await first.put(record);
    assert.deepEqual(await second.get(record.id), record);
    assert.deepEqual(await second.list(record.walletAddress), [record]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupted JSON propagates on read", async () => {
  const { KaminoActionStore } = await loadStore();
  const directory = await mkdtemp(join(tmpdir(), "kamino-action-store-"));
  const filePath = join(directory, "actions.json");
  const store = new KaminoActionStore<KaminoActionRecord>(filePath);
  const record = makeRecord();

  try {
    await store.put(record);
    await writeFile(join(`${filePath}.d`, `${record.id}.json`), "{not-json", "utf8");
    await assert.rejects(() => store.get(record.id));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unsafe ids are rejected before any path lookup", async () => {
  const { KaminoActionStore } = await loadStore();
  const directory = await mkdtemp(join(tmpdir(), "kamino-action-store-"));
  const filePath = join(directory, "actions.json");
  const store = new KaminoActionStore<KaminoActionRecord>(filePath);

  try {
    await assert.rejects(() => store.get("not-a-uuid"));
    await assert.rejects(() => store.put(makeRecord({ id: "../escape" })));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("withLock serializes by key and releases after failure", async () => {
  const { KaminoActionStore } = await loadStore();
  const directory = await mkdtemp(join(tmpdir(), "kamino-action-store-"));
  const filePath = join(directory, "actions.json");
  const store = new KaminoActionStore<KaminoActionRecord>(filePath);
  const events: string[] = [];
  let releaseFirst!: () => void;

  try {
    const first = store.withLock("alpha", async () => {
      events.push("alpha-1-start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("alpha-1-end");
      return "first";
    });
    const second = store.withLock("alpha", async () => {
      events.push("alpha-2");
      return "second";
    });
    const failing = store.withLock("beta", async () => {
      events.push("beta-fail");
      throw new Error("boom");
    });
    const afterFailure = store.withLock("beta", async () => {
      events.push("beta-after");
      return "recovered";
    });

    await Promise.resolve();
    assert.deepEqual(events, ["alpha-1-start", "beta-fail"]);

    releaseFirst();
    assert.equal(await first, "first");
    assert.equal(await second, "second");
    await assert.rejects(failing, /boom/);
    assert.equal(await afterFailure, "recovered");
    assert.equal(events[0], "alpha-1-start");
    assert.equal(events[1], "beta-fail");
    assert.ok(events.indexOf("alpha-1-end") < events.indexOf("alpha-2"));
    assert.ok(events.indexOf("beta-fail") < events.indexOf("beta-after"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("list is scoped to one wallet address", async () => {
  const { KaminoActionStore } = await loadStore();
  const directory = await mkdtemp(join(tmpdir(), "kamino-action-store-"));
  const filePath = join(directory, "actions.json");
  const store = new KaminoActionStore<KaminoActionRecord>(filePath);
  const walletA = "11111111111111111111111111111111";
  const walletB = "22222222222222222222222222222222";
  const a1 = makeRecord({ walletAddress: walletA, createdAt: 1 });
  const a2 = makeRecord({ walletAddress: walletA, createdAt: 3 });
  const b1 = makeRecord({ walletAddress: walletB, createdAt: 2 });

  try {
    await Promise.all([store.put(a1), store.put(a2), store.put(b1)]);
    assert.deepEqual(await store.list(walletA), [a2, a1]);
    assert.deepEqual(await store.list(walletB), [b1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
