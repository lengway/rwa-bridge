/**
 * `MarketsService` on the real `plain_markets` program (devnet).
 *
 * Reads go straight to a Solana RPC and need no key, and are shaped for the public devnet
 * endpoint's per-method limits (10 per 10 s for getProgramAccounts / getSignaturesForAddress /
 * getTransaction, 50 for account reads):
 *
 * - accounts (Instrument, CorporateAction, ClaimReceipt, VoteRecord) via getMultipleAccounts on
 *   derived PDAs — receipts and ballots are derived from the snapshot holders;
 * - one signature feed per instrument (`signature-feed.ts`) for transaction links, the published
 *   terms and snapshot (memos returned inline) and the event log;
 * - the live register from the holders' token accounts, reconciled with the mint supply;
 * - the full balance replay (`chain-history.ts`) only on demand, for the verifier.
 *
 * Writes go through a `MarketsExecutor`: `httpExecutor` (the `/api/markets/*` routes) in the
 * browser, `DevnetIssuer` (`devnet-issuer.ts`, holds the issuer key) on the server.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

import { memosOf, replayRegister, type RegisterReplay } from "./chain-history";
import {
  MarketsClient,
  enumName,
  pda,
  toBigInt,
  type ActionKind as ProgramActionKind,
  type ActionRef,
  type ActionStatus as ProgramActionStatus,
  type ClaimReceiptAccount,
  type InstrumentRef,
  type VoteRecordAccount,
} from "./client";
import { withDerivedViews } from "./derive";
import { ALLOCATION_MEMO, parseAllocationMemo, type IssueState } from "./investor";
import { formatSettlement } from "./format";
import { toHex } from "./merkle";
import { decodeHoldings, hex32, parseSnapshotMemo, parseSnapshotPart, parseTermsMemo, snapshotFromMemo, SNAPSHOT_MEMO, TERMS_MEMO, type TermsDocument } from "./publication";
import { settlementSymbolForMint } from "./currency";
import { readRegister } from "./register";
import type {
  ActionDraft,
  ActionParams,
  ActionStatus,
  Address,
  ClaimReceipt,
  CorporateAction,
  Evidence,
  Holding,
  Instrument,
  LedgerSource,
  MarketEvent,
  MarketsLedger,
  MarketsService,
  PublishedSnapshot,
  Register,
  RegisterEntry,
  Signature,
  StatusTransition,
  TxResult,
  VoteRecord,
} from "./service";
import { SignatureFeed, rpcRetry, type SignatureInfo } from "./signature-feed";

/** Public configuration the server hands to the browser. Contains no secret. */
export type DevnetMarketsConfig = {
  mode: "devnet";
  /** RPC the browser reads from (never one carrying an API key). */
  rpcUrl: string;
  programId: string;
  /** Instruments of this issuer are listed. */
  issuer: string | null;
  /** Restrict the console to these bond mints (newest first otherwise). */
  mints: string[];
  /** Off-chain labels for known wallets (demo custody wallets). */
  directory: { address: string; label: string; custody: NonNullable<RegisterEntry["custody"]> }[];
  settlementSymbol: string;
  /** True when the server holds the issuer key and the write routes are live. */
  writable: boolean;
  apiBase: string;
};

/** A primary offering on chain plus its purchases, decoded from `UnitsSubscribed` events. */
export type OfferingPurchase = { signature: string; buyer: Address; units: bigint; amount: bigint; slot: number; ts: number | null };
export type OfferingState = {
  address: Address;
  proceedsVault: Address;
  issuePrice: bigint;
  startTs: number;
  endTs: number;
  capUnits: bigint;
  perHolderCap: bigint;
  soldUnits: bigint;
  proceeds: bigint;
  withdrawn: bigint;
  closed: boolean;
  purchases: OfferingPurchase[];
  withdrawals: { signature: string; amount: bigint; ts: number | null }[];
};

export type MockMarketsConfig = { mode: "mock" };
export type MarketsPublicConfig = DevnetMarketsConfig | MockMarketsConfig;

/** Instruction senders. Implemented by the server issuer and by the HTTP client of its routes. */
export interface MarketsExecutor {
  announce(mint: Address, draft: ActionDraft): Promise<TxResult & { actionId: Address }>;
  lockRecord(actionId: Address): Promise<TxResult>;
  postSnapshot(actionId: Address): Promise<TxResult>;
  fund(actionId: Address): Promise<TxResult>;
  pay(actionId: Address, holder: Address): Promise<TxResult>;
  claim(actionId: Address, holder: Address): Promise<TxResult>;
  vote(actionId: Address, holder: Address, choice: number): Promise<TxResult>;
  settle(actionId: Address): Promise<TxResult>;
  /** Issuer action: issue units to a wallet with no payment (capped, labelled in the console). */
  issuerAllocate(mint: Address, holder: Address, units: number): Promise<TxResult & { units: string }>;
  /** Move everything in the offering's proceeds vault to the issuer's settlement account. */
  withdrawProceeds(mint: Address): Promise<TxResult & { amount: string }>;
}

export type ExecutorOp = keyof MarketsExecutor;
export const EXECUTOR_OPS: ExecutorOp[] = ["announce", "lockRecord", "postSnapshot", "fund", "pay", "claim", "vote", "settle", "issuerAllocate", "withdrawProceeds"];

