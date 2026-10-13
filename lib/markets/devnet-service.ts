/**
 * `MarketsService` on the real `plain_markets` program (devnet).
 *
 * Reads go straight to a Solana RPC and need no key: program accounts through the Anchor client,
 * the register and the event log through the instrument's transaction history
 * (`chain-history.ts`), published snapshots and terms from transaction memos (`publication.ts`).
 * The same code runs in the browser (console, verifier) and on the server.
 *
 * Writes go through a `MarketsExecutor`. In the browser that is `httpExecutor`, which calls the
 * `/api/markets/*` routes; on the server it is `DevnetIssuer` (`devnet-issuer.ts`), which holds
 * the issuer key. No key ever reaches the client.
 */
import { Connection, PublicKey } from "@solana/web3.js";

import { InstrumentHistory, memosOf, type HistoryConnection, type HistoryTx } from "./chain-history";
import {
  MarketsClient,
  enumName,
  pda,
  toBigInt,
  type ActionKind as ProgramActionKind,
  type ActionRef,
  type ActionStatus as ProgramActionStatus,
  type InstrumentRef,
  type MarketsEvent,
} from "./client";
import { withDerivedViews } from "./derive";
import { formatSettlement } from "./format";
import { hex32, parseSnapshotMemo, parseSnapshotPart, parseTermsMemo, snapshotFromMemo, decodeHoldings, type TermsDocument } from "./publication";
import { readRegister } from "./register";
import type {
  ActionDraft,
  ActionParams,
  ActionStatus,
  Address,
  ClaimReceipt,
  CorporateAction,
  Evidence,
  Instrument,
  LedgerSource,
  MarketEvent,
  MarketEventName,
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
}

export type ExecutorOp = keyof MarketsExecutor;
export const EXECUTOR_OPS: ExecutorOp[] = ["announce", "lockRecord", "postSnapshot", "fund", "pay", "claim", "vote", "settle"];

const ZERO = BigInt(0);
/** i64::MAX (a redemption lock with no end) shown as a far date. */
const FAR_FUTURE = 253_402_300_799;
const POLL_MS = 10_000;
const CLOCK_MS = 30_000;

const num = (v: { toString(): string } | number | bigint) => {
  const b = typeof v === "bigint" ? v : BigInt(v.toString());
  return b > BigInt(FAR_FUTURE) ? FAR_FUTURE : Number(b);
};
const isZero = (bytes: number[]) => bytes.every((b) => b === 0);

const STAGE: Record<ProgramActionStatus, number> = { Announced: 0, RecordLocked: 1, SnapshotPosted: 2, Funded: 3, Settling: 4, Settled: 5, Cancelled: -1 };

