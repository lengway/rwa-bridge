/**
 * Plain Markets, investor side: the math and rules behind the "Bonds" section of the signed-in app.
 *
 * Pure and isomorphic. The server (`investor-server.ts`) reads the chain and feeds these helpers;
 * the browser only receives the JSON views built here (`InvestorOverview`, `BondDetail`), with
 * bigints as decimal strings.
 *
 * - Coupon schedule: periods of 12 / frequency months from the issue date, the last one ending at
 *   maturity (the same period count as `couponPeriods` in lifecycle.ts).
 * - Coupon per unit and per-unit rounding: `entitlements.ts`, i.e. exactly what the program pays.
 * - Accrued coupon: linear within the current period. An estimate; nothing accrues on-chain.
 * - Yield to maturity: the nominal annual yield, compounded `frequency` times a year, that
 *   discounts the remaining coupons and the face value back to the price.
 * - Allocation guard: the program's `issue` preconditions plus Plain's per-investor limits.
 */
import { couponPerUnit } from "./entitlements";
import type { Address, ClaimReceipt, CorporateAction, Instrument, PublishedSnapshot, Signature, UnixTs, VoteRecord } from "./service";

const ZERO = BigInt(0);
const YEAR = 365.25 * 86_400;

export type BondTerms = Pick<Instrument, "faceValue" | "couponBps" | "frequency" | "issueTs" | "maturityTs">;

// ---- schedule -------------------------------------------------------------------------------------

/** `ts` plus whole calendar months in UTC; the day clamps to the end of shorter months. */
export function addMonthsUtc(ts: UnixTs, months: number): UnixTs {
  const d = new Date(ts * 1000);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return Math.floor(target.getTime() / 1000);
}

/** Scheduled coupon dates, issue excluded, maturity included. */
export function couponSchedule(t: Pick<BondTerms, "issueTs" | "maturityTs" | "frequency">): UnixTs[] {
  if (!(t.frequency > 0) || t.maturityTs <= t.issueTs) return [];
  const count = Math.max(1, Math.round(((t.maturityTs - t.issueTs) / YEAR) * t.frequency));
  const months = 12 / t.frequency;
  const dates: UnixTs[] = [];
  for (let k = 1; k < count; k++) dates.push(Math.min(addMonthsUtc(t.issueTs, Math.round(k * months)), t.maturityTs));
  dates.push(t.maturityTs);
  return dates;
}

/** The coupon period containing `now`: [start, end). Null before issue or from maturity on. */
export function currentPeriod(t: Pick<BondTerms, "issueTs" | "maturityTs" | "frequency">, now: UnixTs) {
  if (now < t.issueTs || now >= t.maturityTs) return null;
  const dates = couponSchedule(t);
  let start = t.issueTs;
  for (let i = 0; i < dates.length; i++) {
    if (now < dates[i]) return { index: i + 1, start, end: dates[i] };
    start = dates[i];
  }
  return null;
}

/** Number of scheduled coupon dates already reached at `now`. */
export function periodsElapsed(t: Pick<BondTerms, "issueTs" | "maturityTs" | "frequency">, now: UnixTs) {
  return couponSchedule(t).filter((d) => d <= now).length;
}

/** Highest coupon period the issuer has announced (cancelled actions excluded); 0 when none. */
export function announcedCouponPeriods(actions: Pick<CorporateAction, "params" | "status">[]) {
  return actions.reduce((max, a) => (a.params.kind === "Coupon" && a.status !== "Cancelled" ? Math.max(max, a.params.period) : max), 0);
}

/**
 * The coupon period interest is accruing for: the first period not yet announced. Normally that is
 * the period containing `now`; when the issuer pays coupons ahead of the calendar, accrual waits for
 * the next period's window. Null once every coupon is announced.
 */
export function accrualPeriod(t: Pick<BondTerms, "issueTs" | "maturityTs" | "frequency">, now: UnixTs, announcedThrough = periodsElapsed(t, now)) {
  const dates = couponSchedule(t);
  const period = announcedThrough + 1;
  if (period > dates.length) return null;
  return { index: period, start: period === 1 ? t.issueTs : dates[period - 2], end: dates[period - 1] };
}

export type NextCoupon = {
  ts: UnixTs;
  /** "announced": a coupon action exists and is not paid yet; "scheduled": the terms' calendar, not announced. */
  source: "announced" | "scheduled";
  /** 1-based coupon period. */
  period: number;
  actionId: Address | null;
};

