import bs58 from "bs58";
import { withDerivedViews } from "./derive";
import { formatDateTime, formatSettlement } from "./format";
import { actionTitle } from "./lifecycle";
import { holderEntitlement, isPaymentAction, isRedemption, perUnitAmount, programTotal } from "./math";
import type {
  ActionDraft,
  ActionStatus,
  Address,
  ClaimReceipt,
  CorporateAction,
  Instrument,
  LedgerSource,
  MarketEvent,
  MarketsLedger,
  MarketsService,
  PublishedSnapshot,
  Register,
  RegisterEntry,
  Signature,
  SimulationControls,
  TxResult,
  UnixTs,
  VoteRecord,
} from "./service";
import { buildMerkleTree, canonicalHoldings, snapshotHash } from "./snapshot";

/**
 * A simulated `plain_markets` ledger with the program's rules, for building the UI before the
 * real client lands. Deterministic: the same seed produces the same addresses, signatures,
 * roots and hashes. State persists to localStorage (when given) so the console and the
 * verifier, opened in different tabs, see the same ledger.
 *
 * Seed: one 10% 2-year semi-annual bond (1,000 units × $1,000 face), five holders,
 * coupon 1 settled, a bondholder vote open, coupon 2 snapshotted (awaiting funding) and a
 * 25% partial redemption announced.
 */

export class MarketsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MarketsError";
  }
}

type State = {
  version: number;
  clock: UnixTs;
  counter: number;
  instrument: Instrument;
  register: RegisterEntry[];
  actions: CorporateAction[];
  snapshots: Record<Address, PublishedSnapshot>;
  receipts: ClaimReceipt[];
  votes: VoteRecord[];
  events: MarketEvent[];
};

const STATE_VERSION = 4;
const STORAGE_KEY = "plain-markets-simulated-ledger";
const ZERO = BigInt(0);
const MICRO = BigInt(1_000_000);

export const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000);
export const SIM_START = ts("2026-10-13T09:00:00Z");
const ISSUE_TS = ts("2025-10-15T12:00:00Z");
const SLOT_AT_ISSUE = 372_418_000;

// ---------- deterministic identities ----------

function seedOf(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function bytes(label: string, n: number) {
  let a = seedOf(label);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

export const simAddress = (label: string): Address => bs58.encode(bytes(`address:${label}`, 32));
const simSignature = (label: string): Signature => bs58.encode(bytes(`signature:${label}`, 64));
const slotAt = (t: UnixTs) => SLOT_AT_ISSUE + Math.floor((t - ISSUE_TS) * 2.5);

const PROGRAM_ID = simAddress("program:plain_markets");
const MINT = simAddress("mint:PTB27");

export const SIM_HOLDERS: RegisterEntry[] = [
  { holder: simAddress("holder:pension"), units: BigInt(400), label: "Pension fund · custody account", custody: "custodian" },
  { holder: simAddress("holder:asset-manager"), units: BigInt(250), label: "Asset manager", custody: "self" },
  { holder: simAddress("holder:broker"), units: BigInt(180), label: "Broker omnibus account", custody: "custodian" },
  { holder: simAddress("holder:retail-1"), units: BigInt(120), label: "Retail investor · Plain smart wallet", custody: "smart-wallet", plainInvestor: true },
  { holder: simAddress("holder:retail-2"), units: BigInt(50), label: "Retail investor · Plain smart wallet", custody: "smart-wallet", plainInvestor: true },
];

function initialState(): State {
  const instrument: Instrument = {
    mint: MINT,
    address: simAddress(`instrument:${MINT}`),
    programId: PROGRAM_ID,
    issuer: simAddress("issuer"),
    payingAgent: simAddress("paying-agent"),
    settlementMint: simAddress("mint:tUSD"),
    settlementSymbol: "USD",
    settlementDecimals: 6,
    name: "Plain Test Bond 10% 2027",
    symbol: "PTB27",
    faceValue: BigInt(1_000) * MICRO,
    couponBps: 1_000,
    frequency: 2,
    issueTs: ISSUE_TS,
    maturityTs: ts("2027-10-15T12:00:00Z"),
    status: "Active",
    lockFrom: 0,
    lockUntil: 0,
    allowlist: true,
    issuedUnits: BigInt(1_000),
    supply: BigInt(1_000),
    redeemedUnits: ZERO,
    actionCount: 0,
  };
  return {
    version: STATE_VERSION,
    clock: ISSUE_TS,
    counter: 0,
    instrument,
    register: SIM_HOLDERS.map((h) => ({ ...h })),
    actions: [],
    snapshots: {},
    receipts: [],
    votes: [],
    events: [
      {
        name: "InstrumentCreated",
        action: null,
        actionSeq: null,
        holder: null,
        amount: null,
        units: instrument.issuedUnits,
        detail: `Issued 1,000 units of ${instrument.symbol} at $1,000 face to 5 allowlisted holders`,
        slot: slotAt(ISSUE_TS),
        ts: ISSUE_TS,
        signature: simSignature("instrument-created"),
      },
    ],
  };
}

// ---------- persistence ----------

function serialize(state: State) {
  return JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? { $n: v.toString() } : v));
}

