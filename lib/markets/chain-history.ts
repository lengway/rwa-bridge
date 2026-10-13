/**
 * Register and event indexer for one Plain Markets instrument, built only from public RPC calls
 * that work on the public devnet endpoint (which refuses getProgramAccounts on Token-2022).
 *
 * Every change to a bond balance goes through a transaction that names the Instrument PDA:
 * `issue` and redemption burns are program instructions, and every transfer invokes the transfer
 * hook, whose extra accounts start with the Instrument. So `getSignaturesForAddress(instrument)`
 * lists the complete history, and replaying the bond-mint `postTokenBalances` of those
 * transactions in order yields the register at any slot. The same transactions carry the
 * program's events (status transitions, payments, votes) and the publication memos.
 *
 * Isomorphic: runs in the browser verifier and on the server.
 */
import type { Connection, PublicKey, VersionedTransactionResponse } from "@solana/web3.js";

import type { MarketsClient, MarketsEvent } from "./client";
import { aggregateHoldings, type Holding } from "./merkle";
import { MEMO_PROGRAM_ID } from "./publication";

export type HistoryTx = {
  signature: string;
  slot: number;
  blockTime: number | null;
  events: MarketsEvent[];
  memos: string[];
  /** Post-transaction bond balances of the token accounts this transaction touched. */
  balances: { account: string; owner: string; amount: bigint }[];
};

/** The subset of `Connection` the indexer uses (so tests can pass a fake). */
export type HistoryConnection = Pick<Connection, "getSignaturesForAddress" | "getTransactions">;

const PAGE = 1000;
const TX_BATCH = 20;

export function parseHistoryTx(
  client: Pick<MarketsClient, "parseEvents">,
  mint: string,
  signature: string,
  tx: VersionedTransactionResponse,
): HistoryTx {
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses ?? undefined });
  const memos: string[] = [];
  for (const ix of tx.transaction.message.compiledInstructions) {
    if (keys.get(ix.programIdIndex)?.equals(MEMO_PROGRAM_ID)) {
      try {
        memos.push(new TextDecoder("utf-8", { fatal: true }).decode(ix.data));
      } catch {
        // not a text memo
      }
    }
  }
  let events: MarketsEvent[] = [];
  try {
    events = client.parseEvents(tx.meta?.logMessages ?? []);
  } catch {
    events = [];
  }
  const balances = (tx.meta?.postTokenBalances ?? [])
    .filter((b) => b.mint === mint && b.owner)
    .map((b) => ({ account: keys.get(b.accountIndex)?.toBase58() ?? String(b.accountIndex), owner: b.owner!, amount: BigInt(b.uiTokenAmount.amount) }));
  return { signature, slot: tx.slot, blockTime: tx.blockTime ?? null, events, memos, balances };
}

export class InstrumentHistory {
  /** Successful transactions, oldest first. */
  readonly txs: HistoryTx[] = [];
  private newest: string | undefined;
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly connection: HistoryConnection,
    private readonly client: Pick<MarketsClient, "parseEvents">,
    readonly instrument: PublicKey,
    readonly mint: PublicKey,
  ) {}

  /** Pulls transactions newer than the last seen one. Resolves true when anything was added. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.pull().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async pull(): Promise<boolean> {
    const fresh: string[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.connection.getSignaturesForAddress(this.instrument, { until: this.newest, before, limit: PAGE }, "confirmed");
      for (const s of page) if (!s.err) fresh.push(s.signature);
      if (page.length < PAGE) break;
      before = page[page.length - 1].signature;
    }
    if (fresh.length === 0) return false;
    fresh.reverse(); // oldest first
    const mint = this.mint.toBase58();
    let added = 0;
    for (let i = 0; i < fresh.length; i += TX_BATCH) {
      const batch = fresh.slice(i, i + TX_BATCH);
      const txs = await this.connection.getTransactions(batch, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      for (let j = 0; j < batch.length; j++) {
        const tx = txs[j];
        // Not yet visible at this commitment: stop here and pick it up on the next refresh.
        if (!tx) return added > 0;
        this.txs.push(parseHistoryTx(this.client, mint, batch[j], tx));
        this.newest = batch[j];
        added += 1;
      }
    }
    return added > 0;
  }

  /** The register replayed up to and including `slot` (everything when omitted). */
  registerAt(slot = Number.MAX_SAFE_INTEGER): { holdings: Holding[]; transactions: number; lastSignature: string | null } {
    const accounts = new Map<string, { owner: string; amount: bigint }>();
    let transactions = 0;
    let lastSignature: string | null = null;
    for (const tx of this.txs) {
      if (tx.slot > slot) break;
      if (tx.balances.length === 0) continue;
      transactions += 1;
      lastSignature = tx.signature;
      for (const b of tx.balances) accounts.set(b.account, { owner: b.owner, amount: b.amount });
    }
    return { holdings: aggregateHoldings([...accounts.values()]), transactions, lastSignature };
  }

  /** Every wallet that ever held the bond (candidates for the live register read). */
  owners(): string[] {
    return [...new Set(this.txs.flatMap((t) => t.balances.map((b) => b.owner)))];
  }

  /** Events in order, each with the transaction it came from. */
  events(): { tx: HistoryTx; event: MarketsEvent }[] {
    return this.txs.flatMap((tx) => tx.events.map((event) => ({ tx, event })));
  }
}

/** Utf-8 memos of one transaction fetched by signature (snapshot part transactions). */
export async function memosOf(connection: Pick<Connection, "getTransaction">, signature: string): Promise<string[]> {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
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