/** Next coupon payment: an announced coupon not yet paid, else the next unannounced scheduled date. */
export function nextCoupon(
  t: Pick<BondTerms, "issueTs" | "maturityTs" | "frequency">,
  now: UnixTs,
  actions: Pick<CorporateAction, "params" | "status" | "paymentTs" | "id">[] = [],
): NextCoupon | null {
  const pending = actions
    .filter((a) => a.params.kind === "Coupon" && a.status !== "Settled" && a.status !== "Cancelled" && a.paymentTs > now)
    .sort((a, b) => a.paymentTs - b.paymentTs)[0];
  const announced = actions.length ? announcedCouponPeriods(actions) : periodsElapsed(t, now);
  const scheduled = accrualPeriod(t, now, announced);
  if (pending && pending.params.kind === "Coupon" && (!scheduled || pending.paymentTs <= scheduled.end)) {
    return { ts: pending.paymentTs, source: "announced", period: pending.params.period, actionId: pending.id ?? null };
  }
  return scheduled && scheduled.end > now ? { ts: scheduled.end, source: "scheduled", period: scheduled.index, actionId: null } : null;
}

export function nextCouponDate(
  t: Pick<BondTerms, "issueTs" | "maturityTs" | "frequency">,
  now: UnixTs,
  actions: Pick<CorporateAction, "params" | "status" | "paymentTs">[] = [],
): UnixTs | null {
  return nextCoupon(t, now, actions.map((a) => ({ ...a, id: "" })))?.ts ?? null;
}

/** Coupon accrued on `units` in the accrual period, rounded down (estimate; nothing accrues on-chain). */
export function accruedCoupon(t: BondTerms, units: bigint, now: UnixTs, announcedThrough = periodsElapsed(t, now)): bigint {
  const period = accrualPeriod(t, now, announcedThrough);
  if (!period || units <= ZERO || now <= period.start) return ZERO;
  const perPeriod = couponPerUnit(t.faceValue, t.couponBps, t.frequency) * units;
  const length = BigInt(period.end - period.start);
  const elapsed = BigInt(Math.min(now, period.end) - period.start);
  return length > ZERO ? (perPeriod * elapsed) / length : ZERO;
}

/**
 * Yield to maturity for one unit bought at `price` (settlement base units) at `now`: the nominal
 * annual rate y, compounded `frequency` times a year, with
 * price = Σ coupon / (1 + y/f)^(f·t_i) + face / (1 + y/f)^(f·t_n).
 * Coupons are the program's per-unit amounts. Returns null when there is nothing left to receive.
 */
