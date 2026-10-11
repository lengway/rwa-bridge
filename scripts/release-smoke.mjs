// Read-only HTTP checks. Invalid/unauthenticated command checks run on loopback
// only and must fail before simulation, signing, submission or ledger mutation.
import assert from "node:assert/strict";

const base = new URL(process.argv[2] || "http://127.0.0.1:3201");
if (!["http:", "https:"].includes(base.protocol)) throw new Error("Expected an HTTP(S) app URL.");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
let passed = 0;

async function request(path, options = {}) {
  return fetch(new URL(path, base), { ...options, redirect: "manual", signal: AbortSignal.timeout(45_000) });
}
async function check(label, operation) {
  await operation();
  passed += 1;
  console.log(`PASS ${label}`);
}
for (const path of ["/", "/home", "/earn", "/earn/kamino-lend?action=withdraw", "/portfolio", "/activity", "/manifest.webmanifest"]) {
  await check(`GET ${path}`, async () => assert.equal((await request(path)).status, 200));
}
await check("catalog contains exactly the enabled Devnet Kamino route", async () => {
  const response = await request("/api/earn/strategies");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.network, "devnet");
  assert.equal(body.strategies.length, 1);
  assert.equal(body.strategies[0].id, "kamino-lend");
});
await check("live market verifies canonical Devnet and reserve", async () => {
  const response = await request("/api/kamino/market");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.network, "devnet");
  assert.equal(body.ready, true, `Market unavailable: ${body.error?.code ?? "unknown"}`);
  assert.equal(body.reserve.mint, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
});
await check("position read requires authentication", async () => {
  const response = await request("/api/kamino/position");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SESSION_REQUIRED");
});
if (local) {
  const post = (path, body) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await check("both prepare endpoints reject unauthenticated actions", async () => {
    for (const action of ["deposit", "withdraw"]) {
      const response = await post(`/api/kamino/${action}/prepare`, { amountAtomic: "1", cluster: "devnet" });
      assert.equal(response.status, 401);
    }
  });
  await check("Mainnet action is rejected before execution", async () => {
    const response = await post("/api/kamino/deposit/prepare", { amountAtomic: "1", cluster: "mainnet-beta" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_CLUSTER");
  });
  await check("non-object JSON is rejected", async () => {
    const response = await post("/api/kamino/deposit/prepare", []);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_REQUEST");
  });
  await check("confirmation requires authentication", async () => {
    for (const action of ["deposit", "withdraw"]) {
      assert.equal((await post(`/api/kamino/${action}/confirm`, {})).status, 401);
    }
  });
} else {
  console.log("SKIP remote POST checks (read-only remote audit)");
}
console.log(`${passed} HTTP checks passed. No wallet signatures or transactions were sent.`);
