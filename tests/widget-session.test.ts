import assert from "node:assert/strict";
import Module from "node:module";
import { resolve } from "node:path";
import test from "node:test";

type Resolver = typeof Module & { _resolveFilename: (...args: unknown[]) => string };
async function load() {
  const nodeModule = Module as unknown as Resolver;
  const original = nodeModule._resolveFilename;
  nodeModule._resolveFilename = (request: unknown, ...args: unknown[]) => request === "server-only"
    ? resolve(process.cwd(), "lib/action-errors.ts") : original(request, ...args);
  try { return await import("../lib/widget-session"); }
  finally { nodeModule._resolveFilename = original; }
}

test("sandbox session is origin-bound, short-lived and never a user/KYC authorization", async () => {
  const originalSecret = process.env.AUTH_SESSION_SECRET;
  const originalOrigins = process.env.WIDGET_ALLOWED_ORIGINS;
  process.env.AUTH_SESSION_SECRET = "widget-test-secret-not-a-production-credential";
  process.env.WIDGET_ALLOWED_ORIGINS = "https://bank.example,https://other.example";
  try {
    const { issueSandboxWidgetSession, verifySandboxWidgetSession } = await load();
    const issued = issueSandboxWidgetSession("demo-bank", "https://bank.example", 1000);
    const verified = verifySandboxWidgetSession(issued.sessionToken, "https://bank.example", 1001);
    assert.equal(verified.mode, "SANDBOX");
    assert.equal(verified.identityVerified, false);
    assert.equal(verified.partnerId, "demo-bank");
    assert.throws(() => verifySandboxWidgetSession(issued.sessionToken, "https://other.example", 1001));
    assert.throws(() => verifySandboxWidgetSession(issued.sessionToken, "https://bank.example", 1600));
    const parts = issued.sessionToken.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    parts[1] = Buffer.from(JSON.stringify({ ...claims, identityVerified: true, scope: "user:auth" })).toString("base64url");
    assert.throws(() => verifySandboxWidgetSession(parts.join("."), "https://bank.example", 1001));
    assert.throws(() => issueSandboxWidgetSession("real-bank", "https://bank.example", 1000));
    assert.throws(() => issueSandboxWidgetSession("demo-bank", "https://unregistered.example", 1000));
  } finally {
    if (originalSecret === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = originalSecret;
    if (originalOrigins === undefined) delete process.env.WIDGET_ALLOWED_ORIGINS; else process.env.WIDGET_ALLOWED_ORIGINS = originalOrigins;
  }
});
