import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { normalizeWidgetOrigin, widgetAllowedOrigins } from "@/lib/widget-origins";

const AUDIENCE = "plain-widget-sandbox";
const LIFETIME_SECONDS = 600;
export class WidgetSessionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export type SandboxWidgetSession = {
  mode: "SANDBOX";
  identityVerified: false;
  partnerId: "demo-bank";
  parentOrigin: string;
  mockCountry: "KZ";
  mockAdult: true;
  expiresAt: number;
};

function key() {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) throw new WidgetSessionError(503, "Sandbox widget sessions are not configured.");
  return createHmac("sha256", secret).update("plain/widget/sandbox/v1/key").digest();
}
function signature(input: string) { return createHmac("sha256", key()).update(input).digest(); }
function json(value: unknown) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function allowedOrigin(value: unknown) {
  const origin = normalizeWidgetOrigin(value);
  if (!origin || !widgetAllowedOrigins().includes(origin)) throw new WidgetSessionError(403, "This embedding origin is not registered for the sandbox widget.");
  return origin;
}

export function issueSandboxWidgetSession(partnerId: unknown, parentOrigin: unknown, now = Math.floor(Date.now() / 1000)) {
  if (partnerId !== "demo-bank") throw new WidgetSessionError(403, "Only the demo-bank sandbox partner is supported. No production partner is connected.");
  const origin = allowedOrigin(parentOrigin);
  const header = json({ alg: "HS256", typ: "JWT", kid: "plain-widget-sandbox-v1" });
  const payload = json({ aud: AUDIENCE, scope: "widget:sandbox", mode: "SANDBOX", identityVerified: false,
    partnerId, parentOrigin: origin, mockCountry: "KZ", mockAdult: true, nonce: randomUUID(), iat: now, exp: now + LIFETIME_SECONDS });
  const signingInput = `${header}.${payload}`;
  return { mode: "SANDBOX" as const, identityVerified: false as const,
    sessionToken: `${signingInput}.${signature(signingInput).toString("base64url")}`, expiresAt: (now + LIFETIME_SECONDS) * 1000 };
}

export function verifySandboxWidgetSession(token: unknown, assertedOrigin?: unknown, now = Math.floor(Date.now() / 1000)): SandboxWidgetSession {
  if (typeof token !== "string" || token.length > 4096) throw new WidgetSessionError(400, "Invalid sandbox session.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new WidgetSessionError(400, "Invalid sandbox session.");
  try {
    const expected = signature(`${parts[0]}.${parts[1]}`);
    const supplied = Buffer.from(parts[2], "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("signature");
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!header || header.alg !== "HS256" || header.typ !== "JWT" || header.kid !== "plain-widget-sandbox-v1"
      || !claims || claims.aud !== AUDIENCE || claims.scope !== "widget:sandbox"
      || claims.mode !== "SANDBOX" || claims.identityVerified !== false || claims.partnerId !== "demo-bank"
      || claims.mockCountry !== "KZ" || claims.mockAdult !== true
      || typeof claims.nonce !== "string" || !/^[0-9a-f-]{36}$/.test(claims.nonce)
      || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
      || claims.iat > now + 60 || claims.exp <= now || claims.exp <= claims.iat || claims.exp - claims.iat > LIFETIME_SECONDS) throw new Error("claims");
    const origin = allowedOrigin(claims.parentOrigin);
    if (assertedOrigin !== undefined && allowedOrigin(assertedOrigin) !== origin) throw new Error("origin");
    return { mode: "SANDBOX", identityVerified: false, partnerId: "demo-bank", parentOrigin: origin,
      mockCountry: "KZ", mockAdult: true, expiresAt: claims.exp * 1000 };
  } catch (cause) {
    if (cause instanceof WidgetSessionError && cause.status === 503) throw cause;
    throw new WidgetSessionError(403, "Sandbox session is invalid, expired, or belongs to another embedding origin.");
  }
}
