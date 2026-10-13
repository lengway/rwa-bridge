/**
 * The cheap view of an instrument's history: `getSignaturesForAddress(instrument)` lists every
 * transaction that touched it (every program instruction and, via the transfer hook, every bond
 * transfer) with slot, block time and memo text inline. One RPC call per 1,000 transactions, no
 * `getTransaction` (which the public devnet endpoint limits to 10 per 10 s).
 *
 * Status transitions and receipts are tied to signatures through values the program stores in its
 * accounts: `record_slot`, `snapshot_slot`, `ClaimReceipt.slot`, `VoteRecord.slot`, and
 * `announced_ts` / `funded_ts` / `settled_ts` (the cluster clock, which is the block time). The
 * announcement and snapshot memos are additionally bound by `terms_hash` and the snapshot slot.
 */
import type { Connection, PublicKey } from "@solana/web3.js";

export type SignatureInfo = { signature: string; slot: number; blockTime: number | null; memos: string[] };

const PAGE = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Splits the RPC `memo` field ("[len] text; [len] text") into memo texts. `len` is the byte length
 * of the memo, so texts containing "; " are handled.
 */
export function parseMemoField(field: string | null | undefined): string[] {
  if (!field) return [];
  const bytes = new TextEncoder().encode(field);
  const dec = new TextDecoder();
  const out: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0x5b) break; // "["
    let j = i + 1;
    let len = 0;
    while (j < bytes.length && bytes[j] >= 0x30 && bytes[j] <= 0x39) len = len * 10 + (bytes[j++] - 0x30);
    if (bytes[j] !== 0x5d || bytes[j + 1] !== 0x20) break; // "] "
    const start = j + 2;
    out.push(dec.decode(bytes.slice(start, start + len)));
    i = start + len;
    if (bytes[i] === 0x3b && bytes[i + 1] === 0x20) i += 2; // "; "
  }
  return out;
}

/** Retries rate-limited calls (the public endpoint asks for ~10 s). */
export async function rpcRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (i + 1 >= attempts || !/429|too many requests|rate limit|fetch failed|timed out|ECONNRESET/i.test(message)) throw error;
      await sleep(Math.min(1_500 * 2 ** i, 10_000) + Math.random() * 400);
    }
  }
}

export class SignatureFeed {
  /** Successful transactions, oldest first. */
  readonly sigs: SignatureInfo[] = [];
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly connection: Pick<Connection, "getSignaturesForAddress">,
    readonly address: PublicKey,
  ) {}

  refresh(): Promise<boolean> {
    this.refreshing ??= this.pull().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async pull(): Promise<boolean> {
    const until = this.sigs.at(-1)?.signature;
    const fresh: SignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await rpcRetry(() => this.connection.getSignaturesForAddress(this.address, { until, before, limit: PAGE }, "confirmed"));
      for (const s of page) if (!s.err) fresh.push({ signature: s.signature, slot: s.slot, blockTime: s.blockTime ?? null, memos: parseMemoField(s.memo) });
      if (page.length < PAGE) break;
      before = page[page.length - 1].signature;
    }
    fresh.reverse();
    this.sigs.push(...fresh);
    return fresh.length > 0;
  }

  inSlot(slot: number) {
    return this.sigs.filter((s) => s.slot === slot);
  }

  atTime(ts: number) {
    return this.sigs.filter((s) => s.blockTime === ts);
  }

  withMemo(prefix: string) {
    return this.sigs.flatMap((s) => s.memos.filter((m) => m.startsWith(prefix)).map((memo) => ({ ...s, memo })));
  }
}