export function yieldToMaturity(t: BondTerms, price: bigint, now: UnixTs): number | null {
  const remaining = couponSchedule(t).filter((d) => d > now);
  if (!remaining.length || price <= ZERO) return null;
  const coupon = Number(couponPerUnit(t.faceValue, t.couponBps, t.frequency));
  const face = Number(t.faceValue);
  const p = Number(price);
  const f = t.frequency;
  const pv = (y: number) =>
    remaining.reduce((sum, d, i) => {
      const flow = coupon + (i === remaining.length - 1 ? face : 0);
      return sum + flow / Math.pow(1 + y / f, (f * (d - now)) / YEAR);
    }, 0);
  // pv is decreasing in y; bracket and bisect.
  let lo = -0.99 * f;
  let hi = 10;
  if (pv(hi) > p || pv(lo) < p) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- allocation -----------------------------------------------------------------------------------

/** The `Instrument` fields that gate `issue` on-chain. */
export type IssueState = {
  status: Instrument["status"];
  maturityTs: UnixTs;
  lockFrom: UnixTs;
  lockUntil: UnixTs;
  /** An action is between announcement and its payment phase (the register is being recorded). */
  pendingAction: boolean;
  openRedemption: boolean;
};

export type AllocationLimits = {
  /** Most units one Plain investor may hold through primary allocation. */
  capUnits: number;
  /** Most units in one request. */
  maxPerRequest: number;
};

export const DEFAULT_ALLOCATION_LIMITS: AllocationLimits = { capUnits: 20, maxPerRequest: 10 };

export type AllocationWindow = { open: true; reason: null } | { open: false; reason: string };

/** Whether the program would accept `issue` now, with the reason in plain words when not. */
export function allocationWindow(s: IssueState, now: UnixTs): AllocationWindow {
  if (s.status !== "Active") return { open: false, reason: s.status === "Redeemed" ? "This bond has been redeemed." : "This bond has matured." };
  if (now >= s.maturityTs) return { open: false, reason: "This bond has reached maturity." };
  if (s.openRedemption) return { open: false, reason: "A redemption is in progress. Allocations reopen after it settles." };
  if (s.lockFrom <= now && now < s.lockUntil) return { open: false, reason: "The register is locked for a record date. Allocations reopen after the payment date." };
  if (s.pendingAction) return { open: false, reason: "The issuer is recording the register for a corporate action. Allocations reopen once it is funded." };
  return { open: true, reason: null };
}

export type AllocationCheck =
  | { ok: true; units: bigint }
  | { ok: false; status: number; code: "invalid_units" | "closed" | "cap_reached" | "over_cap"; message: string };

/**
 * Validates a primary-allocation request before anything is signed. `heldUnits` is the wallet's
 * current balance of the bond, read from the chain inside the issuer's single-flight queue, so two
 * concurrent requests cannot both pass the cap.
 */
export function checkAllocation(input: { units: unknown; heldUnits: bigint; state: IssueState; now: UnixTs; limits?: AllocationLimits }): AllocationCheck {
  const limits = input.limits ?? DEFAULT_ALLOCATION_LIMITS;
  const n = input.units;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > limits.maxPerRequest) {
    return { ok: false, status: 400, code: "invalid_units", message: `Choose between 1 and ${limits.maxPerRequest} units.` };
  }
  const window = allocationWindow(input.state, input.now);
  if (!window.open) return { ok: false, status: 409, code: "closed", message: window.reason };
  const cap = BigInt(limits.capUnits);
  const room = cap - input.heldUnits;
  if (room <= ZERO) return { ok: false, status: 409, code: "cap_reached", message: `You already hold the maximum of ${limits.capUnits} units for this bond.` };
  if (BigInt(n) > room) return { ok: false, status: 409, code: "over_cap", message: `You can add up to ${room} more unit${room === BigInt(1) ? "" : "s"} (limit ${limits.capUnits} per investor).` };
  return { ok: true, units: BigInt(n) };
}

/** Memo written in every allocation's `issue` transaction. It marks the wallet as a Plain investor on-chain. */
export const ALLOCATION_MEMO = "pm:alloc:1";
export const allocationMemo = (holder: Address, units: bigint) => `${ALLOCATION_MEMO} ${holder} ${units.toString()}`;

export function parseAllocationMemo(memo: string): { holder: Address; units: bigint } | null {
  if (!memo.startsWith(`${ALLOCATION_MEMO} `)) return null;
  const [holder, units] = memo.slice(ALLOCATION_MEMO.length + 1).split(" ");
  if (!holder || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(holder) || !/^\d{1,19}$/.test(units ?? "")) return null;
  return { holder, units: BigInt(units) };
}

// ---- views ----------------------------------------------------------------------------------------

/** One-line note shown wherever test funds appear. */
export const TEST_FUNDS_NOTE = "Solana devnet test tokens. No real money is paid or received.";

export type BondOffering = {
  mint: Address;
  instrument: Address;
  name: string;
  symbol: string;
  status: Instrument["status"];
  settlementSymbol: string;
  settlementDecimals: number;
  faceValue: string;
  couponBps: number;
  frequency: number;
  issueTs: UnixTs;
  maturityTs: UnixTs;
  couponCount: number;
  nextCouponTs: UnixTs | null;
  nextCoupon: NextCoupon | null;
  couponPerUnit: string;
  /** Nominal annual yield to maturity at par, compounded `frequency` times a year (bps). */
  ytmBps: number | null;
  allocation: { open: boolean; reason: string | null; capUnits: number; maxPerRequest: number };
  explorerUrl: string | null;
};

export type BondPosition = {
  mint: Address;
  symbol: string;
  name: string;
  units: string;
  faceValue: string;
  /** Coupon accrued in the current unannounced period (estimate). */
  accrued: string;
  periodStart: UnixTs | null;
  nextCouponTs: UnixTs | null;
  nextCoupon: NextCoupon | null;
  /** Coupon per period for this position. */
  nextCouponAmount: string;
  settlementSymbol: string;
  settlementDecimals: number;
};

export type CalendarEntry = {
  mint: Address;
  symbol: string;
  ts: UnixTs;
  kind: "record" | "payment" | "vote-close" | "scheduled";
  title: string;
  actionId: Address | null;
  /** Expected payment for this wallet (base units), when known. */
  amount: string | null;
  settlementSymbol: string;
  settlementDecimals: number;
};