const ZERO = BigInt(0);
/** i64::MAX (a redemption lock with no end) shown as a far date. */
const FAR_FUTURE = 253_402_300_799;
const POLL_MS = 12_000;
const CLOCK_MS = 60_000;

const num = (v: { toString(): string } | number | bigint) => {
  const b = typeof v === "bigint" ? v : BigInt(v.toString());
  return b > BigInt(FAR_FUTURE) ? FAR_FUTURE : Number(b);
};
const isZero = (bytes: number[]) => bytes.every((b) => b === 0);

const STAGE: Record<ProgramActionStatus, number> = { Announced: 0, RecordLocked: 1, SnapshotPosted: 2, Funded: 3, Settling: 4, Settled: 5, Cancelled: -1 };

function short(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/** The fields of an Instrument account that gate `issue` (see `allocationWindow`). */
export function issueStateOf(account: InstrumentRef["account"]): IssueState {
  return {
    status: enumName(account.status),
    maturityTs: num(account.maturityTs),
    lockFrom: num(account.lockFrom),
    lockUntil: num(account.lockUntil),
    pendingAction: account.pendingAction != null,
    openRedemption: account.openRedemption,
  };
}

/** A tiny generation-keyed cache: everything is refetched after `invalidate()`. */
class ReadCache {
  private gen = 0;
  private entries = new Map<string, { gen: number; value: Promise<unknown> }>();

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.gen === this.gen) return hit.value as Promise<T>;
    const value = load();
    this.entries.set(key, { gen: this.gen, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  drop(key: string) {
    this.entries.delete(key);
  }

  invalidate() {
    this.gen += 1;
    if (this.entries.size > 500) this.entries.clear();
  }
}

function countingFetch(counts: Record<string, number>): typeof fetch {
  if (typeof window !== "undefined") (window as unknown as { __plainMarketsRpc?: Record<string, number> }).__plainMarketsRpc = counts;
  return (input, init) => {
    try {
      const body = JSON.parse(String(init?.body ?? "null")) as { method?: string } | { method?: string }[] | null;
      for (const b of Array.isArray(body) ? body : body ? [body] : []) if (b.method) counts[b.method] = (counts[b.method] ?? 0) + 1;
    } catch {
      // not JSON-RPC
    }
    return globalThis.fetch(input, init);
  };
}

function safeLocalStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Everything the console needs about one action, resolved from accounts + the feed. */
export type ActionBundle = {
  instrument: InstrumentRef;
  ref: ActionRef;
  action: CorporateAction;
  terms: { json: string; doc: TermsDocument; signature: string } | null;
  snapshot: PublishedSnapshot | null;
  snapshotSignature: string | null;
  receipts: ClaimReceipt[];
  votes: VoteRecord[];
};

export type DevnetLedgerOptions = {
  /** Injected connection (tests); otherwise one is created for `config.rpcUrl`. */
  connection?: Connection;
  /** Disable background polling (server, tests). */
  poll?: boolean;
};

export class DevnetLedger implements MarketsLedger {
  readonly source: LedgerSource;
  readonly connection: Connection;
  readonly client: MarketsClient;
  private readonly cache = new ReadCache();
  private readonly feeds = new Map<string, SignatureFeed>();
  private readonly known = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly labels: Map<string, DevnetMarketsConfig["directory"][number]>;
  private clockOffset = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** RPC calls by method (diagnostics; also on `window.__plainMarketsRpc` in the browser). */
  readonly rpcCalls: Record<string, number> = {};

  constructor(
    readonly config: DevnetMarketsConfig,
    private readonly executor: MarketsExecutor | null,
    private readonly options: DevnetLedgerOptions = {},
  ) {
    // web3.js would retry 429s itself and drain the per-method budget; rpcRetry backs off instead.
    this.connection = options.connection ?? new Connection(config.rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: countingFetch(this.rpcCalls) });
    this.client = MarketsClient.fromConnection(this.connection);
    if (this.client.programId.toBase58() !== config.programId) throw new Error(`Program id mismatch: IDL ${this.client.programId.toBase58()} vs config ${config.programId}`);
    this.labels = new Map(config.directory.map((d) => [d.address, d]));
    this.source = { cluster: "devnet", kind: "chain", label: config.writable ? "Solana devnet" : "Solana devnet · read-only" };
  }

  // ---- plumbing -----------------------------------------------------------------------------------

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.timers.length === 0 && this.options.poll !== false && typeof window !== "undefined") this.startPolling();
    return () => {
      this.listeners.delete(listener);
      // React resubscribes on re-render; only stop when nobody is left for a while.
      if (this.listeners.size === 0 && !this.stopTimer) {
        this.stopTimer = setTimeout(() => {
          this.stopTimer = null;
          if (this.listeners.size === 0) this.stopPolling();
        }, 5_000);
      }
    };
  }

  private startPolling() {
    const tick = () => void this.syncClock().then((moved) => moved && this.notify());
    tick();
    this.timers.push(
      setInterval(() => void this.poll(), POLL_MS),
      setInterval(tick, CLOCK_MS),
    );
  }

  private stopPolling() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** One getSignaturesForAddress per instrument: anything new invalidates the cached reads. */
  async poll() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const changed = await Promise.all([...this.feeds.values()].map((f) => f.refresh()));
      if (changed.some(Boolean)) this.changed();
    } catch {
      // transient RPC failure: try again on the next tick
    }
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  /** Drop cached reads and tell subscribers. */
  changed() {
    this.cache.invalidate();
    this.notify();
  }

  /** Resolves true when the cluster clock offset moved by a second or more. */
  private async syncClock(): Promise<boolean> {
    try {
      const slot = await rpcRetry(() => this.connection.getSlot("confirmed"));
      const t = await rpcRetry(() => this.connection.getBlockTime(slot));
      if (!t) return false;
      const offset = t - Date.now() / 1000;
      const moved = Math.abs(offset - this.clockOffset) >= 1;
      this.clockOffset = offset;
      return moved;
    } catch {
      return false;
    }
  }

  explorerTxUrl(signature: Signature) {
    return signature ? `https://explorer.solana.com/tx/${signature}${this.clusterQuery()}` : null;
  }

  explorerAddressUrl(address: Address) {
    return address ? `https://explorer.solana.com/address/${address}${this.clusterQuery()}` : null;
  }

  private clusterQuery() {
    return /127\.0\.0\.1|localhost/.test(this.config.rpcUrl) ? `?cluster=custom&customUrl=${encodeURIComponent(this.config.rpcUrl)}` : "?cluster=devnet";
  }

  /** Cluster time (wall clock corrected by the last block time read). */
  now() {
    return Math.floor(Date.now() / 1000 + this.clockOffset);
  }

  /** Cluster time read now (server-side checks). */
  async clusterNow() {
    await this.syncClock();
    return this.now();
  }

  // ---- raw data -----------------------------------------------------------------------------------

  async instrumentRef(address: PublicKey): Promise<InstrumentRef> {
    return this.cache.get(`iref:${address.toBase58()}`, async () => {
      const ref = await rpcRetry(() => this.client.fetchInstrument(address));
      if (!ref) throw new Error("Instrument not found");
      return ref;
    });
  }

  private instrumentByMint(mint: Address) {
    let key: PublicKey;
    try {
      key = new PublicKey(mint);
    } catch {
      return Promise.reject(new Error("Not a valid mint address"));
    }
    return this.instrumentRef(pda.instrument(key, this.client.programId));
  }

  async actionRef(actionId: Address): Promise<ActionRef | null> {
    return this.cache.get(`aref:${actionId}`, async () => {
      let key: PublicKey;
      try {
        key = new PublicKey(actionId);
      } catch {
        return null;
      }
      return rpcRetry(() => this.client.fetchAction(key));
    });
  }

  /** The instrument's signature feed, refreshed once per cache generation. */
  async feed(instrument: PublicKey): Promise<SignatureFeed> {
    const key = instrument.toBase58();
    let f = this.feeds.get(key);
    if (!f) {
      f = new SignatureFeed(this.connection, instrument);
      this.feeds.set(key, f);
    }
    const feed = f;
    await this.cache.get(`feed:${key}`, () => feed.refresh());
    return feed;
  }

  private async actionRefs(inst: InstrumentRef): Promise<ActionRef[]> {
    return this.cache.get(`arefs:${inst.address.toBase58()}`, () => rpcRetry(() => this.client.listActions(inst)));
  }

  private mapInstrument(ref: InstrumentRef): Instrument {
    const a = ref.account;
    const issued = toBigInt(a.issuedUnits);
    const redeemed = toBigInt(a.redeemedUnits);
    return {
      mint: a.mint.toBase58(),
      address: ref.address.toBase58(),
      programId: this.client.programId.toBase58(),
      issuer: a.issuer.toBase58(),
      payingAgent: a.payingAgent.toBase58(),
      settlementMint: a.settlementMint.toBase58(),
      settlementSymbol: settlementSymbolForMint(a.settlementMint.toBase58(), this.config.settlementSymbol),
      settlementDecimals: a.settlementDecimals,
      name: a.name,
      symbol: a.symbol,
      faceValue: toBigInt(a.faceValue),
      couponBps: a.couponBps,
      frequency: a.couponFrequency,
      issueTs: num(a.issueTs),
      maturityTs: num(a.maturityTs),
      status: enumName(a.status),
      lockFrom: num(a.lockFrom),
      lockUntil: num(a.lockUntil),
      allowlist: a.allowlistEnabled,
      issuedUnits: issued,
      supply: issued - redeemed,
      redeemedUnits: redeemed,
      actionCount: num(a.actionCount),
    };
  }

  /** The announcement memo whose sha256 equals the action's terms_hash. */
  private findTerms(feed: SignatureFeed, ref: ActionRef) {
    const want = hex32(ref.account.termsHash);
    for (const s of feed.withMemo(TERMS_MEMO)) {
      const t = parseTermsMemo(s.memo);
      if (t && toHex(sha256(new TextEncoder().encode(t.json))) === want) return { ...t, signature: s.signature };
    }
    return null;
  }

  private async findSnapshot(feed: SignatureFeed, inst: InstrumentRef, ref: ActionRef): Promise<{ snapshot: PublishedSnapshot; signature: string } | null> {
    if (isZero(ref.account.merkleRoot)) return null;
    const actionId = ref.address.toBase58();
    const ctx = { instrument: inst.address.toBase58(), mint: inst.account.mint.toBase58(), action: actionId, recordTs: num(ref.account.recordTs) };
    const candidates = feed.withMemo(SNAPSHOT_MEMO).filter((s) => s.slot === num(ref.account.snapshotSlot));
    for (const s of candidates) {
      const parsed = parseSnapshotMemo(s.memo);
      if (!parsed) continue;
      if ("holdings" in parsed) return { snapshot: snapshotFromMemo(ctx, parsed.slot, parsed.holdings), signature: s.signature };
      const chunks: string[] = [];
      for (const sig of parsed.parts) {
        const part = (await memosOf(this.connection, sig)).map(parseSnapshotPart).find((p) => p && p.action === actionId);
        if (!part) throw new Error(`Snapshot part ${short(sig)} is missing`);
        chunks[part.index] = part.chunk;
      }
      return { snapshot: snapshotFromMemo(ctx, parsed.slot, decodeHoldings(chunks.join(","))), signature: s.signature };
    }
    return null;
  }

  /** Receipts and ballots are PDAs of (action, holder): derive them from the snapshot holders. */
  private async receiptsAndVotes(ref: ActionRef, holders: string[], feed: SignatureFeed) {
    const action = ref.address;
    const kind = enumName<ProgramActionKind>(ref.account.kind);
    const keys = holders.map((h) => new PublicKey(h));
    const sigAt = (slot: number) => feed.inSlot(slot).at(-1)?.signature ?? "";
    if (kind === "Vote") {
      const addresses = keys.map((h) => pda.vote(action, h, this.client.programId));
      const accounts = (addresses.length ? await rpcRetry(() => this.client.program.account.voteRecord.fetchMultiple(addresses)) : []) as (VoteRecordAccount | null)[];
      const votes: VoteRecord[] = accounts.flatMap((v, i) =>
        v
          ? [{ address: addresses[i].toBase58(), action: action.toBase58(), holder: v.holder.toBase58(), choice: v.choice, weight: toBigInt(v.weight), slot: num(v.slot), ts: num(v.ts), signature: sigAt(num(v.slot)) }]
          : [],
      );
      return { receipts: [] as ClaimReceipt[], votes };
    }
    const addresses = keys.map((h) => pda.claim(action, h, this.client.programId));
    const accounts = (addresses.length ? await rpcRetry(() => this.client.program.account.claimReceipt.fetchMultiple(addresses)) : []) as (ClaimReceiptAccount | null)[];
    const receipts: ClaimReceipt[] = accounts.flatMap((r, i) =>
      r
        ? [
            {
              address: addresses[i].toBase58(),
              action: action.toBase58(),
              holder: r.holder.toBase58(),
              units: toBigInt(r.units),
              amount: toBigInt(r.amount),
              burnedUnits: toBigInt(r.burnedUnits),
              mode: enumName(r.mode) === "Push" ? ("push" as const) : ("claim" as const),
              slot: num(r.slot),
              ts: num(r.ts),
              signature: sigAt(num(r.slot)),
            },
          ]
        : [],
    );
    return { receipts, votes: [] as VoteRecord[] };
  }

  /** Status transitions tied to transactions through the slots and times stored on the account. */
  private transitions(feed: SignatureFeed, ref: ActionRef, terms: ActionBundle["terms"], snapshotSig: string | null, payments: { slot: number; ts: number; signature: string }[]): StatusTransition[] {
    const a = ref.account;
    const status = enumName<ProgramActionStatus>(a.status);
    const stage = STAGE[status];
    const out: StatusTransition[] = [];
    const at = (s: SignatureInfo | undefined, st: ActionStatus, fallbackTs: number) => out.push({ status: st, ts: s?.blockTime ?? fallbackTs, slot: s?.slot ?? 0, signature: s?.signature ?? "" });
    const byTime = (ts: number) => feed.atTime(ts).at(-1);
    const announced = num(a.announcedTs);
    at(terms ? feed.sigs.find((s) => s.signature === terms.signature) : byTime(announced), "Announced", announced);
    const recordSlot = num(a.recordSlot);
    if (recordSlot > 0) at(feed.inSlot(recordSlot)[0], "RecordLocked", num(a.recordLockedTs));
    if (!isZero(a.merkleRoot)) at(feed.sigs.find((s) => s.signature === snapshotSig) ?? feed.inSlot(num(a.snapshotSlot))[0], "SnapshotPosted", 0);
    const funded = num(a.fundedTs);
    if (funded > 0 && stage >= STAGE.Funded) at(byTime(funded), "Funded", funded);
    const first = [...payments].sort((x, y) => x.slot - y.slot)[0];
    if (first) out.push({ status: "Settling", ts: first.ts, slot: first.slot, signature: first.signature });
    const settled = num(a.settledTs);
    if (status === "Settled" || status === "Cancelled") at(settled > 0 ? byTime(settled) : undefined, status, settled);
    return out;
  }

  private mapAction(inst: InstrumentRef, ref: ActionRef, terms: ActionBundle["terms"]): Omit<CorporateAction, "transitions"> {
    const a = ref.account;
    const kind = enumName<ProgramActionKind>(a.kind);
    const status = enumName<ProgramActionStatus>(a.status);
    const rate = a.rateBps;
    let params: ActionParams;
    switch (kind) {
      case "Coupon":
        params = { kind, period: a.period, couponBps: rate };
        break;
      case "PartialRedemption":
        params = { kind, redeemBps: a.redeemBps, priceBps: a.priceBps };
        break;
      case "FinalRedemption":
        params = { kind, priceBps: a.priceBps, includeCoupon: rate > 0, couponBps: rate > 0 ? rate : inst.account.couponBps };
        break;
      case "Vote":
        params = { kind, question: terms?.doc.question ?? a.title, options: a.options };
        break;
    }
    const posted = !isZero(a.merkleRoot);
    const locked = toBigInt(a.recordSlot) > ZERO;
    return {
      id: ref.address.toBase58(),
      seq: num(a.id) + 1,
      instrument: inst.address.toBase58(),
      kind,
      params,
      status,
      title: a.title,
      announcedTs: num(a.announcedTs),
      recordTs: num(a.recordTs),
      paymentTs: num(a.paymentTs),
      claimDeadlineTs: num(a.claimDeadline),
      vault: kind !== "Vote" ? pda.vault(ref.address, this.client.programId).toBase58() : null,
      amountPerUnit: toBigInt(a.amountPerUnit),
      termsHash: hex32(a.termsHash),
      recordSlot: locked ? num(a.recordSlot) : null,
      merkleRoot: posted ? hex32(a.merkleRoot) : null,
      snapshotHash: posted ? hex32(a.snapshotHash) : null,
      snapshotSlot: posted ? num(a.snapshotSlot) : null,
      totalUnits: posted ? toBigInt(a.totalUnits) : null,
      supplyAtRecord: locked ? toBigInt(a.recordSupply) : null,
      holderCount: posted ? a.holderCount : null,
      totalRedeemUnits: posted ? toBigInt(a.totalRedeemUnits) : null,
      totalEntitlement: posted ? toBigInt(a.totalEntitlement) : null,
      fundedAmount: toBigInt(a.fundedAmount),
      paidAmount: toBigInt(a.paidAmount),
      paidCount: a.paidCount,
      redeemedUnits: toBigInt(a.redeemedUnits),
      sweptAmount: toBigInt(a.sweptAmount),
      tally: kind === "Vote" ? a.tally.slice(0, a.options.length).map(toBigInt) : null,
      winningOption: (a.winningOption as number | null) ?? null,
    };
  }

  private async bundle(inst: InstrumentRef, ref: ActionRef): Promise<ActionBundle> {
    return this.cache.get(`bundle:${ref.address.toBase58()}`, async () => {
      const feed = await this.feed(inst.address);
      const terms = this.findTerms(feed, ref);
      const snap = await this.findSnapshot(feed, inst, ref);
      const { receipts, votes } = snap ? await this.receiptsAndVotes(ref, snap.snapshot.holdings.map((h) => h.holder), feed) : { receipts: [], votes: [] };
      const base = this.mapAction(inst, ref, terms);
      const payments = [...receipts, ...votes].map((p) => ({ slot: p.slot, ts: p.ts, signature: p.signature }));
      let transitions = this.transitions(feed, ref, terms, snap?.signature ?? null, payments);
      // Account state can be ahead of the RPC's signature index by a moment: refresh once and re-match.
      if (transitions.some((t) => !t.signature) && (await feed.refresh().catch(() => false))) {
        transitions = this.transitions(feed, ref, terms, snap?.signature ?? null, payments);
      }
      const action: CorporateAction = { ...base, transitions };
      return { instrument: inst, ref, action, terms, snapshot: snap?.snapshot ?? null, snapshotSignature: snap?.signature ?? null, receipts, votes };
    });
  }

  private async bundleOf(actionId: Address): Promise<ActionBundle | null> {
    const ref = await this.actionRef(actionId);
    if (!ref) return null;
    const inst = await this.instrumentRef(ref.account.instrument);
    const addr = inst.address.toBase58();
    if (!this.known.has(addr)) {
      this.known.add(addr);
      this.cache.drop("instruments");
    }
    return this.bundle(inst, ref);
  }

  // ---- reads ------------------------------------------------------------------------------------

  async listInstruments(): Promise<Instrument[]> {
    return this.cache.get("instruments", async () => {
      let refs: InstrumentRef[];
      if (this.config.mints.length) {
        const fetched = await Promise.all(this.config.mints.map((m) => this.instrumentByMint(m).catch(() => null)));
        refs = fetched.filter((r): r is InstrumentRef => r != null);
      } else {
        refs = await rpcRetry(() => this.client.listInstruments(this.config.issuer ? new PublicKey(this.config.issuer) : undefined));
        refs.sort((x, y) => Number(toBigInt(y.account.createdTs) - toBigInt(x.account.createdTs)));
      }
      const listed = new Set(refs.map((r) => r.address.toBase58()));
      for (const extra of this.known) if (!listed.has(extra)) refs.push(await this.instrumentRef(new PublicKey(extra)));
      return refs.map((r) => this.mapInstrument(r));
    });
  }

  async getInstrument(mint: Address) {
    return this.instrumentByMint(mint).then(
      (ref) => this.mapInstrument(ref),
      () => null,
    );
  }

  async listActions(mint: Address) {
    const inst = await this.instrumentByMint(mint);
    const refs = await this.actionRefs(inst);
    const bundles = await Promise.all(refs.map((r) => this.bundle(inst, r)));
    return bundles.map((b) => b.action).sort((a, b) => b.seq - a.seq);
  }

  async getAction(actionId: Address) {
    return (await this.bundleOf(actionId))?.action ?? null;
  }

  async getRegister(mint: Address): Promise<Register> {
    return this.cache.get(`register:${mint}`, async () => {
      const inst = await this.instrumentByMint(mint);
      const refs = await this.actionRefs(inst);
      const bundles = await Promise.all(refs.map((r) => this.bundle(inst, r)));
      // Candidate owners: the directory, everyone who appeared in a published snapshot and every
      // wallet that received a Plain allocation (memo in the issue transaction).
      const plain = await this.plainInvestors(mint);
      const candidates = new Set([...this.config.directory.map((d) => d.address), ...plain]);
      for (const b of bundles) for (const h of b.snapshot?.holdings ?? []) candidates.add(h.holder);
      let holdings: Holding[];
      let slot: number;
      let supply: bigint;
      try {
        ({ holdings, slot, supply } = await rpcRetry(() => readRegister(this.connection, inst.account.mint, { candidates: [...candidates].map((a) => new PublicKey(a)) })));
      } catch (error) {
        if (!/does not reconcile/.test(error instanceof Error ? error.message : "")) throw error;
        // A holder outside the known set (secondary transfer): replay the full history.
        const feed = await this.feed(inst.address);
        const replay = await replayRegister(this.connection, inst.account.mint.toBase58(), feed.sigs, Number.MAX_SAFE_INTEGER, { cache: safeLocalStorage() });
        holdings = replay.holdings;
        slot = feed.sigs.at(-1)?.slot ?? 0;
        supply = toBigInt(inst.account.issuedUnits) - toBigInt(inst.account.redeemedUnits);
      }
      return {
        mint,
        slot,
        ts: this.now(),
        supply,
        entries: holdings.map((h) => {
          const d = this.labels.get(h.holder);
          if (plain.has(h.holder)) return { ...h, label: d?.label ?? "Retail investor · Plain app", custody: "smart-wallet" as const, plainInvestor: true };
          return { ...h, label: d?.label, custody: d?.custody ?? "self" };
        }),
      };
    });
  }

  /**
   * Wallets that received units through Plain's primary allocation. Each allocation's `issue`
   * transaction carries a `pm:alloc:1 <wallet> <units>` memo, so the instrument's signature feed
   * lists them with no extra RPC call.
   */
  async plainInvestors(mint: Address): Promise<Set<Address>> {
    const inst = await this.instrumentByMint(mint);
    const feed = await this.feed(inst.address);
    const out = new Set<Address>();
    for (const s of feed.withMemo(ALLOCATION_MEMO)) {
      const parsed = parseAllocationMemo(s.memo);
      if (parsed) out.add(parsed.holder);
    }
    // Buyers of the primary offering (smart wallets paying through `subscribe`).
    for (const p of (await this.getOffering(mint))?.purchases ?? []) out.add(p.buyer);
    return out;
  }

  /**
   * The instrument's primary offering, or null when it has none. Purchases come from the offering
   * PDA's signature feed; each transaction is downloaded once (cached by signature, also in
   * localStorage in the browser) and its `UnitsSubscribed` / `ProceedsWithdrawn` events decoded.
   */
  async getOffering(mint: Address): Promise<OfferingState | null> {
    return this.cache.get(`offering:${mint}`, async () => {
      const inst = await this.instrumentByMint(mint);
      const ref = await rpcRetry(() => this.client.fetchOffering(inst.address));
      if (!ref) return null;
      const o = ref.account;
      const feed = await this.feed(ref.address);
      const purchases: OfferingPurchase[] = [];
      const withdrawals: OfferingState["withdrawals"] = [];
      for (const s of feed.sigs) {
        for (const e of await this.offeringEvents(s)) {
          if (e.name === "unitsSubscribed") purchases.push({ signature: s.signature, buyer: e.buyer, units: BigInt(e.units), amount: BigInt(e.amount), slot: s.slot, ts: s.blockTime });
          if (e.name === "proceedsWithdrawn") withdrawals.push({ signature: s.signature, amount: BigInt(e.amount), ts: s.blockTime });
        }
      }
      return {
        address: ref.address.toBase58(),
        proceedsVault: o.proceedsVault.toBase58(),
        issuePrice: toBigInt(o.issuePrice),
        startTs: num(o.startTs),
        endTs: num(o.endTs),
        capUnits: toBigInt(o.capUnits),
        perHolderCap: toBigInt(o.perHolderCap),
        soldUnits: toBigInt(o.soldUnits),
        proceeds: toBigInt(o.proceeds),
        withdrawn: toBigInt(o.withdrawn),
        closed: o.closed,
        purchases,
        withdrawals,
      };
    });
  }

  private readonly offeringEventCache = new Map<string, OfferingEvent[]>();
  private async offeringEvents(s: SignatureInfo): Promise<OfferingEvent[]> {
    const key = `pm:offering-events:v1:${s.signature}`;
    const hit = this.offeringEventCache.get(s.signature);
    if (hit) return hit;
    const storage = safeLocalStorage();
    try {
      const raw = storage?.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as OfferingEvent[];
        this.offeringEventCache.set(s.signature, parsed);
        return parsed;
      }
    } catch {
      // corrupt cache entry: refetch
    }
    const tx = await rpcRetry(() => this.connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }), 6);
    if (!tx?.meta) return [];
    const events: OfferingEvent[] = [];
    for (const e of this.client.parseEvents(tx.meta.logMessages ?? [])) {
      if (e.name === "unitsSubscribed") events.push({ name: e.name, buyer: e.data.buyer.toBase58(), units: e.data.units.toString(), amount: e.data.amount.toString() });
      else if (e.name === "proceedsWithdrawn") events.push({ name: e.name, amount: e.data.amount.toString() });
    }
    this.offeringEventCache.set(s.signature, events);
    try {
      storage?.setItem(key, JSON.stringify(events));
    } catch {
      // storage full: keep the in-memory copy
    }
    return events;
  }

  async getSnapshot(actionId: Address): Promise<PublishedSnapshot | null> {
    return (await this.bundleOf(actionId))?.snapshot ?? null;
  }

  async snapshotSource(actionId: Address): Promise<Evidence | null> {
    const b = await this.bundleOf(actionId);
    return b?.snapshotSignature ? { label: "Snapshot published in the post_snapshot memo", value: b.snapshotSignature, signature: b.snapshotSignature } : null;
  }

  async termsDocument(actionId: Address) {
    const b = await this.bundleOf(actionId);
    return b?.terms ? { text: b.terms.json, signature: b.terms.signature } : null;
  }

  /** Full balance replay up to `slot` (one getTransaction per transaction; paced and cached). */
  async registerAt(mint: Address, slot: number, onProgress?: (done: number, total: number) => void): Promise<RegisterReplay> {
    const inst = await this.instrumentByMint(mint);
    const feed = await this.feed(inst.address);
    return replayRegister(this.connection, inst.account.mint.toBase58(), feed.sigs, slot, { cache: safeLocalStorage(), onProgress });
  }

  async listReceipts(actionId: Address): Promise<ClaimReceipt[]> {
    return (await this.bundleOf(actionId))?.receipts ?? [];
  }

  async listVotes(actionId: Address): Promise<VoteRecord[]> {
    return (await this.bundleOf(actionId))?.votes ?? [];
  }

  async listEvents(mint: Address): Promise<MarketEvent[]> {
    return this.cache.get(`events:${mint}`, async () => {
      const inst = await this.instrumentByMint(mint);
      const instrument = this.mapInstrument(inst);
      const refs = await this.actionRefs(inst);
      const bundles = await Promise.all(refs.map((r) => this.bundle(inst, r)));
      const feed = await this.feed(inst.address);
      return buildEventLog(instrument, bundles, feed, (a) => this.labels.get(a)?.label ?? short(a));
    });
  }

  // ---- writes -----------------------------------------------------------------------------------

  private async write<T extends TxResult>(run: (e: MarketsExecutor) => Promise<T>): Promise<T> {
    if (!this.executor) throw new Error("This console is read-only: the server has no issuer key configured.");
    const result = await run(this.executor);
    // Coalesce refreshes when several writes run back to back (pay-all), and poll again shortly
    // because the browser's RPC may trail the server's by a slot.
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.changed();
      if (typeof window !== "undefined") setTimeout(() => void this.poll(), 4_000);
    }, 1_500);
    return result;
  }

  announce(mint: Address, draft: ActionDraft) {
    return this.write((e) => e.announce(mint, draft));
  }
  lockRecord(actionId: Address) {
    return this.write((e) => e.lockRecord(actionId));
  }
  postSnapshot(actionId: Address) {
    return this.write((e) => e.postSnapshot(actionId));
  }
  fund(actionId: Address) {
    return this.write((e) => e.fund(actionId));
  }
  pay(actionId: Address, holder: Address) {
    return this.write((e) => e.pay(actionId, holder));
  }
  claim(actionId: Address, holder: Address) {
    return this.write((e) => e.claim(actionId, holder));
  }
  vote(actionId: Address, holder: Address, choice: number) {
    return this.write((e) => e.vote(actionId, holder, choice));
  }
  settle(actionId: Address) {
    return this.write((e) => e.settle(actionId));
  }
  issuerAllocate(mint: Address, holder: Address, units: number) {
    return this.write((e) => e.issuerAllocate(mint, holder, units));
  }
  withdrawProceeds(mint: Address) {
    return this.write((e) => e.withdrawProceeds(mint));
  }
}

