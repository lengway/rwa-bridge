#!/usr/bin/env node
// Copies the IDL and its TS type from the Anchor build into lib/markets/client/idl.
// Run after `anchor build` in programs/plain-markets (npm run markets:build does both).
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "programs", "plain-markets", "target");
const out = join(root, "lib", "markets", "client", "idl");

copyFileSync(join(target, "idl", "plain_markets.json"), join(out, "plain_markets.json"));
copyFileSync(join(target, "types", "plain_markets.ts"), join(out, "plain_markets.ts"));
const idl = JSON.parse(readFileSync(join(out, "plain_markets.json"), "utf8"));
console.log(`synced IDL for ${idl.address}: ${idl.instructions.length} instructions, ${idl.accounts.length} accounts, ${idl.events.length} events`);