export type BondPayment = {
  mint: Address;
  symbol: string;
  actionId: Address;
  title: string;
  kind: CorporateAction["kind"];
  units: string;
  amount: string;
  burnedUnits: string;
  mode: ClaimReceipt["mode"];
  ts: UnixTs;
  signature: Signature;
  explorerUrl: string | null;
  verifyUrl: string;
  settlementSymbol: string;
  settlementDecimals: number;
};

export type BondVote = {
  mint: Address;
  symbol: string;
  actionId: Address;
  title: string;
  question: string;
  options: string[];
  tally: string[] | null;
  status: CorporateAction["status"];
  recordTs: UnixTs;
  closesTs: UnixTs;
  open: boolean;
  /** This wallet's voting weight (snapshot units), null when it was not in the snapshot. */
  weight: string | null;
  choice: number | null;
  winningOption: number | null;
  verifyUrl: string;
};

export type BondActionView = {
  id: Address;
  seq: number;
  kind: CorporateAction["kind"];
  title: string;
  status: CorporateAction["status"];
  announcedTs: UnixTs;
  recordTs: UnixTs;
  paymentTs: UnixTs;
  amountPerUnit: string;
  transitions: { status: CorporateAction["status"]; ts: UnixTs; signature: Signature; explorerUrl: string | null }[];
  /** This wallet's part, null when it was not in the record-date snapshot (or none was posted yet). */
  mine: { units: string; amount: string; payment: BondPayment | null } | null;
  verifyUrl: string;
};

export type SettlementBalance = { mint: Address; symbol: string; decimals: number; amount: string };

export type InvestorOverview =
  | { available: false; reason: string }
  | {
      available: true;
      wallet: Address;
      asOf: UnixTs;
      offerings: BondOffering[];
      positions: BondPosition[];
      calendar: CalendarEntry[];
      payments: BondPayment[];
      votes: BondVote[];
      settlement: SettlementBalance[];
      note: string;
    };

export type BondDetail = {
  wallet: Address;
  asOf: UnixTs;
  offering: BondOffering;
  position: BondPosition | null;
  actions: BondActionView[];
  calendar: CalendarEntry[];
  votes: BondVote[];
  settlement: SettlementBalance | null;
  note: string;
};

/** Everything the server read about one instrument, for one wallet. */
export type InstrumentReading = {
  instrument: Instrument;
  issue: IssueState;
  actions: CorporateAction[];
  snapshots: Map<Address, PublishedSnapshot | null>;
  receipts: Map<Address, ClaimReceipt[]>;
  votes: Map<Address, VoteRecord[]>;
  /** The wallet's current bond balance. */
  heldUnits: bigint;
};

export type ViewContext = {
  wallet: Address;
  now: UnixTs;
  limits: AllocationLimits;
  explorerTx: (signature: Signature) => string | null;
  explorerAddress: (address: Address) => string | null;
};

const verifyUrl = (actionId: Address) => `/verify/${actionId}`;

export function offeringView(r: Pick<InstrumentReading, "instrument" | "issue" | "actions">, ctx: ViewContext): BondOffering {
  const i = r.instrument;
  const window = allocationWindow(r.issue, ctx.now);
  const ytm = yieldToMaturity(i, i.faceValue, ctx.now);
  return {
    mint: i.mint,
    instrument: i.address,
    name: i.name,
    symbol: i.symbol,
    status: i.status,
    settlementSymbol: i.settlementSymbol,
    settlementDecimals: i.settlementDecimals,
    faceValue: i.faceValue.toString(),
    couponBps: i.couponBps,
    frequency: i.frequency,
    issueTs: i.issueTs,
    maturityTs: i.maturityTs,
    couponCount: couponSchedule(i).length,
    nextCouponTs: nextCouponDate(i, ctx.now, r.actions),
    nextCoupon: nextCoupon(i, ctx.now, r.actions),
    couponPerUnit: couponPerUnit(i.faceValue, i.couponBps, i.frequency).toString(),
    ytmBps: ytm == null ? null : Math.round(ytm * 10_000),
    allocation: { open: window.open, reason: window.reason, capUnits: ctx.limits.capUnits, maxPerRequest: ctx.limits.maxPerRequest },
    explorerUrl: ctx.explorerAddress(i.mint),
  };
}

