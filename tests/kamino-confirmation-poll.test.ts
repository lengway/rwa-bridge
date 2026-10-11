import assert from "node:assert/strict";
import test from "node:test";
import { pollKaminoConfirmation, type KaminoConfirmationCheck } from "../lib/kamino-confirmation-poll";

test("confirmation polling stops on verified completion without resending", async () => {
  const sequence: KaminoConfirmationCheck[] = ["pending", "pending", "confirmed"];
  let checks = 0;
  const result = await pollKaminoConfirmation({ signal: new AbortController().signal,
    check: async () => sequence[checks++], wait: async () => undefined });
  assert.equal(result, "confirmed");
  assert.equal(checks, 3);
});

test("timeouts remain pending and errors never become completed or failed", async () => {
  let checks = 0;
  assert.equal(await pollKaminoConfirmation({ signal: new AbortController().signal, maxAttempts: 3,
    check: async () => { checks++; return "pending"; }, wait: async () => undefined }), "pending");
  assert.equal(checks, 3);
  for (const outcome of ["failed", "unknown"] as const) {
    checks = 0;
    assert.equal(await pollKaminoConfirmation({ signal: new AbortController().signal,
      check: async () => { checks++; return outcome; } }), outcome);
    assert.equal(checks, 1);
  }
  assert.equal(await pollKaminoConfirmation({ signal: new AbortController().signal,
    check: async () => { throw new Error("RPC unavailable"); } }), "unknown");
});

test("closing a drawer cancels further checks, including an in-flight response", async () => {
  const controller = new AbortController();
  let checks = 0;
  assert.equal(await pollKaminoConfirmation({ signal: controller.signal,
    check: async () => { checks++; controller.abort(); return "confirmed"; } }), "cancelled");
  assert.equal(checks, 1);
  assert.equal(await pollKaminoConfirmation({ signal: controller.signal,
    check: async () => { checks++; return "pending"; } }), "cancelled");
  assert.equal(checks, 1);
});