type OfferingEvent = { name: "unitsSubscribed"; buyer: Address; units: string; amount: string } | { name: "proceedsWithdrawn"; amount: string };

/** Event log from accounts and the signature feed (no transaction downloads). */
export function buildEventLog(instrument: Instrument, bundles: Pick<ActionBundle, "action" | "receipts" | "votes">[], feed: Pick<SignatureFeed, "sigs">, label: (address: string) => string): MarketEvent[] {
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
  const out: MarketEvent[] = [];
  const first = feed.sigs[0];
  if (first) {
    out.push({ name: "InstrumentCreated", action: null, actionSeq: null, holder: null, amount: null, units: null, detail: `${instrument.symbol} created · face ${money(instrument.faceValue)}, ${instrument.couponBps / 100}% coupon`, slot: first.slot, ts: first.blockTime ?? 0, signature: first.signature });
  }
  for (const b of bundles) {
    const a = b.action;
    const ev = (name: MarketEvent["name"], status: ActionStatus, detail: string, extra: Partial<MarketEvent> = {}) => {
      const t = a.transitions.find((x) => x.status === status);
      if (t) out.push({ name, action: a.id, actionSeq: a.seq, holder: null, amount: null, units: null, detail, slot: t.slot, ts: t.ts, signature: t.signature, ...extra });
    };
    const options = a.params.kind === "Vote" ? a.params.options : [];
    ev("ActionAnnounced", "Announced", `${a.title} announced · ${a.kind === "Vote" ? options.join(" / ") : `${money(a.amountPerUnit)} per unit`}`);
    ev("RecordLocked", "RecordLocked", `${a.title}: register pinned at slot ${a.recordSlot} · ${a.supplyAtRecord ?? ZERO} units`, { units: a.supplyAtRecord });
    ev("SnapshotPosted", "SnapshotPosted", `${a.title}: ${a.holderCount} holders · root ${a.merkleRoot?.slice(0, 10)}…`, { units: a.totalUnits, amount: a.kind === "Vote" ? null : a.totalEntitlement });
    ev("ActionFunded", "Funded", `${a.title}: issuer deposited ${money(a.fundedAmount)} into the paying vault`, { amount: a.fundedAmount });
    for (const r of b.receipts) {
      out.push({
        name: r.burnedUnits > ZERO ? "UnitsRedeemed" : "EntitlementPaid",
        action: a.id,
        actionSeq: a.seq,
        holder: r.holder,
        amount: r.amount,
        units: r.burnedUnits > ZERO ? r.burnedUnits : r.units,
        detail: `${money(r.amount)} ${r.mode === "push" ? "paid by the paying agent to" : "claimed by"} ${label(r.holder)}${r.burnedUnits > ZERO ? ` · ${r.burnedUnits} units burned` : ""}`,
        slot: r.slot,
        ts: r.ts,
        signature: r.signature,
      });
    }
    for (const v of b.votes) {
      out.push({ name: "VoteCast", action: a.id, actionSeq: a.seq, holder: v.holder, amount: null, units: v.weight, detail: `${label(v.holder)} · ${v.weight} units for “${options[v.choice] ?? `option ${v.choice + 1}`}”`, slot: v.slot, ts: v.ts, signature: v.signature });
    }
    ev(
      "ActionSettled",
      "Settled",
      a.kind === "Vote"
        ? `${a.title} closed · ${a.winningOption == null ? "no majority" : `“${options[a.winningOption]}” wins`}`
        : `${a.title} settled · ${money(a.paidAmount)} to ${a.paidCount} holders${a.sweptAmount > ZERO ? ` · ${money(a.sweptAmount)} swept to the issuer` : ""}`,
      { amount: a.kind === "Vote" ? null : a.paidAmount },
    );
    ev("ActionCancelled", "Cancelled", `${a.title} cancelled`);
  }
  return out.sort((x, y) => y.slot - x.slot || y.ts - x.ts);
}

