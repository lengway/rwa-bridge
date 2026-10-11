import assert from "node:assert/strict";
import test from "node:test";
import { createMockIdentityProfile, isMockIdentityProfile } from "../lib/mock-identity";
import { normalizeWidgetOrigin, widgetAllowedOrigins } from "../lib/widget-origins";

const input = { country: "KZ", adultAttested: true, mockAcknowledged: true, dataUsageAccepted: true };

test("mock account setup can never become real verified identity", () => {
  const profile = createMockIdentityProfile({ ...input, status: "VERIFIED", identityVerified: true, passport: "ignored" }, undefined, 100);
  assert.equal(profile.status, "MOCK_COMPLETED");
  assert.equal(profile.mode, "MOCK");
  assert.equal("passport" in profile, false);
  assert.equal("identityVerified" in profile, false);
  assert.equal(isMockIdentityProfile({ ...profile, status: "VERIFIED" }), false);
  assert.equal(isMockIdentityProfile({ ...profile, mode: "LIVE" }), false);
  assert.equal(createMockIdentityProfile(input, "demo-bank", 100).source, "PARTNER_MOCK");
});

test("country and demo acknowledgements are required, not auto-approved", () => {
  for (const changes of [{ country: "" }, { country: "KAZ" }, { adultAttested: false },
    { mockAcknowledged: false }, { dataUsageAccepted: false }]) {
    assert.throws(() => createMockIdentityProfile({ ...input, ...changes }));
  }
});

test("widget origins reject wildcards, URL credentials, paths and insecure external hosts", () => {
  assert.equal(normalizeWidgetOrigin("https://bank.example"), "https://bank.example");
  assert.equal(normalizeWidgetOrigin("http://127.0.0.1:3201"), "http://127.0.0.1:3201");
  for (const value of ["*", "null", "javascript:alert(1)", "http://bank.example", "https://u:p@bank.example", "https://bank.example/path", "https://bank.example?token=x", "https://bank.example#x"]) {
    assert.equal(normalizeWidgetOrigin(value), null);
  }
  assert.deepEqual(widgetAllowedOrigins({ AUTH_JWT_ISSUER: "https://plain.example", WIDGET_ALLOWED_ORIGINS: "https://bank.example" }), ["https://plain.example", "https://bank.example"]);
  assert.throws(() => widgetAllowedOrigins({ WIDGET_ALLOWED_ORIGINS: "*" }));
});
