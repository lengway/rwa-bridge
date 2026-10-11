import assert from "node:assert/strict";
import test from "node:test";
import { createReadCoalescer } from "../lib/read-coalescer";
import { boundedMap } from "../lib/bounded-map";

test("overlapping reads coalesce, remain wallet-scoped, and expire", async () => {
  const read = createReadCoalescer<number>(10);
  let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => read("wallet-a", load))), Array(20).fill(1));
  assert.equal(await read("wallet-a", load), 1);
  assert.equal(await read("wallet-b", load), 2);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(await read("wallet-a", load), 3);
});

test("RPC failures are not balances and retries honor cooldown", async () => {
  const read = createReadCoalescer<number>(10, 10);
  let calls = 0;
  const failure = new Error("429");
  const load = async () => { calls++; throw failure; };
  await Promise.all(Array.from({ length: 10 }, () => assert.rejects(read("wallet", load), /429/)));
  assert.equal(calls, 1);
  await assert.rejects(read("wallet", load), /429/);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(await read("wallet", async () => 12), 12);
});

test("history hydration is bounded and preserves order", async () => {
  let active = 0;
  let peak = 0;
  const values = await boundedMap([1, 2, 3, 4, 5], async (value) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return value * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(values, [2, 4, 6, 8, 10]);
});
