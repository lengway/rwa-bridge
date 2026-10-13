/**
 * Full register replay for one Plain Markets instrument from public RPC data.
 *
 * Every change to a bond balance goes through a transaction that names the Instrument PDA:
 * `issue` and redemption burns are program instructions, and every transfer invokes the transfer
 * hook, whose extra accounts start with the Instrument. So the signature feed of the instrument
 * (`signature-feed.ts`) is the complete history, and replaying the bond-mint `postTokenBalances`
 * of those transactions in order yields the register at any slot — independently of the issuer's
 * published snapshot.
 *
 * This needs one `getTransaction` per transaction, which the public devnet endpoint limits to 10
 * per 10 s, so it is paced, retried, and confirmed transactions (immutable) are cached.
 * Isomorphic.
 */
import type { Connection, VersionedTransactionResponse } from "@solana/web3.js";

import { aggregateHoldings, type Holding } from "./merkle";
import { MEMO_PROGRAM_ID } from "./publication";
import { rpcRetry, type SignatureInfo } from "./signature-feed";

/** JSON-safe bond balance changes of one transaction. */
export type BalanceRecord = {
  signature: string;
  slot: number;
  /** Post-transaction bond balances of the token accounts it touched (amount as decimal). */
  balances: { account: string; owner: string; amount: string }[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function balancesFromTx(mint: string, signature: string, tx: VersionedTransactionResponse): BalanceRecord {
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined });
  return {
    signature,
    slot: tx.slot,
    balances: (tx.meta?.postTokenBalances ?? [])
      .filter((b) => b.mint === mint && b.owner)
      .map((b) => ({ account: keys.get(b.accountIndex)?.toBase58() ?? String(b.accountIndex), owner: b.owner!, amount: b.uiTokenAmount.amount })),
  };
}

export type RegisterReplay = { holdings: Holding[]; transactions: number; lastSignature: string | null };

/** Applies balance records in order (pure). */
export function replayBalances(records: BalanceRecord[], uptoSlot = Number.MAX_SAFE_INTEGER): RegisterReplay {
  const accounts = new Map<string, { owner: string; amount: bigint }>();
  let transactions = 0;
  let lastSignature: string | null = null;
  for (const r of records) {
    if (r.slot > uptoSlot) break;
    if (r.balances.length === 0) continue;
    transactions += 1;
    lastSignature = r.signature;
    for (const b of r.balances) accounts.set(b.account, { owner: b.owner, amount: BigInt(b.amount) });
  }
  return { holdings: aggregateHoldings([...accounts.values()]), transactions, lastSignature };
}

export type ReplayOptions = {
  /** Confirmed transactions are cached here across visits (e.g. localStorage). */
  cache?: StorageLike | null;
  onProgress?: (done: number, total: number) => void;
  /** Parallel getTransaction calls. */
  concurrency?: number;
};

/** Fetches the bond balance changes of `sigs` (oldest first) and replays them up to `uptoSlot`. */
export async function replayRegister(
  connection: Pick<Connection, "getTransaction">,
  mint: string,
  sigs: SignatureInfo[],
  uptoSlot: number,
  options: ReplayOptions = {},
): Promise<RegisterReplay> {
  const wanted = sigs.filter((s) => s.slot <= uptoSlot);
  const key = (sig: string) => `pm:bal:v1:${mint}:${sig}`;
  const records: (BalanceRecord | null)[] = new Array(wanted.length).fill(null);
  let done = 0;
  let next = 0;
  options.onProgress?.(0, wanted.length);
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency ?? 2, wanted.length) }, async () => {
      while (next < wanted.length) {
        const i = next++;
        const sig = wanted[i].signature;
        let rec: BalanceRecord | null = null;
        try {
          const raw = options.cache?.getItem(key(sig));
          if (raw) rec = JSON.parse(raw) as BalanceRecord;
        } catch {
          rec = null;
        }
        if (!rec) {
          const tx = await rpcRetry(() => connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }), 6);
          if (!tx) throw new Error(`Transaction ${sig.slice(0, 8)}… is not available from this RPC`);
          rec = balancesFromTx(mint, sig, tx);
          try {
            options.cache?.setItem(key(sig), JSON.stringify(rec));
          } catch {
            // storage full or blocked
          }
        }
        records[i] = rec;
        options.onProgress?.(++done, wanted.length);
      }
    }),
  );
  return replayBalances(records as BalanceRecord[], uptoSlot);
}

/** Utf-8 memos of one transaction fetched by signature (snapshot part transactions). */
export async function memosOf(connection: Pick<Connection, "getTransaction">, signature: string): Promise<string[]> {
  const tx = await rpcRetry(() => connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
  if (!tx) return [];
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined });
  return tx.transaction.message.compiledInstructions.flatMap((ix) => {
    if (!keys.get(ix.programIdIndex)?.equals(MEMO_PROGRAM_ID)) return [];
    try {
      return [new TextDecoder("utf-8", { fatal: true }).decode(ix.data)];
    } catch {
      return [];
    }
  });
}