export function positionView(r: Pick<InstrumentReading, "instrument" | "heldUnits" | "actions">, now: UnixTs): BondPosition | null {
  const i = r.instrument;
  if (r.heldUnits <= ZERO) return null;
  const announced = announcedCouponPeriods(r.actions);
  const period = accrualPeriod(i, now, announced);
  return {
    mint: i.mint,
    symbol: i.symbol,
    name: i.name,
    units: r.heldUnits.toString(),
    faceValue: (r.heldUnits * i.faceValue).toString(),
    accrued: accruedCoupon(i, r.heldUnits, now, announced).toString(),
    periodStart: period?.start ?? null,
    nextCouponTs: nextCouponDate(i, now, r.actions),
    nextCoupon: nextCoupon(i, now, r.actions),
    nextCouponAmount: (couponPerUnit(i.faceValue, i.couponBps, i.frequency) * r.heldUnits).toString(),
    settlementSymbol: i.settlementSymbol,
    settlementDecimals: i.settlementDecimals,
  };
}

function snapshotUnits(snapshot: PublishedSnapshot | null | undefined, wallet: Address): bigint | null {
  const h = snapshot?.holdings.find((x) => x.holder === wallet);
  return h ? h.units : null;
}

function paymentView(i: Instrument, a: CorporateAction, receipt: ClaimReceipt, ctx: ViewContext): BondPayment {
  return {
    mint: i.mint,
    symbol: i.symbol,
    actionId: a.id,
    title: a.title,
    kind: a.kind,
    units: receipt.units.toString(),
    amount: receipt.amount.toString(),
    burnedUnits: receipt.burnedUnits.toString(),
    mode: receipt.mode,
    ts: receipt.ts,
    signature: receipt.signature,
    explorerUrl: receipt.signature ? ctx.explorerTx(receipt.signature) : null,
    verifyUrl: verifyUrl(a.id),
    settlementSymbol: i.settlementSymbol,
    settlementDecimals: i.settlementDecimals,
  };
}

/** Expected amount for this wallet: from the snapshot once posted, else from the current balance. */
function expectedAmount(a: CorporateAction, units: bigint | null): bigint | null {
  if (a.kind === "Vote" || units == null) return null;
  if (a.kind === "PartialRedemption") {
    if (a.params.kind !== "PartialRedemption") return null;
    return ((units * BigInt(a.params.redeemBps)) / BigInt(10_000)) * a.amountPerUnit;
  }
  return units * a.amountPerUnit;
}

export function actionViews(r: InstrumentReading, ctx: ViewContext): BondActionView[] {
  const i = r.instrument;
  return r.actions
    .filter((a) => a.status !== "Cancelled")
    .map((a) => {
      const units = snapshotUnits(r.snapshots.get(a.id), ctx.wallet);
      const receipt = (r.receipts.get(a.id) ?? []).find((x) => x.holder === ctx.wallet) ?? null;
      const mine =
        units == null
          ? null
          : { units: units.toString(), amount: (expectedAmount(a, units) ?? ZERO).toString(), payment: receipt ? paymentView(i, a, receipt, ctx) : null };
      return {
        id: a.id,
        seq: a.seq,
        kind: a.kind,
        title: a.title,
        status: a.status,
        announcedTs: a.announcedTs,
        recordTs: a.recordTs,
        paymentTs: a.paymentTs,
        amountPerUnit: a.amountPerUnit.toString(),
        transitions: a.transitions.map((t) => ({ status: t.status, ts: t.ts, signature: t.signature, explorerUrl: t.signature ? ctx.explorerTx(t.signature) : null })),
        mine,
        verifyUrl: verifyUrl(a.id),
      };
    })
    .sort((x, y) => y.seq - x.seq);
}

export function paymentsFor(r: InstrumentReading, ctx: ViewContext): BondPayment[] {
  const out: BondPayment[] = [];
  for (const a of r.actions) {
    const receipt = (r.receipts.get(a.id) ?? []).find((x) => x.holder === ctx.wallet);
    if (receipt) out.push(paymentView(r.instrument, a, receipt, ctx));
  }
  return out.sort((x, y) => y.ts - x.ts);
}

