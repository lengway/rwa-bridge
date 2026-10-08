import "server-only";

import { createPublicKey, verify as verifySignature } from "node:crypto";
import { crossmintApiKey } from "@/lib/config";

type JwtRecord = Record<string, unknown>;
type CrossmintJwk = { kty?: string; n?: string; e?: string; kid?: string; alg?: string; use?: string };

let cachedJwks: { keys: CrossmintJwk[]; expiresAt: number } | null = null;

function decodePart(value: string): JwtRecord | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as JwtRecord
      : null;
  } catch {
    return null;
  }
}

function decodeBase58(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(0);
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    number = number * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > BigInt(0)) {
    bytes.unshift(Number(number & BigInt(255)));
    number >>= BigInt(8);
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes.unshift(0);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function expectedProjectId() {
  const prefix = crossmintApiKey.startsWith("ck_staging_")
    ? "ck_staging_"
    : crossmintApiKey.startsWith("ck_production_")
      ? "ck_production_"
      : crossmintApiKey.startsWith("ck_development_")
        ? "ck_development_"
        : "";
  if (!prefix) return null;
  const encoded = crossmintApiKey.slice(prefix.length);
  const decoded = decodeBase58(encoded);
  if (!decoded) return null;
  return decoded.split(":", 1)[0].split(".", 1)[0] || null;
}

function crossmintBaseUrl() {
  if (crossmintApiKey.startsWith("ck_staging_")) return "https://staging.crossmint.com";
  if (crossmintApiKey.startsWith("ck_production_")) return "https://www.crossmint.com";
  return null;
}

async function getJwks(baseUrl: string) {
  if (cachedJwks && cachedJwks.expiresAt > Date.now()) return cachedJwks.keys;
  const response = await fetch(`${baseUrl}/.well-known/jwks.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Crossmint JWKS unavailable");
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { keys?: unknown }).keys)) {
    throw new Error("Invalid Crossmint JWKS");
  }
  const keys = (payload as { keys: CrossmintJwk[] }).keys;
  cachedJwks = { keys, expiresAt: Date.now() + 60 * 60 * 1_000 };
  return keys;
}

function matchesAudience(audience: unknown, projectId: string) {
  return typeof audience === "string"
    ? audience === projectId
    : Array.isArray(audience) && audience.includes(projectId);
}

export async function verifyCrossmintEmailToken(token: string | null | undefined) {
  if (!token || token.length > 16_384) return null;
  const baseUrl = crossmintBaseUrl();
  const projectId = expectedProjectId();
  if (!baseUrl || !projectId) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return null;

  const issuer = claims.iss;
  if (typeof issuer !== "string") return null;
  try {
    if (new URL(issuer).origin !== baseUrl) return null;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1_000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now) return null;
  if (!matchesAudience(claims.aud, projectId)) return null;

  const jwk = (await getJwks(baseUrl)).find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) return null;
  const signature = Buffer.from(parts[2], "base64url");
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e, } as { kty: string; n?: string; e?: string; [key: string]: unknown }, format: "jwk" }),
    signature,
  );
  if (!valid) return null;

  const userClaim = typeof claims.user === "object" && claims.user !== null
    ? claims.user as Record<string, unknown>
    : null;
  const email = typeof claims.email === "string" ? claims.email : userClaim?.email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email.trim().toLowerCase();
}

export async function getVerifiedEmailFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await verifyCrossmintEmailToken(match[1]);
  } catch {
    return null;
  }
}