function short(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
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
  private readonly histories = new Map<string, InstrumentHistory>();
  private readonly known = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly labels: Map<string, DevnetMarketsConfig["directory"][number]>;
  private clockOffset = 0;
  private clockAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    readonly config: DevnetMarketsConfig,
    private readonly executor: MarketsExecutor | null,
    private readonly options: DevnetLedgerOptions = {},
  ) {
    this.connection = options.connection ?? new Connection(config.rpcUrl, "confirmed");
    this.client = MarketsClient.fromConnection(this.connection);
    if (this.client.programId.toBase58() !== config.programId) throw new Error(`Program id mismatch: IDL ${this.client.programId.toBase58()} vs config ${config.programId}`);
    this.labels = new Map(config.directory.map((d) => [d.address, d]));
    this.source = { cluster: "devnet", kind: "chain", label: config.writable ? "Solana devnet" : "Solana devnet · read-only" };
  }

  // ---- plumbing -----------------------------------------------------------------------------------

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && this.options.poll !== false && typeof window !== "undefined") this.startPolling();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopPolling();
    };
  }

  private startPolling() {
    void this.syncClock();
    this.timers.push(
      setInterval(() => void this.poll(), POLL_MS),
      setInterval(() => {
        void this.syncClock().then(() => this.notify());
      }, CLOCK_MS),
    );
  }

  private stopPolling() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async poll() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const changed = await Promise.all([...this.histories.values()].map((h) => h.refresh()));
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

  private async syncClock() {
    try {
      const slot = await this.connection.getSlot("confirmed");
      const t = await this.connection.getBlockTime(slot);
      if (t) {
        this.clockOffset = t - Date.now() / 1000;
        this.clockAt = Date.now();
      }
    } catch {
      // keep the previous offset
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

  now() {
    if (this.clockAt === 0 && typeof window !== "undefined") void this.syncClock().then(() => this.notify());
    if (this.clockAt === 0) this.clockAt = -1;
    return Math.floor(Date.now() / 1000 + this.clockOffset);
  }

  /** Cluster time read now (server-side checks). */
  async clusterNow() {
    await this.syncClock();
    return Math.floor(Date.now() / 1000 + this.clockOffset);
  }

  // ---- program data -----------------------------------------------------------------------------

  async instrumentRef(address: PublicKey): Promise<InstrumentRef> {
    return this.cache.get(`iref:${address.toBase58()}`, async () => {
      const ref = await this.client.fetchInstrument(address);
      if (!ref) throw new Error("Instrument not found");
      return ref;
    });
  }

  async actionRef(actionId: Address): Promise<ActionRef | null> {
    return this.cache.get(`aref:${actionId}`, async () => {
      let key: PublicKey;
      try {
        key = new PublicKey(actionId);
      } catch {
        return null;
      }
      return this.client.fetchAction(key);
    });
  }

  /** The instrument's history, refreshed once per cache generation. */
  async history(ref: InstrumentRef): Promise<InstrumentHistory> {
    const key = ref.address.toBase58();
    let h = this.histories.get(key);
    if (!h) {
      h = new InstrumentHistory(this.connection as unknown as HistoryConnection, this.client, ref.address, ref.account.mint);
      this.histories.set(key, h);
    }
    const history = h;
    await this.cache.get(`history:${key}`, () => history.refresh());
    return history;
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
      settlementSymbol: this.config.settlementSymbol,
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

  private terms(history: InstrumentHistory, action: string): { json: string; doc: TermsDocument; signature: string } | null {
    for (const { tx, event } of history.events()) {
      if (event.name !== "actionAnnounced" || event.data.action.toBase58() !== action) continue;
      for (const memo of tx.memos) {
        const t = parseTermsMemo(memo);
        if (t) return { ...t, signature: tx.signature };
      }
    }
    return null;
  }

  private transitions(history: InstrumentHistory, action: string): StatusTransition[] {
    const out: StatusTransition[] = [];
    const push = (status: ActionStatus, tx: HistoryTx) => {
      if (!out.some((t) => t.status === status)) out.push({ status, ts: tx.blockTime ?? 0, slot: tx.slot, signature: tx.signature });
    };
    for (const { tx, event } of history.events()) {
      const d = event.data as { action?: PublicKey };
      if (!d.action || d.action.toBase58() !== action) continue;
      switch (event.name) {
        case "actionAnnounced":
          push("Announced", tx);
          break;
        case "recordLocked":
          push("RecordLocked", tx);
          break;
        case "snapshotPosted":
          push("SnapshotPosted", tx);
          break;
        case "actionFunded":
          if (event.data.fullyFunded) push("Funded", tx);
          break;
        case "entitlementPaid":
        case "voteCast":
          push("Settling", tx);
          break;
        case "actionSettled":
          push("Settled", tx);
          break;
        case "actionCancelled":
          push("Cancelled", tx);
          break;
      }
    }
    return out;
  }

  private mapAction(inst: InstrumentRef, ref: ActionRef, history: InstrumentHistory | null): CorporateAction {
    const a = ref.account;
    const id = ref.address.toBase58();
    const kind = enumName<ProgramActionKind>(a.kind);
    const status = enumName<ProgramActionStatus>(a.status);
    const stage = STAGE[status];
    const terms = history ? this.terms(history, id) : null;
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
    const posted = stage >= STAGE.SnapshotPosted || (status === "Cancelled" && !isZero(a.merkleRoot));
    const locked = stage >= STAGE.RecordLocked || (status === "Cancelled" && toBigInt(a.recordSlot) > ZERO);
    const pays = kind !== "Vote";
    const winning = a.winningOption as number | null;
    return {
      id,
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
      vault: pays ? pda.vault(ref.address, this.client.programId).toBase58() : null,
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
      winningOption: winning ?? null,
      transitions: history ? this.transitions(history, id) : [],
    };
  }

  // ---- reads ------------------------------------------------------------------------------------

  async listInstruments(): Promise<Instrument[]> {
    return this.cache.get("instruments", async () => {
      let refs: InstrumentRef[];
      if (this.config.mints.length) {
        const fetched = await Promise.all(this.config.mints.map((m) => this.client.fetchInstrumentByMint(new PublicKey(m))));
        refs = fetched.filter((r): r is InstrumentRef => r != null);
      } else {
        refs = await this.client.listInstruments(this.config.issuer ? new PublicKey(this.config.issuer) : undefined);
        refs.sort((x, y) => Number(toBigInt(y.account.createdTs) - toBigInt(x.account.createdTs)));
      }
      const listed = new Set(refs.map((r) => r.address.toBase58()));
      for (const extra of this.known) {
        if (listed.has(extra)) continue;
        const ref = await this.client.fetchInstrument(new PublicKey(extra));
        if (ref) refs.push(ref);
      }
      return refs.map((r) => this.mapInstrument(r));
    });
  }

  async getInstrument(mint: Address) {
    return this.cache.get(`instrument:${mint}`, async () => {
      const ref = await this.client.fetchInstrumentByMint(new PublicKey(mint));
      return ref ? this.mapInstrument(ref) : null;
    });
  }

  private async instrumentByMint(mint: Address) {
    return this.instrumentRef(pda.instrument(new PublicKey(mint), this.client.programId));
  }

  async listActions(mint: Address) {
    return this.cache.get(`actions:${mint}`, async () => {
      const inst = await this.instrumentByMint(mint);
      const [refs, history] = await Promise.all([this.client.listActions(inst), this.history(inst)]);
      return refs.map((r) => this.mapAction(inst, r, history)).sort((a, b) => b.seq - a.seq);
    });
  }

  async getAction(actionId: Address) {
    return this.cache.get(`action:${actionId}`, async () => {
      const ref = await this.actionRef(actionId);
      if (!ref) return null;
      const inst = await this.instrumentRef(ref.account.instrument);
      const addr = inst.address.toBase58();
      if (!this.known.has(addr)) {
        this.known.add(addr);
        this.cache.drop("instruments");
      }
      const history = await this.history(inst);
      return this.mapAction(inst, ref, history);
    });
  }

  async getRegister(mint: Address): Promise<Register> {
    return this.cache.get(`register:${mint}`, async () => {
      const inst = await this.instrumentByMint(mint);
      const history = await this.history(inst);
      const candidates = [...new Set([...history.owners(), ...this.config.directory.map((d) => d.address)])].map((a) => new PublicKey(a));
      let holdings, slot, supply;
      try {
        const read = await readRegister(this.connection, inst.account.mint, { candidates });
        ({ holdings, slot, supply } = read);
      } catch {
        // A holder outside the indexed history (should not happen): fall back to the replay.
        const replay = history.registerAt();
        holdings = replay.holdings;
        slot = history.txs.at(-1)?.slot ?? 0;
        supply = toBigInt(inst.account.issuedUnits) - toBigInt(inst.account.redeemedUnits);
      }
      return {
        mint,
        slot,
        ts: this.now(),
        supply,
        entries: holdings.map((h) => {
          const d = this.labels.get(h.holder);
          return { ...h, label: d?.label, custody: d?.custody ?? "self" };
        }),
      };
    });
  }

  private async actionContext(actionId: Address) {
    const ref = await this.actionRef(actionId);
    if (!ref) throw new Error("Corporate action not found");
    const inst = await this.instrumentRef(ref.account.instrument);
    return { ref, inst, history: await this.history(inst) };
  }

  private snapshotTx(history: InstrumentHistory, actionId: string) {
    return history.events().find(({ event }) => event.name === "snapshotPosted" && event.data.action.toBase58() === actionId)?.tx ?? null;
  }

  async getSnapshot(actionId: Address): Promise<PublishedSnapshot | null> {
    return this.cache.get(`snapshot:${actionId}`, async () => {
      const { ref, inst, history } = await this.actionContext(actionId);
      const tx = this.snapshotTx(history, actionId);
      if (!tx) return null;
      for (const memo of tx.memos) {
        const parsed = parseSnapshotMemo(memo);
        if (!parsed) continue;
        const ctx = { instrument: inst.address.toBase58(), mint: inst.account.mint.toBase58(), action: actionId, recordTs: num(ref.account.recordTs) };
        if ("holdings" in parsed) return snapshotFromMemo(ctx, parsed.slot, parsed.holdings);
        const chunks: string[] = [];
        for (const sig of parsed.parts) {
          const part = (await memosOf(this.connection, sig)).map(parseSnapshotPart).find((p) => p && p.action === actionId);
          if (!part) throw new Error(`Snapshot part ${short(sig)} is missing`);
          chunks[part.index] = part.chunk;
        }
        return snapshotFromMemo(ctx, parsed.slot, decodeHoldings(chunks.join(",")));
      }
      return null;
    });
  }

  async snapshotSource(actionId: Address): Promise<Evidence | null> {
    const { history } = await this.actionContext(actionId);
    const tx = this.snapshotTx(history, actionId);
    return tx ? { label: "Snapshot published in the post_snapshot memo", value: tx.signature, signature: tx.signature } : null;
  }

  async termsDocument(actionId: Address) {
    const { history } = await this.actionContext(actionId);
    const t = this.terms(history, actionId);
    return t ? { text: t.json, signature: t.signature } : null;
  }

  async registerAt(mint: Address, slot: number) {
    const inst = await this.instrumentByMint(mint);
    return (await this.history(inst)).registerAt(slot);
  }

  private paymentSignatures(history: InstrumentHistory, actionId: string, name: "entitlementPaid" | "voteCast") {
    const out = new Map<string, string>();
    for (const { tx, event } of history.events()) {
      if (event.name === name && event.data.action.toBase58() === actionId) out.set(event.data.holder.toBase58(), tx.signature);
    }
    return out;
  }

  async listReceipts(actionId: Address): Promise<ClaimReceipt[]> {
    return this.cache.get(`receipts:${actionId}`, async () => {
      const { history } = await this.actionContext(actionId);
      const sigs = this.paymentSignatures(history, actionId, "entitlementPaid");
      const rows = await this.client.listReceipts(new PublicKey(actionId));
      return rows.map(({ address, account: r }) => ({
        address: address.toBase58(),
        action: actionId,
        holder: r.holder.toBase58(),
        units: toBigInt(r.units),
        amount: toBigInt(r.amount),
        burnedUnits: toBigInt(r.burnedUnits),
        mode: enumName(r.mode) === "Push" ? ("push" as const) : ("claim" as const),
        slot: num(r.slot),
        ts: num(r.ts),
        signature: sigs.get(r.holder.toBase58()) ?? "",
      }));
    });
  }

  async listVotes(actionId: Address): Promise<VoteRecord[]> {
    return this.cache.get(`votes:${actionId}`, async () => {
      const { history } = await this.actionContext(actionId);
      const sigs = this.paymentSignatures(history, actionId, "voteCast");
      const rows = await this.client.listVotes(new PublicKey(actionId));
      return rows.map(({ address, account: v }) => ({
        address: address.toBase58(),
        action: actionId,
        holder: v.holder.toBase58(),
        choice: v.choice,
        weight: toBigInt(v.weight),
        slot: num(v.slot),
        ts: num(v.ts),
        signature: sigs.get(v.holder.toBase58()) ?? "",
      }));
    });
  }

  async listEvents(mint: Address): Promise<MarketEvent[]> {
    return this.cache.get(`events:${mint}`, async () => {
      const inst = await this.instrumentByMint(mint);
      const history = await this.history(inst);
      const instrument = this.mapInstrument(inst);
      const seqs = new Map<string, number>();
      const titles = new Map<string, string>();
      const out: MarketEvent[] = [];
      const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
      for (const { tx, event } of history.events()) {
        const e = describeEvent(event, { seqs, titles, money, symbol: instrument.symbol, label: (a) => this.labels.get(a)?.label ?? short(a), terms: (a) => this.terms(history, a)?.doc ?? null });
        if (e) out.push({ ...e, slot: tx.slot, ts: tx.blockTime ?? 0, signature: tx.signature });
      }
      return out.sort((a, b) => b.slot - a.slot || b.ts - a.ts);
    });
  }

  // ---- writes -----------------------------------------------------------------------------------

  private async write<T extends TxResult>(run: (e: MarketsExecutor) => Promise<T>): Promise<T> {
    if (!this.executor) throw new Error("This console is read-only: the server has no issuer key configured.");
    const result = await run(this.executor);
    // The browser's RPC may trail the server's by a slot or two; refresh now and again shortly.
    this.changed();
    if (typeof window !== "undefined") setTimeout(() => void this.poll(), 2_500);
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
}

type EventContext = {
  seqs: Map<string, number>;
  titles: Map<string, string>;
  money: (v: bigint) => string;
  symbol: string;
  label: (address: string) => string;
  terms: (action: string) => TermsDocument | null;
};

/** Program event → console log row (without slot / ts / signature). */
export function describeEvent(event: MarketsEvent, ctx: EventContext): Omit<MarketEvent, "slot" | "ts" | "signature"> | null {
  const base = (name: MarketEventName, action: string | null, rest: Partial<Omit<MarketEvent, "name" | "action" | "actionSeq">> & { detail: string }) => ({
    name,
    action,
    actionSeq: action ? (ctx.seqs.get(action) ?? null) : null,
    holder: rest.holder ?? null,
    amount: rest.amount ?? null,
    units: rest.units ?? null,
    detail: rest.detail,
  });
  const d = event.data as Record<string, unknown> & { action?: PublicKey };
  const action = d.action ? d.action.toBase58() : null;
  const title = (a: string | null) => (a ? (ctx.titles.get(a) ?? "Action") : "");
  switch (event.name) {
    case "instrumentCreated":
      return base("InstrumentCreated", null, { detail: `${ctx.symbol} created · face ${ctx.money(toBigInt(event.data.faceValue))}, ${event.data.couponBps / 100}% coupon` });
    case "unitsIssued":
      return base("UnitsIssued", null, { holder: event.data.holder.toBase58(), units: toBigInt(event.data.units), detail: `${toBigInt(event.data.units)} units issued to ${ctx.label(event.data.holder.toBase58())}` });
    case "actionAnnounced": {
      const a = event.data.action.toBase58();
      ctx.seqs.set(a, num(event.data.id) + 1);
      const t = ctx.terms(a);
      ctx.titles.set(a, t?.title ?? enumName(event.data.kind));
      return base("ActionAnnounced", a, { detail: `${title(a)} announced · per unit ${ctx.money(toBigInt(event.data.amountPerUnit))}` });
    }
    case "recordLocked":
      return base("RecordLocked", action, { units: toBigInt(event.data.recordSupply), detail: `${title(action)}: register pinned at slot ${toBigInt(event.data.recordSlot)} · ${toBigInt(event.data.recordSupply)} units` });
    case "snapshotPosted":
      return base("SnapshotPosted", action, {
        units: toBigInt(event.data.totalUnits),
        amount: toBigInt(event.data.totalEntitlement),
        detail: `${title(action)}: ${event.data.holderCount} holders · root ${hex32(event.data.merkleRoot).slice(0, 10)}…`,
      });
    case "actionFunded":
      return base("ActionFunded", action, { amount: toBigInt(event.data.amount), detail: `${title(action)}: issuer deposited ${ctx.money(toBigInt(event.data.amount))}${event.data.fullyFunded ? " · fully funded" : ""}` });
    case "entitlementPaid": {
      const holder = event.data.holder.toBase58();
      const burned = toBigInt(event.data.burnedUnits);
      const push = enumName(event.data.mode) === "Push";
      return base(burned > ZERO ? "UnitsRedeemed" : "EntitlementPaid", action, {
        holder,
        amount: toBigInt(event.data.amount),
        units: burned > ZERO ? burned : toBigInt(event.data.units),
        detail: `${ctx.money(toBigInt(event.data.amount))} ${push ? "paid by the paying agent to" : "claimed by"} ${ctx.label(holder)}${burned > ZERO ? ` · ${burned} units burned` : ""}`,
      });
    }
    case "voteCast": {
      const holder = event.data.holder.toBase58();
      const options = action ? (ctx.terms(action)?.options ?? []) : [];
      return base("VoteCast", action, { holder, units: toBigInt(event.data.weight), detail: `${ctx.label(holder)} · ${toBigInt(event.data.weight)} units for “${options[event.data.choice] ?? `option ${event.data.choice + 1}`}”` });
    }
    case "actionSettled": {
      const options = action ? (ctx.terms(action)?.options ?? []) : [];
      const swept = toBigInt(event.data.sweptAmount);
      const w = event.data.winningOption as number | null;
      return base("ActionSettled", action, {
        amount: toBigInt(event.data.paidAmount),
        detail:
          enumName(event.data.kind) === "Vote"
            ? `${title(action)} closed · ${w == null ? "no majority" : `“${options[w] ?? `option ${w + 1}`}” wins`}`
            : `${title(action)} settled · ${ctx.money(toBigInt(event.data.paidAmount))} to ${event.data.paidCount} holders${swept > ZERO ? ` · ${ctx.money(swept)} swept to the issuer` : ""}`,
      });
    }
    case "actionCancelled":
      return base("ActionCancelled", action, { amount: toBigInt(event.data.refundedAmount), detail: `${title(action)} cancelled` });
    case "instrumentMatured":
      return base("InstrumentMatured", action, { detail: "Final redemption fully funded · instrument matured" });
    case "instrumentRedeemed":
      return base("InstrumentRedeemed", action, { detail: "Every unit redeemed · instrument closed" });
    default:
      return null;
  }
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