function deserialize(text: string): State | null {
  try {
    const parsed = JSON.parse(text, (_k, v) => (v && typeof v === "object" && typeof v.$n === "string" && Object.keys(v).length === 1 ? BigInt(v.$n) : v));
    return parsed?.version === STATE_VERSION ? (parsed as State) : null;
  } catch {
    return null;
  }
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type SimulatedLedgerOptions = { storage?: StorageLike | null; latencyMs?: number };

// ---------- the ledger ----------

class SimulatedLedger implements MarketsLedger {
  readonly source: LedgerSource = { cluster: "devnet", kind: "simulated", label: "Simulated ledger" };
  readonly simulation: SimulationControls;
  private state: State | null = null;
  private loading: Promise<State> | null = null;
  private listeners = new Set<() => void>();
  private readonly storage: StorageLike | null;
  private readonly latency: number;

  constructor(options: SimulatedLedgerOptions = {}) {
    this.storage = options.storage ?? null;
    this.latency = options.latencyMs ?? 0;
    this.simulation = {
      advanceTo: async (t) => {
        const s = await this.load();
        if (t <= s.clock) throw new MarketsError("ClockBackwards", "The ledger clock only moves forward.");
        s.clock = t;
        this.commit();
      },
      reset: async () => {
        this.storage?.removeItem(STORAGE_KEY);
        this.state = null;
        this.loading = null;
        await this.load();
        this.commit();
      },
    };
    if (typeof window !== "undefined" && this.storage) {
      window.addEventListener("storage", (e) => {
        if (e.key !== STORAGE_KEY) return;
        this.state = e.newValue ? deserialize(e.newValue) : null;
        this.loading = null;
        this.notify();
      });
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  explorerTxUrl() {
    return null;
  }

  explorerAddressUrl() {
    return null;
  }

  now() {
    return this.state?.clock ?? SIM_START;
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  private commit() {
    if (this.state && this.storage) {
      try {
        this.storage.setItem(STORAGE_KEY, serialize(this.state));
      } catch {
        // Storage full or blocked: keep the in-memory ledger.
      }
    }
    this.notify();
  }

  private async wait(factor = 1) {
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency * factor));
  }

  private async load(): Promise<State> {
    if (this.state) return this.state;
    if (!this.loading) {
      this.loading = (async () => {
        let stored: State | null = null;
        try {
          const raw = this.storage?.getItem(STORAGE_KEY);
          stored = raw ? deserialize(raw) : null;
        } catch {
          stored = null;
        }
        this.state = stored ?? (await seed());
        return this.state;
      })();
    }
    return this.loading;
  }

  // ----- reads -----

  async listInstruments() {
    const s = await this.load();
    await this.wait(0.3);
    return [structuredClone(s.instrument)];
  }

  async getInstrument(mint: Address) {
    const s = await this.load();
    await this.wait(0.3);
    return s.instrument.mint === mint ? structuredClone(s.instrument) : null;
  }

  async listActions(mint: Address) {
    const s = await this.load();
    await this.wait(0.3);
    return s.instrument.mint === mint ? structuredClone(s.actions).sort((a, b) => b.seq - a.seq) : [];
  }

  async getAction(actionId: Address) {
    const s = await this.load();
    await this.wait(0.3);
    const a = s.actions.find((x) => x.id === actionId);
    return a ? structuredClone(a) : null;
  }

  async getRegister(mint: Address): Promise<Register> {
    const s = await this.load();
    await this.wait(0.3);
    if (s.instrument.mint !== mint) throw new MarketsError("UnknownMint", "Unknown bond mint.");
    return {
      mint,
      slot: slotAt(s.clock),
      ts: s.clock,
      supply: s.instrument.supply,
      entries: structuredClone(s.register.filter((e) => e.units > ZERO)),
    };
  }

  async getSnapshot(actionId: Address) {
    const s = await this.load();
    await this.wait(0.5);
    const snap = s.snapshots[actionId];
    return snap ? structuredClone(snap) : null;
  }

  async listReceipts(actionId: Address) {
    const s = await this.load();
    await this.wait(0.3);
    return structuredClone(s.receipts.filter((r) => r.action === actionId));
  }

  async listVotes(actionId: Address) {
    const s = await this.load();
    await this.wait(0.3);
    return structuredClone(s.votes.filter((v) => v.action === actionId));
  }

  async listEvents(mint: Address) {
    const s = await this.load();
    await this.wait(0.3);
    return s.instrument.mint === mint ? structuredClone(s.events).sort((a, b) => b.slot - a.slot || b.ts - a.ts) : [];
  }

  // ----- writes -----

  private async write<T>(fn: (s: State) => Promise<T> | T): Promise<T> {
    const s = await this.load();
    await this.wait();
    const result = await fn(s);
    this.commit();
    return result;
  }

  announce(mint: Address, draft: ActionDraft) {
    return this.write((s) => opAnnounce(s, mint, draft));
  }
  lockRecord(actionId: Address) {
    return this.write((s) => opLock(s, actionId));
  }
  postSnapshot(actionId: Address) {
    return this.write((s) => opSnapshot(s, actionId));
  }
  fund(actionId: Address) {
    return this.write((s) => opFund(s, actionId));
  }
  pay(actionId: Address, holder: Address) {
    return this.write((s) => opPay(s, actionId, holder, "push"));
  }
  claim(actionId: Address, holder: Address) {
    return this.write((s) => opPay(s, actionId, holder, "claim"));
  }
  vote(actionId: Address, holder: Address, choice: number) {
    return this.write((s) => opVote(s, actionId, holder, choice));
  }
  settle(actionId: Address) {
    return this.write((s) => opSettle(s, actionId));
  }
}

// ---------- program rules ----------

function tx(s: State, label: string): TxResult {
  s.counter += 1;
  s.clock += 2; // each confirmed transaction advances the cluster a little
  return { signature: simSignature(`${s.counter}:${label}`), slot: slotAt(s.clock), ts: s.clock };
}

function findAction(s: State, id: Address) {
  const a = s.actions.find((x) => x.id === id);
  if (!a) throw new MarketsError("UnknownAction", "Corporate action not found.");
  return a;
}

function expectStatus(a: CorporateAction, allowed: ActionStatus[], verb: string) {
  if (!allowed.includes(a.status)) throw new MarketsError("InvalidStatus", `Cannot ${verb} while the action is ${a.status}.`);
}

function transition(a: CorporateAction, status: ActionStatus, r: TxResult) {
  if (a.status === status && a.transitions.length) return;
  a.status = status;
  a.transitions.push({ status, ts: r.ts, slot: r.slot, signature: r.signature });
}

function event(s: State, r: TxResult, e: Omit<MarketEvent, "slot" | "ts" | "signature">) {
  s.events.push({ ...e, slot: r.slot, ts: r.ts, signature: r.signature });
}

function money(v: bigint) {
  return formatSettlement(v);
}

function opAnnounce(s: State, mint: Address, d: ActionDraft) {
  const i = s.instrument;
  if (i.mint !== mint) throw new MarketsError("UnknownMint", "Unknown bond mint.");
  if (i.status !== "Active") throw new MarketsError("InstrumentInactive", "The instrument is no longer active.");
  if (d.kind !== d.params.kind) throw new MarketsError("InvalidParams", "Action kind and parameters disagree.");
  if (d.recordTs <= s.clock) throw new MarketsError("RecordDateInPast", "The record date must be in the future.");
  if (d.paymentTs <= d.recordTs) throw new MarketsError("PaymentBeforeRecord", "The payment date must come after the record date.");
  if (d.claimDeadlineTs < d.paymentTs) throw new MarketsError("DeadlineBeforePayment", "The claim deadline cannot precede the payment date.");
  const p = d.params;
  if (p.kind === "Coupon" && (p.couponBps <= 0 || p.couponBps > 5_000)) throw new MarketsError("InvalidParams", "Coupon rate must be between 0 and 50%.");
  if (p.kind === "PartialRedemption" && (p.redeemBps <= 0 || p.redeemBps >= 10_000)) throw new MarketsError("InvalidParams", "A partial redemption must redeem between 0% and 100% of each holding.");
  if ((p.kind === "PartialRedemption" || p.kind === "FinalRedemption") && (p.priceBps < 5_000 || p.priceBps > 15_000)) throw new MarketsError("InvalidParams", "Redemption price must be between 50% and 150% of face.");
  if (p.kind === "FinalRedemption" && d.paymentTs < i.maturityTs) throw new MarketsError("BeforeMaturity", `Final redemption pays on or after maturity (${formatDateTime(i.maturityTs)}).`);
  if (p.kind === "Vote" && (p.options.length < 2 || p.options.length > 4 || !p.question.trim())) throw new MarketsError("InvalidParams", "A vote needs a question and two to four options.");
  const r = tx(s, "announce");
  i.actionCount += 1;
  const seq = i.actionCount;
  const id = simAddress(`action:${i.address}:${seq}`);
  const action: CorporateAction = {
    id,
    seq,
    instrument: i.address,
    kind: d.kind,
    params: structuredClone(d.params),
    status: "Announced",
    title: actionTitle(i, d),
    announcedTs: r.ts,
    recordTs: d.recordTs,
    paymentTs: d.paymentTs,
    claimDeadlineTs: d.claimDeadlineTs,
    vault: isPaymentAction(d.params) ? simAddress(`vault:${id}`) : null,
    amountPerUnit: perUnitAmount(i, d.params),
    termsHash: Array.from(bytes(`terms:${id}`, 32), (b) => b.toString(16).padStart(2, "0")).join(""),
    recordSlot: null,
    totalRedeemUnits: null,
    merkleRoot: null,
    snapshotHash: null,
    snapshotSlot: null,
    totalUnits: null,
    supplyAtRecord: null,
    holderCount: null,
    totalEntitlement: null,
    fundedAmount: ZERO,
    paidAmount: ZERO,
    paidCount: 0,
    redeemedUnits: ZERO,
    sweptAmount: ZERO,
    tally: p.kind === "Vote" ? p.options.map(() => ZERO) : null,
    winningOption: null,
    transitions: [],
  };
  transition(action, "Announced", r);
  s.actions.push(action);
  event(s, r, { name: "ActionAnnounced", action: action.id, actionSeq: seq, holder: null, amount: null, units: null, detail: `${action.title} announced · record ${formatDateTime(d.recordTs)}` });
  return { ...r, actionId: action.id };
}

function opLock(s: State, id: Address) {
  const a = findAction(s, id);
  expectStatus(a, ["Announced"], "lock the register");
  if (s.clock < a.recordTs) throw new MarketsError("RecordDateNotReached", `The register can be locked from the record date, ${formatDateTime(a.recordTs)}.`);
  const r = tx(s, `lock:${a.seq}`);
  a.recordSlot = r.slot;
  a.supplyAtRecord = s.instrument.supply;
  if (s.instrument.lockUntil <= s.clock) s.instrument.lockFrom = a.recordTs;
  s.instrument.lockUntil = Math.max(s.instrument.lockUntil, a.paymentTs);
  transition(a, "RecordLocked", r);
  event(s, r, { name: "RecordLocked", action: a.id, actionSeq: a.seq, holder: null, amount: null, units: null, detail: `Transfers locked by the transfer hook until ${formatDateTime(s.instrument.lockUntil)}` });
  return r;
}

async function opSnapshot(s: State, id: Address) {
  const a = findAction(s, id);
  expectStatus(a, ["RecordLocked"], "post the snapshot");
  const r = tx(s, `snapshot:${a.seq}`);
  const snapshot: PublishedSnapshot = {
    version: 1,
    instrument: s.instrument.address,
    mint: s.instrument.mint,
    action: a.id,
    recordTs: a.recordTs,
    slot: r.slot,
    holdings: canonicalHoldings(s.register.map(({ holder, units }) => ({ holder, units }))),
  };
  const total = snapshot.holdings.reduce((n, h) => n + h.units, ZERO);
  if (total !== s.instrument.supply) throw new MarketsError("SupplyMismatch", "Snapshot units do not equal the bond supply.");
  const tree = await buildMerkleTree(a.id, snapshot.holdings);
  a.merkleRoot = tree.root;
  a.snapshotHash = await snapshotHash(snapshot);
  a.snapshotSlot = r.slot;
  a.totalUnits = total;
  a.supplyAtRecord = s.instrument.supply;
  a.holderCount = snapshot.holdings.length;
  a.totalRedeemUnits = snapshot.holdings.reduce((n, h) => n + holderEntitlement(s.instrument, a.params, h.units).redeemUnits, ZERO);
  a.totalEntitlement = programTotal(s.instrument, a.params, total, a.totalRedeemUnits);
  s.snapshots[a.id] = snapshot;
  transition(a, "SnapshotPosted", r);
  event(s, r, {
    name: "SnapshotPosted",
    action: a.id,
    actionSeq: a.seq,
    holder: null,
    amount: isPaymentAction(a.params) ? a.totalEntitlement : null,
    units: total,
    detail: `${a.holderCount} holders, ${total} units · root ${tree.root.slice(0, 10)}…`,
  });
  return r;
}

function opFund(s: State, id: Address) {
  const a = findAction(s, id);
  if (!isPaymentAction(a.params)) throw new MarketsError("NotPayable", "Votes do not need funding.");
  expectStatus(a, ["SnapshotPosted"], "fund");
  const r = tx(s, `fund:${a.seq}`);
  a.fundedAmount = a.totalEntitlement ?? ZERO;
  transition(a, "Funded", r);
  event(s, r, { name: "ActionFunded", action: a.id, actionSeq: a.seq, holder: null, amount: a.fundedAmount, units: null, detail: `Issuer deposited ${money(a.fundedAmount)} into the paying vault` });
  return r;
}

function opPay(s: State, id: Address, holder: Address, mode: "push" | "claim") {
  const a = findAction(s, id);
  if (!isPaymentAction(a.params)) throw new MarketsError("NotPayable", "Votes have no payment.");
  expectStatus(a, ["Funded", "Settling"], mode === "push" ? "pay" : "claim");
  if (s.clock < a.paymentTs) throw new MarketsError("PaymentDateNotReached", `Payments open on the payment date, ${formatDateTime(a.paymentTs)}.`);
  if (s.clock > a.claimDeadlineTs) throw new MarketsError("ClaimWindowClosed", "The claim deadline has passed.");
  const snap = s.snapshots[a.id];
  const leaf = snap?.holdings.find((h) => h.holder === holder);
  if (!leaf) throw new MarketsError("InvalidProof", "This wallet is not in the record-date snapshot.");
  if (s.receipts.some((x) => x.action === a.id && x.holder === holder)) throw new MarketsError("AlreadyPaid", "Already paid: a ClaimReceipt exists for this holder.");
  const e = holderEntitlement(s.instrument, a.params, leaf.units);
  if (e.amount === ZERO) throw new MarketsError("NothingOwed", "Nothing is owed to this holder after rounding.");
  if (a.paidAmount + e.amount > a.fundedAmount) throw new MarketsError("Underfunded", "The paying vault does not hold enough to pay this entitlement.");
  const r = tx(s, `${mode}:${a.seq}:${holder}`);
  a.paidAmount += e.amount;
  a.paidCount += 1;
  if (isRedemption(a.params)) {
    const entry = s.register.find((x) => x.holder === holder);
    if (entry) entry.units -= e.redeemUnits;
    s.instrument.supply -= e.redeemUnits;
    s.instrument.redeemedUnits += e.redeemUnits;
    a.redeemedUnits += e.redeemUnits;
  }
  s.receipts.push({ address: simAddress(`claim:${a.id}:${holder}`), action: a.id, holder, units: leaf.units, amount: e.amount, burnedUnits: e.redeemUnits, mode, slot: r.slot, ts: r.ts, signature: r.signature });
  transition(a, "Settling", r);
  event(s, r, {
    name: isRedemption(a.params) ? "UnitsRedeemed" : "EntitlementPaid",
    action: a.id,
    actionSeq: a.seq,
    holder,
    amount: e.amount,
    units: isRedemption(a.params) ? e.redeemUnits : leaf.units,
    detail: `${money(e.amount)} ${mode === "push" ? "paid by the paying agent" : "claimed by the holder"}${isRedemption(a.params) ? ` · ${e.redeemUnits} units burned` : ""}`,
  });
  if (s.instrument.supply === ZERO) s.instrument.status = "Redeemed";
  return r;
}

function opVote(s: State, id: Address, holder: Address, choice: number) {
  const a = findAction(s, id);
  if (a.params.kind !== "Vote") throw new MarketsError("NotAVote", "This action is not a vote.");
  expectStatus(a, ["SnapshotPosted", "Settling"], "vote");
  if (s.clock >= a.paymentTs) throw new MarketsError("VotingClosed", "Voting has closed.");
  if (choice < 0 || choice >= a.params.options.length) throw new MarketsError("InvalidChoice", "Unknown option.");
  const leaf = s.snapshots[a.id]?.holdings.find((h) => h.holder === holder);
  if (!leaf) throw new MarketsError("InvalidProof", "This wallet is not in the record-date snapshot.");
  if (s.votes.some((v) => v.action === a.id && v.holder === holder)) throw new MarketsError("AlreadyVoted", "This holder has already voted.");
  const r = tx(s, `vote:${a.seq}:${holder}`);
  s.votes.push({ address: simAddress(`vote:${a.id}:${holder}`), action: a.id, holder, choice, weight: leaf.units, slot: r.slot, ts: r.ts, signature: r.signature });
  a.tally![choice] += leaf.units;
  transition(a, "Settling", r);
  event(s, r, { name: "VoteCast", action: a.id, actionSeq: a.seq, holder, amount: null, units: leaf.units, detail: `${leaf.units} units for “${a.params.options[choice]}”` });
  return r;
}

function opSettle(s: State, id: Address) {
  const a = findAction(s, id);
  if (a.params.kind === "Vote") {
    expectStatus(a, ["SnapshotPosted", "Settling"], "close the vote");
    if (s.clock < a.paymentTs) throw new MarketsError("VotingOpen", `Voting closes ${formatDateTime(a.paymentTs)}.`);
    const r = tx(s, `settle:${a.seq}`);
    transition(a, "Settled", r);
    const tally = a.tally ?? [];
    const options = a.params.options;
    const winner = tally.reduce((best, t, i) => (t > tally[best] ? i : best), 0);
    a.winningOption = tally.filter((t) => t === tally[winner]).length === 1 ? winner : null;
    event(s, r, { name: "ActionSettled", action: a.id, actionSeq: a.seq, holder: null, amount: null, units: tally.reduce((n, t) => n + t, ZERO), detail: `Vote closed · “${options[winner]}” leads with ${tally[winner]} units` });
    return r;
  }
  expectStatus(a, ["Funded", "Settling"], "settle");
  const snap = s.snapshots[a.id];
  const owed = snap.holdings.filter((h) => holderEntitlement(s.instrument, a.params, h.units).amount > ZERO).length;
  if (a.paidCount < owed && s.clock < a.claimDeadlineTs) {
    throw new MarketsError("PaymentsOutstanding", `${owed - a.paidCount} holder(s) unpaid. Settle after paying everyone or after the claim deadline, ${formatDateTime(a.claimDeadlineTs)}.`);
  }
  const r = tx(s, `settle:${a.seq}`);
  const residue = a.fundedAmount - a.paidAmount;
  a.sweptAmount = residue;
  transition(a, "Settled", r);
  event(s, r, {
    name: "ActionSettled",
    action: a.id,
    actionSeq: a.seq,
    holder: null,
    amount: a.paidAmount,
    units: null,
    detail: `${money(a.paidAmount)} paid to ${a.paidCount} holders${residue > ZERO ? ` · ${money(residue)} returned to the issuer` : ""}`,
  });
  return r;
}

// ---------- seed ----------

async function seed(): Promise<State> {
  const s = initialState();
  const at = (iso: string) => {
    s.clock = Math.max(s.clock, ts(iso));
  };
  const mint = s.instrument.mint;
  const [pension, manager, broker, retail1, retail2] = SIM_HOLDERS.map((h) => h.holder);

  // Coupon 1 — fully settled.
  at("2026-03-25T09:00:00Z");
  const c1 = opAnnounce(s, mint, {
    kind: "Coupon",
    recordTs: ts("2026-04-08T12:00:00Z"),
    paymentTs: ts("2026-04-15T12:00:00Z"),
    claimDeadlineTs: ts("2026-07-14T12:00:00Z"),
    params: { kind: "Coupon", period: 1, couponBps: 1_000 },
  }).actionId;
  at("2026-04-08T12:00:00Z");
  opLock(s, c1);
  at("2026-04-08T12:05:00Z");
  await opSnapshot(s, c1);
  at("2026-04-14T10:00:00Z");
  opFund(s, c1);
  at("2026-04-15T12:00:30Z");
  for (const h of [pension, broker, retail1, retail2]) opPay(s, c1, h, "push");
  at("2026-04-16T08:41:00Z");
  opPay(s, c1, manager, "claim");
  at("2026-04-16T09:00:00Z");
  opSettle(s, c1);

  // Bondholder vote — open.
  at("2026-09-16T09:00:00Z");
  const v = opAnnounce(s, mint, {
    kind: "Vote",
    recordTs: ts("2026-09-30T12:00:00Z"),
    paymentTs: ts("2026-10-21T12:00:00Z"),
    claimDeadlineTs: ts("2026-10-21T12:00:00Z"),
    params: { kind: "Vote", question: "Extend the audited-report deadline to 150 days", options: ["For", "Against", "Abstain"] },
  }).actionId;

  // Coupon 2 — announced now, snapshotted later.
  at("2026-09-24T09:00:00Z");
  const c2 = opAnnounce(s, mint, {
    kind: "Coupon",
    recordTs: ts("2026-10-08T12:00:00Z"),
    paymentTs: ts("2026-10-15T12:00:00Z"),
    claimDeadlineTs: ts("2027-01-13T12:00:00Z"),
    params: { kind: "Coupon", period: 2, couponBps: 1_000 },
  }).actionId;

  at("2026-09-30T12:00:00Z");
  opLock(s, v);
  at("2026-09-30T12:05:00Z");
  await opSnapshot(s, v);
  at("2026-10-01T10:12:00Z");
  opVote(s, v, pension, 0);
  at("2026-10-02T15:47:00Z");
  opVote(s, v, manager, 1);

  at("2026-10-08T12:00:00Z");
  opLock(s, c2);
  at("2026-10-08T12:05:00Z");
  await opSnapshot(s, c2);
  at("2026-10-09T11:30:00Z");
  opVote(s, v, broker, 0);

  // Partial redemption — announced yesterday.
  at("2026-10-12T09:00:00Z");
  opAnnounce(s, mint, {
    kind: "PartialRedemption",
    recordTs: ts("2026-10-29T12:00:00Z"),
    paymentTs: ts("2026-11-05T12:00:00Z"),
    claimDeadlineTs: ts("2027-02-03T12:00:00Z"),
    params: { kind: "PartialRedemption", redeemBps: 2_500, priceBps: 10_000 },
  });

  s.clock = SIM_START;
  return s;
}

// ---------- factory ----------

export type SimulatedMarketsService = MarketsService & { readonly simulation: SimulationControls };

export function createSimulatedMarketsService(options: SimulatedLedgerOptions = {}): SimulatedMarketsService {
  return withDerivedViews(new SimulatedLedger(options)) as SimulatedMarketsService;
}

/** Address of the seeded bond mint. */
export const SIM_MINT = MINT;
