/**
 * How Plain Markets publishes off-chain documents on-chain, so the verifier needs nothing but the
 * Solana ledger:
 *
 * - Announcement terms: a memo in the `announce` transaction, `pm:terms:1 <json>`. The program
 *   stores `terms_hash = sha256(json)`, so the document can be opened and checked.
 * - Register snapshot: a memo in the `post_snapshot` transaction,
 *   `pm:snap:1 <slot> <holder>:<units>,<holder>:<units>,...`. Instrument, mint, action and record
 *   date come from the accounts, so the canonical snapshot JSON (whose sha256 is `snapshot_hash`)
 *   is rebuilt exactly. When the register does not fit in one transaction the holdings go into
 *   part transactions first (`pm:snap:1:part <action> <i>/<n> <chunk>`) and the post_snapshot
 *   memo lists their signatures: `pm:snap:1 <slot> parts=<sig>,<sig>`.
 *
 * Pure and isomorphic.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import { toHex } from "./merkle";
import type { ActionKind, Holding, PublishedSnapshot } from "./service";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const TERMS_MEMO = "pm:terms:1";
export const SNAPSHOT_MEMO = "pm:snap:1";
export const SNAPSHOT_PART_MEMO = "pm:snap:1:part";

export function memoInstruction(text: string) {
  return new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(text, "utf8") });
}

// ---- terms ---------------------------------------------------------------------------------------

export type TermsDocument = {
  v: 1;
  kind: ActionKind;
  title: string;
  recordTs: number;
  paymentTs: number;
  claimDeadlineTs: number;
  rateBps: number;
  redeemBps: number;
  priceBps: number;
  options: string[];
  /** Votes: the resolution text (only its hash is on-chain). */
  question: string | null;
};

/** Fixed key order, no whitespace. */
export function termsJson(t: TermsDocument) {
  return JSON.stringify({
    v: 1,
    kind: t.kind,
    title: t.title,
    recordTs: t.recordTs,
    paymentTs: t.paymentTs,
    claimDeadlineTs: t.claimDeadlineTs,
    rateBps: t.rateBps,
    redeemBps: t.redeemBps,
    priceBps: t.priceBps,
    options: t.options,
    question: t.question,
  });
}

export const termsHash = (json: string) => sha256(new TextEncoder().encode(json));
export const termsMemo = (json: string) => `${TERMS_MEMO} ${json}`;

/** The JSON document inside a terms memo, or null. */
export function parseTermsMemo(memo: string): { json: string; doc: TermsDocument } | null {
  if (!memo.startsWith(`${TERMS_MEMO} `)) return null;
  const json = memo.slice(TERMS_MEMO.length + 1);
  try {
    const doc = JSON.parse(json) as TermsDocument;
    return doc?.v === 1 ? { json, doc } : null;
  } catch {
    return null;
  }
}

// ---- snapshot -----------------------------------------------------------------------------------

export function encodeHoldings(holdings: Holding[]) {
  return holdings.map((h) => `${h.holder}:${h.units.toString()}`).join(",");
}

export function decodeHoldings(body: string): Holding[] {
  if (!body) return [];
  return body.split(",").map((pair) => {
    const [holder, units] = pair.split(":");
    if (!holder || !/^\d+$/.test(units ?? "")) throw new Error(`malformed snapshot entry "${pair}"`);
    return { holder, units: BigInt(units) };
  });
}

/** Holdings string split into chunks of at most `max` bytes, on entry boundaries. */
export function chunkHoldings(body: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const entry of body.split(",")) {
    const next = cur ? `${cur},${entry}` : entry;
    if (next.length > max && cur) {
      out.push(cur);
      cur = entry;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export const snapshotInlineMemo = (slot: number, holdings: Holding[]) => `${SNAPSHOT_MEMO} ${slot} ${encodeHoldings(holdings)}`;
export const snapshotPartsMemo = (slot: number, signatures: string[]) => `${SNAPSHOT_MEMO} ${slot} parts=${signatures.join(",")}`;
export const snapshotPartMemo = (action: string, i: number, n: number, chunk: string) => `${SNAPSHOT_PART_MEMO} ${action} ${i}/${n} ${chunk}`;

export type SnapshotMemo = { slot: number; holdings: Holding[] } | { slot: number; parts: string[] };

export function parseSnapshotMemo(memo: string): SnapshotMemo | null {
  if (!memo.startsWith(`${SNAPSHOT_MEMO} `) || memo.startsWith(SNAPSHOT_PART_MEMO)) return null;
  const [slotText, body = ""] = memo.slice(SNAPSHOT_MEMO.length + 1).split(" ", 2);
  const slot = Number(slotText);
  if (!Number.isSafeInteger(slot)) return null;
  if (body.startsWith("parts=")) return { slot, parts: body.slice(6).split(",").filter(Boolean) };
  return { slot, holdings: decodeHoldings(body) };
}

export function parseSnapshotPart(memo: string): { action: string; index: number; count: number; chunk: string } | null {
  if (!memo.startsWith(`${SNAPSHOT_PART_MEMO} `)) return null;
  const [action, pos, chunk = ""] = memo.slice(SNAPSHOT_PART_MEMO.length + 1).split(" ", 3);
  const [i, n] = (pos ?? "").split("/").map(Number);
  if (!action || !Number.isInteger(i) || !Number.isInteger(n)) return null;
  return { action, index: i, count: n, chunk };
}

export function snapshotFromMemo(
  ctx: { instrument: string; mint: string; action: string; recordTs: number },
  slot: number,
  holdings: Holding[],
): PublishedSnapshot {
  return { version: 1, instrument: ctx.instrument, mint: ctx.mint, action: ctx.action, recordTs: ctx.recordTs, slot, holdings };
}

export const hex32 = (bytes: number[] | Uint8Array) => toHex(Uint8Array.from(bytes));
