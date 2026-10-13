import { buildSnapshotTree, canonicalSnapshotJson as canonicalJson, keyBytes, leafHash, snapshotHash as hashBytes, sortHoldings, toHex, fromHex, verifyProof as verifyBytes } from "./merkle";
import type { Holding, PublishedSnapshot } from "./service";

/**
 * Snapshot commitment for the UI, delegating to `merkle.ts` (the mirror of the program's `math.rs`).
 *
 * leaf  = sha256(0x00 ‖ action (32 bytes) ‖ holder (32 bytes) ‖ units u64 little-endian)
 * node  = sha256(0x01 ‖ min(a, b) ‖ max(a, b))      — sorted pair, so proofs carry no direction
 * Leaves are ordered by holder pubkey bytes; an odd node at the end of a level is promoted as is.
 * Binding the action address means a proof from one action never verifies against another.
 *
 * snapshot_hash = sha256(canonicalSnapshotJson(snapshot)), holdings sorted the same way and units
 * written as decimal strings. Everything here is synchronous and isomorphic (Node and browser);
 * the async signatures are kept for callers.
 */

export { toHex, fromHex };

/** Holdings in commitment order, zero balances dropped, duplicate holders rejected. */
export function canonicalHoldings(holdings: Holding[]): Holding[] {
  const seen = new Set<string>();
  for (const h of holdings) {
    if (h.units <= BigInt(0)) continue;
    keyBytes(h.holder);
    if (seen.has(h.holder)) throw new Error(`Duplicate holder in snapshot: ${h.holder}`);
    seen.add(h.holder);
  }
  return sortHoldings(holdings.filter((h) => h.units > BigInt(0))).map(({ holder, units }) => ({ holder, units }));
}

export type MerkleTree = { action: string; root: string; leaves: string[]; levels: string[][]; holdings: Holding[] };

export async function buildMerkleTree(action: string, holdings: Holding[]): Promise<MerkleTree> {
  const ordered = canonicalHoldings(holdings);
  if (ordered.length === 0) throw new Error("Cannot commit to an empty register");
  const tree = buildSnapshotTree(action, ordered);
  const levels = tree.levels.map((l) => l.map(toHex));
  return { action, root: toHex(tree.root), leaves: levels[0], levels, holdings: tree.holdings };
}

/** Sibling path for a holder, as hex strings (what `claim` / `pay` / `cast_vote` receive). */
export function merkleProof(tree: MerkleTree, holder: string): string[] {
  let index = tree.holdings.findIndex((h) => h.holder === holder);
  if (index < 0) throw new Error("Holder is not in the snapshot");
  const proof: string[] = [];
  for (let d = 0; d < tree.levels.length - 1; d++) {
    const sibling = index ^ 1;
    if (sibling < tree.levels[d].length) proof.push(tree.levels[d][sibling]);
    index >>= 1;
  }
  return proof;
}

export async function verifyProof(root: string, action: string, h: Holding, proof: string[]) {
  return verifyBytes(leafHash(action, h.holder, h.units), proof.map(fromHex), fromHex(root));
}

export function canonicalSnapshotJson(s: PublishedSnapshot) {
  return canonicalJson({ ...s, holdings: canonicalHoldings(s.holdings) });
}

export async function snapshotHash(s: PublishedSnapshot) {
  return toHex(hashBytes({ ...s, holdings: canonicalHoldings(s.holdings) }));
}
