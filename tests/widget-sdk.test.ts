import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

async function fixture() {
  let listener: ((event: unknown) => void) | undefined;
  const posted: { message: unknown; origin: string }[] = [];
  const events: unknown[] = [];
  const frameWindow = { postMessage: (message: unknown, origin: string) => posted.push({ message, origin }) };
  let removed = false;
  const frame = { contentWindow: frameWindow, style: {}, remove: () => { removed = true; }, src: "" };
  const container = { nodeType: 1, appendChild: () => undefined };
  const window = { location: { origin: "https://bank.example" }, addEventListener: (_: string, callback: typeof listener) => { listener = callback; },
    removeEventListener: () => { listener = undefined; }, PlainWidget: undefined as unknown };
  const document = { querySelector: () => container, createElement: () => frame };
  vm.runInNewContext(await readFile("public/plain-widget.js", "utf8"), { window, document, URL });
  const sdk = window.PlainWidget as { mount: (options: Record<string, unknown>) => { destroy: () => void; retry: () => void } };
  const instance = sdk.mount({ container, baseUrl: "https://plain.example", partnerId: "demo-bank", sessionToken: "dummy-sandbox-token", onEvent: (event: unknown) => events.push(event) });
  return { sdk, instance, posted, events, frame, frameWindow, listener: () => listener, removed: () => removed };
}

test("SDK sends sandbox token only to the exact iframe origin, never in its URL", async () => {
  const f = await fixture();
  const ready = { namespace: "plain-widget", version: 1, type: "ready" };
  f.listener()!({ source: f.frameWindow, origin: "https://evil.example", data: ready });
  f.listener()!({ source: {}, origin: "https://plain.example", data: ready });
  assert.equal(f.posted.length, 0);
  f.listener()!({ source: f.frameWindow, origin: "https://plain.example", data: ready });
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0].origin, "https://plain.example");
  assert.equal(f.frame.src, "https://plain.example/widget");
  assert.doesNotMatch(f.frame.src, /token|dummy/);
  f.instance.destroy();
  assert.equal(f.removed(), true);
  assert.equal(f.listener(), undefined);
});

test("SDK refuses unsafe origins and does not treat arbitrary messages as transaction results", async () => {
  const f = await fixture();
  for (const baseUrl of ["http://bank.example", "javascript:alert(1)", "https://u:p@plain.example", "https://plain.example/path"]) {
    assert.throws(() => f.sdk.mount({ container: "#target", baseUrl, partnerId: "demo-bank", sessionToken: "dummy" }));
  }
  f.listener()!({ source: f.frameWindow, origin: "https://plain.example", data: { namespace: "plain-widget", version: 1, type: "action-confirmed", network: "mainnet-beta", action: "deposit", actionId: "12345678-1234-1234-1234-123456789abc", signature: "1".repeat(64) } });
  assert.equal(f.events.length, 0);
});
