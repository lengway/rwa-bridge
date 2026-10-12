// Isolated sandbox integration check. Never use production auth or owner data.
// Start an app on 3204 with a separate ledger, SMTP disabled, canonical Devnet,
// ENABLE_TRANSAK_STAGING=true, ENABLE_MOONPAY_SANDBOX=true, and this fixture secret.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3204");
assert.ok(base.protocol === "http:" && base.hostname === "127.0.0.1" && base.port === "3204");
const wallet = "7cSu6RcZNygXoDfVYaPpXazNB4XXaz6A2DAU1PDG4e6C";
function cookie(email) {
  const now = Math.floor(Date.now() / 1000);
  const raw = Buffer.from(JSON.stringify({ email, iat: now, exp: now + 600 })).toString("base64url");
  return `rwa_bridge_session=${raw}.${createHmac("sha256", "plain-portfolio-read-fixture-no-prod-secret").update(raw).digest("base64url")}`;
}
const fixtureCookie = cookie("pipeline-fixture@example.invalid");
async function post(path, body, session = fixtureCookie) {
  const response = await fetch(new URL(path, base), { method: "POST", headers: {
    "Content-Type": "application/json", ...(session ? { cookie: session } : {}),
  }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  return { status: response.status, body: await response.json() };
}
assert.equal((await post("/api/funding/session", { provider: "transak", amountUsd: 30 }, null)).status, 401);
assert.equal((await post("/api/funding/check", { id: "not-an-id" }, null)).status, 401);
assert.equal((await post("/api/me/session", { walletAddress: wallet })).status, 200);
assert.equal((await post("/api/me/onboarding", { country: "KZ", adultAttested: true, mockAcknowledged: true, dataUsageAccepted: true })).status, 200);
const otherCookie = cookie("pipeline-other-fixture@example.invalid");
assert.equal((await post("/api/me/session", { walletAddress: "So11111111111111111111111111111111111111112" }, otherCookie)).status, 200);
const catalog = await (await fetch(new URL("/api/funding/methods", base))).json();
assert.equal(catalog.network, "devnet");
assert.equal(catalog.policy.collectionEnabled, false);
assert.equal(catalog.policy.gasVerified, false);
for (const provider of ["transak", "moonpay"]) assert.equal(catalog.methods.find((method) => method.id === provider)?.available, true);
assert.equal((await post("/api/funding/session", { provider: "transak", amountUsd: 1 })).status, 400);
const ip = await (await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) })).json();
for (const provider of ["transak", "moonpay"]) {
  const result = await post("/api/funding/session", { provider, amountUsd: 30, userIp: ip.ip });
  assert.equal(result.status, 200, `${provider}: ${result.body.error ?? "checkout failed"}`);
  assert.equal(result.body.deliversDevnetUsdc, false);
  assert.equal(result.body.walletAddress, wallet);
  assert.equal(new URL(result.body.url).origin, provider === "transak" ? "https://global-stg.transak.com" : "https://buy-sandbox.moonpay.com");
  // Session URLs and credentials deliberately never enter stdout.
  console.log(`PASS ${provider} sandbox bootstrap, exact host and wallet binding`);
  const checked = await post("/api/funding/check", { id: result.body.id });
  assert.equal(checked.status, provider === "transak" ? 400 : 200);
  if (provider === "moonpay") assert.equal(checked.body.walletCredited, false);
  assert.equal((await post("/api/funding/check", { id: result.body.id }, otherCookie)).status, 404);
  console.log(`PASS ${provider} tracking boundary and cross-wallet rejection`);
}
const overviewResponse = await fetch(new URL("/api/earn/overview", base), { headers: { cookie: fixtureCookie }, signal: AbortSignal.timeout(45000) });
const overview = await overviewResponse.json();
assert.equal(overviewResponse.status, 200, overview.error);
assert.equal(overview.walletAddress, wallet);
assert.equal(overview.network, "devnet");
assert.equal(overview.feeCollectionEnabled, false);
console.log(`PASS live Devnet yield overview; protocol rate ${overview.supplyApy === null ? "unavailable" : "available"}`);
console.log("No emails, card payments, wallet approvals or on-chain writes. Isolated fixture ledger only; completed checkout and signed deposit are not claimed.");
