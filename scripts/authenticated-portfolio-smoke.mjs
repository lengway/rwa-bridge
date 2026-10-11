// Run ONLY against an isolated loopback app with this fixture secret and a
// separate DEMO_LEDGER_PATH. Never use the owner's session or production secret.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

const base = process.argv[2] ?? "http://127.0.0.1:3204";
const url = new URL(base);
assert.ok(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
assert.ok(["3203", "3204"].includes(url.port), "Only isolated fixture ports are allowed");
// Optional public read target. Still binds only the isolated fixture account.
// Deterministic off-curve PDA fixture: ordinary-key defaults missed the
// Crossmint smart-wallet regression. No keypair exists for this test target.
const wallet = process.argv[3] ?? "7cSu6RcZNygXoDfVYaPpXazNB4XXaz6A2DAU1PDG4e6C";
assert.match(wallet, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const secret = "plain-portfolio-read-fixture-no-prod-secret";
const now = Math.floor(Date.now() / 1000);
const fixtureEmail = `portfolio-${createHash("sha256").update(wallet).digest("hex").slice(0, 12)}@example.invalid`;
const raw = Buffer.from(JSON.stringify({ email: fixtureEmail, iat: now, exp: now + 300 })).toString("base64url");
const cookie = `rwa_bridge_session=${raw}.${createHmac("sha256", secret).update(raw).digest("base64url")}`;
const headers = { cookie };
const bind = await fetch(`${base}/api/me/session`, {
  method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: wallet }),
});
assert.equal(bind.status, 200, "Isolated test session wallet binding failed");
const started = Date.now();
const responses = await Promise.all(Array.from({ length: 5 }, async () => {
  const response = await fetch(`${base}/api/devnet/portfolio?wallet=${wallet}`, { headers, signal: AbortSignal.timeout(30_000) });
  const value = await response.json();
  assert.equal(response.status, 200, value.error ?? "Portfolio read failed");
  assert.equal(value.wallet.address, wallet);
  assert.equal(value.wallet.network, "Solana devnet");
  assert.equal(typeof value.totalValueUsd, "number");
  assert.ok(Number.isFinite(value.totalValueUsd));
  assert.ok(Array.isArray(value.holdings));
  return response.status;
}));
console.log(JSON.stringify({ check: "concurrent authenticated live-Devnet portfolio", elapsedMs: Date.now() - started, responses }));
const other = "So11111111111111111111111111111111111111112";
assert.equal((await fetch(`${base}/api/devnet/portfolio?wallet=${other}`, { headers })).status, 403);
assert.equal((await fetch(`${base}/api/devnet/portfolio?wallet=${wallet}`)).status, 401);
console.log("PASS wallet scoping and unauthenticated rejection. Isolated fixtures only; no email, signatures or transactions.");