// ---- HTTP executor (browser) ---------------------------------------------------------------------

export class MarketsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MarketsApiError";
  }
}

function idempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Calls the server's issuer routes. Each call carries a fresh idempotency key and is retried once on a network error with the same key. */
export function httpExecutor(apiBase: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): MarketsExecutor {
  const call = async <T>(op: ExecutorOp, body: Record<string, unknown>): Promise<T> => {
    const key = idempotencyKey();
    const send = () =>
      fetchImpl(`${apiBase}/${op}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify(body),
      });
    let res: Response;
    try {
      res = await send();
    } catch {
      res = await send();
    }
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !data) throw new MarketsApiError(data?.error ?? `Request failed (${res.status})`, res.status);
    return data;
  };
  return {
    announce: (mint, draft) => call("announce", { mint, draft }),
    lockRecord: (actionId) => call("lockRecord", { actionId }),
    postSnapshot: (actionId) => call("postSnapshot", { actionId }),
    fund: (actionId) => call("fund", { actionId }),
    pay: (actionId, holder) => call("pay", { actionId, holder }),
    claim: (actionId, holder) => call("claim", { actionId, holder }),
    vote: (actionId, holder, choice) => call("vote", { actionId, holder, choice }),
    settle: (actionId) => call("settle", { actionId }),
    issuerAllocate: (mint, holder, units) => call("issuerAllocate", { mint, holder, units }),
    withdrawProceeds: (mint) => call("withdrawProceeds", { mint }),
  };
}

export type DevnetMarketsService = MarketsService & DevnetLedger;

export function createDevnetMarketsService(config: DevnetMarketsConfig, executor: MarketsExecutor | null, options?: DevnetLedgerOptions): DevnetMarketsService {
  return withDerivedViews(new DevnetLedger(config, executor, options)) as DevnetMarketsService;
}

/** Browser entry: reads from `config.rpcUrl`, writes through the API routes when the server is writable. */
export function createBrowserDevnetService(config: DevnetMarketsConfig) {
  return createDevnetMarketsService(config, config.writable ? httpExecutor(config.apiBase) : null);
}
