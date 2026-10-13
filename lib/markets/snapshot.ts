import bs58 from "bs58";
import type { Holding, PublishedSnapshot } from "./service";

/**
 * Snapshot commitment format (shared by the indexer, the program and the verifier).
 *
 * leaf  = sha256(0x00 ‖ holder pubkey (32 bytes) ‖ units u64 little-endian)
 * node  = sha256(0x01 ‖ min(a, b) ‖ max(a, b))      — sorted pair, so proofs carry no direction
 * Leaves are ordered by holder pubkey bytes; an odd node at the end of a level is promoted as is.
 * Zero-unit holdings are excluded. The 0x00/0x01 prefixes keep leaves and nodes from colliding.
 *
 * snapshot_hash = sha256(canonicalSnapshotJson(snapshot)), with holdings sorted the same way and
 * units written as decimal strings.
 *
 * Hashing uses Web Crypto, so the same code runs in Node, in tests and in the browser verifier.
 */

const encoder = new TextEncoder();

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

export function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function compareBytes(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u64le(value: bigint) {
  if (value < BigInt(0) || value >= BigInt(2) ** BigInt(64)) throw new RangeError("units out of u64 range");
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

export function pubkeyBytes(address: string) {
  const bytes = bs58.decode(address);
  if (bytes.length !== 32) throw new Error(`Not a 32-byte public key: ${address}`);
  return bytes;
}

/** Holdings in commitment order, zero balances dropped, duplicate holders rejected. */
export function canonicalHoldings(holdings: Holding[]): Holding[] {
  const seen = new Set<string>();
  const rows = holdings
    .filter((h) => h.units > BigInt(0))
    .map((h) => {
      if (seen.has(h.holder)) throw new Error(`Duplicate holder in snapshot: ${h.holder}`);
      seen.add(h.holder);
      return { holder: h.holder, units: h.units, key: pubkeyBytes(h.holder) };
    });
  rows.sort((a, b) => compareBytes(a.key, b.key));
  return rows.map(({ holder, units }) => ({ holder, units }));
}

export async function leafHash(h: Holding) {
  return sha256(concat(new Uint8Array([0]), pubkeyBytes(h.holder), u64le(h.units)));
}

async function nodeHash(a: Uint8Array, b: Uint8Array) {
  const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(concat(new Uint8Array([1]), lo, hi));
}

export type MerkleTree = { root: string; leaves: string[]; levels: string[][]; holdings: Holding[] };

export async function buildMerkleTree(holdings: Holding[]): Promise<MerkleTree> {
  const ordered = canonicalHoldings(holdings);
  if (ordered.length === 0) throw new Error("Cannot commit to an empty register");
  let level = await Promise.all(ordered.map(leafHash));
  const levels: Uint8Array[][] = [level];
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? await nodeHash(level[i], level[i + 1]) : level[i]);
    }
    levels.push(next);
    level = next;
  }
  const hexLevels = levels.map((l) => l.map(toHex));
  return { root: hexLevels[hexLevels.length - 1][0], leaves: hexLevels[0], levels: hexLevels, holdings: ordered };
}

/** Sibling path for a holder, as hex strings (what `claim` / `pay` / `vote` receive). */
export function merkleProof(tree: MerkleTree, holder: string): string[] {
  let index = tree.holdings.findIndex((h) => h.holder === holder);
  if (index < 0) throw new Error("Holder is not in the snapshot");
  const proof: string[] = [];
  for (let d = 0; d < tree.levels.length - 1; d++) {
    const level = tree.levels[d];
    const sibling = index % 2 === 0 ? index + 1 : index - 1;
    if (sibling < level.length) proof.push(level[sibling]);
    index = Math.floor(index / 2);
  }
  return proof;
}

export async function verifyProof(root: string, h: Holding, proof: string[]) {
  let node = await leafHash(h);
  for (const sibling of proof) node = await nodeHash(node, fromHex(sibling));
  return toHex(node) === root;
}

export function canonicalSnapshotJson(s: PublishedSnapshot) {
  return JSON.stringify({
    version: s.version,
    instrument: s.instrument,
    mint: s.mint,
    action: s.action,
    recordTs: s.recordTs,
    slot: s.slot,
    holdings: canonicalHoldings(s.holdings).map((h) => ({ holder: h.holder, units: h.units.toString() })),
  });
}

export async function snapshotHash(s: PublishedSnapshot) {
  return toHex(await sha256(encoder.encode(canonicalSnapshotJson(s))));
}
