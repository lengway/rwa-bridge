/**
 * Snapshot Merkle tree for Plain Markets corporate actions — byte-for-byte mirror of
 * `programs/plain-markets/programs/plain_markets/src/math.rs`.
 *
 *   leaf = sha256(0x00 || action[32] || holder[32] || units as u64 little-endian)
 *   node = sha256(0x01 || min(a, b) || max(a, b))        (sorted pair, proofs carry no directions)
 *
 * Leaves are ordered by holder public-key bytes (ascending). On each level adjacent nodes are
 * paired; an odd last node is promoted unchanged (no proof element for that level).
 *
 * Pure and isomorphic (Node + browser); shared vectors live in `test-vectors.json`.
 */
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";

export type KeyLike = string | Uint8Array | { toBytes(): Uint8Array };

export type Holding = { holder: string; units: bigint };

const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

export function keyBytes(key: KeyLike): Uint8Array {
  const bytes = typeof key === "string" ? bs58.decode(key) : key instanceof Uint8Array ? key : key.toBytes();
  if (bytes.length !== 32) throw new Error(`expected a 32-byte public key, got ${bytes.length} bytes`);
  return bytes;
}

export function keyString(key: KeyLike): string {
  return typeof key === "string" ? key : bs58.encode(keyBytes(key));
}

export function u64Le(value: bigint): Uint8Array {
  if (value < BigInt(0) || value > U64_MAX) throw new Error(`u64 out of range: ${value}`);
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function leafHash(action: KeyLike, holder: KeyLike, units: bigint): Uint8Array {
  return sha256(concat(Uint8Array.of(0x00), keyBytes(action), keyBytes(holder), u64Le(units)));
}

export function nodeHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  return compareBytes(a, b) <= 0
    ? sha256(concat(Uint8Array.of(0x01), a, b))
    : sha256(concat(Uint8Array.of(0x01), b, a));
}

export function verifyProof(leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  let acc = leaf;
  for (const sibling of proof) acc = nodeHash(acc, sibling);
  return compareBytes(acc, root) === 0;
}

/**
 * Collapse raw register rows (one per token account) into one holding per owner wallet and drop
 * empty balances. The on-chain leaf is per wallet.
 */
export function aggregateHoldings(rows: Iterable<{ owner: string; amount: bigint }>): Holding[] {
  const byOwner = new Map<string, bigint>();
  for (const row of rows) {
    if (row.amount < BigInt(0)) throw new Error(`negative balance for ${row.owner}`);
    byOwner.set(row.owner, (byOwner.get(row.owner) ?? BigInt(0)) + row.amount);
  }
  return sortHoldings([...byOwner].filter(([, units]) => units > BigInt(0)).map(([holder, units]) => ({ holder, units })));
}

export function sortHoldings(holdings: Holding[]): Holding[] {
  return [...holdings].sort((a, b) => compareBytes(keyBytes(a.holder), keyBytes(b.holder)));
}

export type SnapshotTree = {
  action: string;
  /** Holdings in canonical (leaf) order. */
  holdings: Holding[];
  leaves: Uint8Array[];
  /** levels[0] = leaves, last level = [root]. */
  levels: Uint8Array[][];
  root: Uint8Array;
  totalUnits: bigint;
  proof(holder: KeyLike): Uint8Array[];
  holdingOf(holder: KeyLike): Holding | undefined;
};

export function buildSnapshotTree(action: KeyLike, holdings: Holding[]): SnapshotTree {
  if (holdings.length === 0) throw new Error("snapshot needs at least one holding");
  const sorted = sortHoldings(holdings);
  const index = new Map<string, number>();
  let totalUnits = BigInt(0);
  sorted.forEach((h, i) => {
    if (h.units <= BigInt(0) || h.units > U64_MAX) throw new Error(`invalid units for ${h.holder}: ${h.units}`);
    const key = keyString(h.holder);
    if (index.has(key)) throw new Error(`duplicate holder ${key}`);
    index.set(key, i);
    totalUnits += h.units;
  });
  if (totalUnits > U64_MAX) throw new Error("total units overflow u64");

  const actionKey = keyString(action);
  const leaves = sorted.map((h) => leafHash(actionKey, h.holder, h.units));
  const levels: Uint8Array[][] = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const level = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    }
    levels.push(next);
  }

  return {
    action: actionKey,
    holdings: sorted,
    leaves,
    levels,
    root: levels[levels.length - 1][0],
    totalUnits,
    holdingOf(holder) {
      const i = index.get(keyString(holder));
      return i === undefined ? undefined : sorted[i];
    },
    proof(holder) {
      let i = index.get(keyString(holder));
      if (i === undefined) throw new Error(`holder ${keyString(holder)} is not in the snapshot`);
      const proof: Uint8Array[] = [];
      for (let l = 0; l < levels.length - 1; l++) {
        const sibling = i ^ 1;
        if (sibling < levels[l].length) proof.push(levels[l][sibling]);
        i >>= 1;
      }
      return proof;
    },
  };
}

/** Canonical snapshot document whose sha256 is committed on-chain as `snapshot_hash`. */
export type CanonicalSnapshot = {
  version: 1;
  instrument: string;
  mint: string;
  action: string;
  recordTs: number;
  slot: number;
  holdings: Holding[];
};

/**
 * Deterministic JSON: fixed key order, holdings sorted by holder bytes, units as decimal strings
 * (no bigint/float ambiguity), no whitespace.
 */
export function canonicalSnapshotJson(s: CanonicalSnapshot): string {
  const holdings = sortHoldings(s.holdings).map((h) => ({ holder: keyString(h.holder), units: h.units.toString() }));
  return JSON.stringify({
    version: s.version,
    instrument: keyString(s.instrument),
    mint: keyString(s.mint),
    action: keyString(s.action),
    recordTs: s.recordTs,
    slot: s.slot,
    holdings,
  });
}

export function snapshotHash(s: CanonicalSnapshot): Uint8Array {
  return sha256(new TextEncoder().encode(canonicalSnapshotJson(s)));
}

export function parseCanonicalSnapshot(json: string): CanonicalSnapshot {
  const raw = JSON.parse(json) as Omit<CanonicalSnapshot, "holdings"> & { holdings: { holder: string; units: string }[] };
  if (raw.version !== 1) throw new Error(`unsupported snapshot version ${raw.version}`);
  return { ...raw, holdings: raw.holdings.map((h) => ({ holder: h.holder, units: BigInt(h.units) })) };
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
