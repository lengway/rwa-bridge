#!/usr/bin/env node
// Rotates the auth JWT signing key in an env file to RSA-2048 (RS256), which
// Crossmint's signer service requires. Values are never printed; the previous
// file is kept next to it as <file>.bak-<timestamp>.
// Usage: node scripts/rotate-jwt-key.mjs /home/plain/shared/.env.local
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/rotate-jwt-key.mjs <path-to-env-file>");
  process.exit(1);
}

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, "\\n");
const kid = `plain-rsa-${randomBytes(4).toString("hex")}`;
const values = { AUTH_JWT_PRIVATE_KEY: `"${pem}"`, AUTH_JWT_KID: kid };

const original = readFileSync(file, "utf8");
const lines = original.split("\n");
for (const [name, value] of Object.entries(values)) {
  const index = lines.findIndex(line => line.startsWith(`${name}=`));
  if (index === -1) lines.splice(lines.length - (lines.at(-1) === "" ? 1 : 0), 0, `${name}=${value}`);
  else lines[index] = `${name}=${value}`;
}

const backup = `${file}.bak-${Date.now()}`;
copyFileSync(file, backup);
writeFileSync(file, lines.join("\n"), { mode: 0o600 });
console.log(`Rotated JWT key to RS256 (kid ${kid}). Backup: ${backup}`);