/** Votes that affect this wallet: it was in the snapshot, or it holds units while one is upcoming or open. */
export function votesFor(r: InstrumentReading, ctx: ViewContext): BondVote[] {
  const i = r.instrument;
  const out: BondVote[] = [];
  for (const a of r.actions) {
    if (a.kind !== "Vote" || a.params.kind !== "Vote" || a.status === "Cancelled") continue;
    const weight = snapshotUnits(r.snapshots.get(a.id), ctx.wallet);
    const open = a.status !== "Settled" && ctx.now < a.paymentTs;
    if (weight == null && !(open && r.heldUnits > ZERO)) continue;
    const ballot = (r.votes.get(a.id) ?? []).find((v) => v.holder === ctx.wallet) ?? null;
    out.push({
      mint: i.mint,
      symbol: i.symbol,
      actionId: a.id,
      title: a.title,
      question: a.params.question,
      options: a.params.options,
      tally: a.tally ? a.tally.map((t) => t.toString()) : null,
      status: a.status,
      recordTs: a.recordTs,
      closesTs: a.paymentTs,
      open,
      weight: weight == null ? null : weight.toString(),
      choice: ballot?.choice ?? null,
      winningOption: a.winningOption,
      verifyUrl: verifyUrl(a.id),
    });
  }
  return out.sort((x, y) => Number(y.open) - Number(x.open) || y.closesTs - x.closesTs);
}

/**
 * Upcoming dates for a held instrument: record and payment dates of announced actions, then the
 * scheduled coupon dates no action covers yet ("scheduled", amount from the terms).
 */
export function calendarFor(r: InstrumentReading, ctx: ViewContext): CalendarEntry[] {
  const i = r.instrument;
  const base = { mint: i.mint, symbol: i.symbol, settlementSymbol: i.settlementSymbol, settlementDecimals: i.settlementDecimals };
  const out: CalendarEntry[] = [];
  const announcedPeriods = new Set<number>();
  for (const a of r.actions) {
    if (a.params.kind === "Coupon") announcedPeriods.add(a.params.period);
    if (a.status === "Settled" || a.status === "Cancelled") continue;
    const snapUnits = snapshotUnits(r.snapshots.get(a.id), ctx.wallet);
    const posted = r.snapshots.get(a.id) != null;
    // Before the snapshot, the current balance is what will be recorded.
    const units = posted ? snapUnits : r.heldUnits > ZERO ? r.heldUnits : null;
    if (units == null) continue;
    const paid = (r.receipts.get(a.id) ?? []).some((x) => x.holder === ctx.wallet);
    if (a.recordTs > ctx.now) out.push({ ...base, ts: a.recordTs, kind: "record", title: `${a.title} · record date`, actionId: a.id, amount: null });
    if (a.paymentTs > ctx.now && !paid) {
      const amount = expectedAmount(a, units);
      out.push({ ...base, ts: a.paymentTs, kind: a.kind === "Vote" ? "vote-close" : "payment", title: a.kind === "Vote" ? `${a.title} · voting closes` : `${a.title} · payment date`, actionId: a.id, amount: amount == null ? null : amount.toString() });
    }
  }
  if (r.heldUnits > ZERO && i.status === "Active") {
    const perPeriod = couponPerUnit(i.faceValue, i.couponBps, i.frequency) * r.heldUnits;
    const total = couponSchedule(i).length;
    couponSchedule(i).forEach((ts, k) => {
      const period = k + 1;
      if (ts <= ctx.now || announcedPeriods.has(period)) return;
      out.push({ ...base, ts, kind: "scheduled", title: `Coupon ${period} of ${total} · scheduled`, actionId: null, amount: perPeriod.toString() });
    });
  }
  return out.sort((x, y) => x.ts - y.ts);
}

export function buildOverview(readings: InstrumentReading[], settlement: SettlementBalance[], ctx: ViewContext): Extract<InvestorOverview, { available: true }> {
  const calendar = readings.flatMap((r) => calendarFor(r, ctx)).sort((x, y) => x.ts - y.ts);
  return {
    available: true,
    wallet: ctx.wallet,
    asOf: ctx.now,
    offerings: readings.map((r) => offeringView(r, ctx)),
    positions: readings.map((r) => positionView(r, ctx.now)).filter((p): p is BondPosition => p != null),
    calendar,
    payments: readings.flatMap((r) => paymentsFor(r, ctx)).sort((x, y) => y.ts - x.ts),
    votes: readings.flatMap((r) => votesFor(r, ctx)),
    settlement,
    note: TEST_FUNDS_NOTE,
  };
}

export function buildDetail(r: InstrumentReading, settlement: SettlementBalance | null, ctx: ViewContext): BondDetail {
  return {
    wallet: ctx.wallet,
    asOf: ctx.now,
    offering: offeringView(r, ctx),
    position: positionView(r, ctx.now),
    actions: actionViews(r, ctx),
    calendar: calendarFor(r, ctx),
    votes: votesFor(r, ctx),
    settlement,
    note: TEST_FUNDS_NOTE,
  };
}
