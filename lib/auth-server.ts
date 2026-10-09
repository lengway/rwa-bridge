import "server-only";

import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as signSignature,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

export const AUTH_SESSION_COOKIE = "rwa_bridge_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const JWT_TTL_SECONDS = 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type JwtRecord = Record<string, unknown>;

export type VerifiedSession = {
  email: string;
  walletAddress: string | null;
  smoke: boolean;
};

let keyCache: { privateKey: KeyObject; publicKey: KeyObject; jwk: JsonWebKey; kid: string } | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getKeys() {
  if (keyCache) return keyCache;
  const pem = requiredEnv("AUTH_JWT_PRIVATE_KEY").replace(/\\n/g, "\n");
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("AUTH_JWT_PRIVATE_KEY must be an EC P-256 private key");
  }
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Unable to export the AUTH_JWT_PRIVATE_KEY public coordinates");
  keyCache = { privateKey, publicKey, jwk, kid: requiredEnv("AUTH_JWT_KID") };
  return keyCache;
}

function getSessionSecret() {
  return requiredEnv("AUTH_SESSION_SECRET");
}

function getIssuer() {
  return requiredEnv("AUTH_JWT_ISSUER");
}

function getAudience() {
  return requiredEnv("AUTH_JWT_AUDIENCE");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  const email = normalizeEmail(value);
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export function emailLedgerKey(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export function ipLedgerKey(ip: string) {
  return createHmac("sha256", getSessionSecret()).update(ip).digest("hex");
}

export function hashEmailCode(email: string, code: string) {
  return createHmac("sha256", getSessionSecret())
    .update(`${normalizeEmail(email)}:${code}`)
    .digest("hex");
}

function base64urlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJsonPart(value: string): JwtRecord | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as JwtRecord : null;
  } catch {
    return null;
  }
}

export function deriveUserId(email: string) {
  return `user_${createHash("sha256")
    .update(`${normalizeEmail(email)}${getSessionSecret()}`)
    .digest("base64url")
    .slice(0, 24)}`;
}

export function createAuthJwt(email: string, now = Math.floor(Date.now() / 1_000)) {
  const normalizedEmail = normalizeEmail(email);
  const { privateKey, kid } = getKeys();
  const header = base64urlJson({ alg: "ES256", typ: "JWT", kid });
  const payload = base64urlJson({
    iss: getIssuer(),
    aud: getAudience(),
    sub: deriveUserId(normalizedEmail),
    email: normalizedEmail,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  });
  const signingInput = `${header}.${payload}`;
  const signature = signSignature("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

export function getAuthJwks() {
  const { jwk, kid } = getKeys();
  return {
    keys: [{
      kty: "EC",
      crv: "P-256",
      x: jwk.x,
      y: jwk.y,
      use: "sig",
      alg: "ES256",
      kid,
    }],
  };
}

export function verifyAuthJwt(token: string | null | undefined) {
  if (!token || token.length > 16_384) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (!header || !claims || header.alg !== "ES256" || header.kid !== getKeys().kid) return null;

  const now = Math.floor(Date.now() / 1_000);
  const email = typeof claims.email === "string" ? normalizeEmail(claims.email) : "";
  const issuedAt = claims.iat;
  const expiresAt = claims.exp;
  const audience = claims.aud;
  const audienceMatches = typeof audience === "string"
    ? audience === getAudience()
    : Array.isArray(audience) && audience.includes(getAudience());
  if (!email || !isValidEmail(email)
    || claims.iss !== getIssuer()
    || !audienceMatches
    || claims.sub !== deriveUserId(email)
    || typeof issuedAt !== "number"
    || typeof expiresAt !== "number"
    || issuedAt > now + 60
    || expiresAt <= now
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > JWT_TTL_SECONDS) return null;

  const signature = Buffer.from(parts[2], "base64url");
  if (signature.length !== 64) return null;
  const valid = verifySignature("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), {
    key: getKeys().publicKey,
    dsaEncoding: "ieee-p1363",
  }, signature);
  return valid ? email : null;
}

function sessionSignature(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

export function createSessionCookie(email: string, now = Math.floor(Date.now() / 1_000)) {
  const payload = base64urlJson({
    email: normalizeEmail(email),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  });
  return `${payload}.${sessionSignature(payload)}`;
}

export function verifySessionCookieClaims(value: string | null | undefined, now = Math.floor(Date.now() / 1_000)): VerifiedSession | null {
  if (!value || value.length > 4_096) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sessionSignature(payload), "base64url");
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const claims = decodeJsonPart(payload);
  const email = typeof claims?.email === "string" ? normalizeEmail(claims.email) : "";
  if (!claims || !isValidEmail(email)
    || typeof claims.iat !== "number"
    || typeof claims.exp !== "number"
    || claims.iat > now + 60
    || claims.exp <= now
    || claims.exp - claims.iat > SESSION_TTL_SECONDS) return null;
  return {
    email,
    walletAddress: typeof claims.walletAddress === "string" ? claims.walletAddress : null,
    smoke: claims.smoke === true,
  };
}

export function verifySessionCookie(value: string | null | undefined, now = Math.floor(Date.now() / 1_000)) {
  const session = verifySessionCookieClaims(value, now);
  return session && !session.smoke ? session.email : null;
}

function cookieValue(request: Request, cookieName: string) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const piece of header.split(";")) {
    const separator = piece.indexOf("=");
    if (separator < 0 || piece.slice(0, separator).trim() !== cookieName) continue;
    return decodeURIComponent(piece.slice(separator + 1).trim());
  }
  return null;
}

export async function getVerifiedSessionFromRequest(request: Request): Promise<VerifiedSession | null> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (match) {
    try {
      const email = verifyAuthJwt(match[1]);
      if (email) return { email, walletAddress: null, smoke: false };
    } catch {
      // A valid session cookie may still authorize this request.
    }
  }
  try {
    return verifySessionCookieClaims(cookieValue(request, AUTH_SESSION_COOKIE));
  } catch {
    return null;
  }
}

export async function getVerifiedEmailFromRequest(request: Request) {
  const session = await getVerifiedSessionFromRequest(request);
  return session && !session.smoke ? session.email : null;
}

export const sessionCookieMaxAge = SESSION_TTL_SECONDS;
