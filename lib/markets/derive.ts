import { formatSettlement, formatUnits } from "./format";
import { holderEntitlement, isPaymentAction, isRedemption, perUnitAmount, programTotal } from "./math";
import type {
  ActionDraft,
  ActionParams,
  ClaimReceipt,
  CorporateAction,
  EntitlementRow,
  EntitlementSheet,
  Holding,
  Instrument,
  MarketsLedger,
  MarketsService,
  PublishedSnapshot,
  RegisterEntry,
  VerificationCheck,
  VerificationReport,
  VoteRecord,
} from "./service";
import { ACTION_STATUSES } from "./service";
import { buildMerkleTree, canonicalHoldings, snapshotHash } from "./snapshot";

const ZERO = BigInt(0);

export function stageIndex(status: CorporateAction["status"]) {
  return ACTION_STATUSES.indexOf(status);
}

export function buildEntitlementSheet(
  instrument: Instrument,
  params: ActionParams,
  holdings: Holding[],
  source: EntitlementSheet["source"],
  extras: { labels?: Map<string, RegisterEntry>; receipts?: ClaimReceipt[]; votes?: VoteRecord[] } = {},
): EntitlementSheet {
  const receipts = new Map((extras.receipts ?? []).map((r) => [r.holder, r]));
  const votes = new Map((extras.votes ?? []).map((v) => [v.holder, v]));
  const rows: EntitlementRow[] = holdings
    .filter((h) => h.units > ZERO)
    .map((h) => {
      const e = holderEntitlement(instrument, params, h.units);
      const entry = extras.labels?.get(h.holder);
      return {
        holder: h.holder,
        label: entry?.label,
        units: h.units,
        amount: e.amount,
        redeemUnits: e.redeemUnits,
        weight: e.weight,
        receipt: receipts.get(h.holder) ?? null,
        vote: votes.get(h.holder) ?? null,
      };
    })
    .sort((a, b) => (b.units === a.units ? a.holder.localeCompare(b.holder) : b.units > a.units ? 1 : -1));
  return {
    source,
    rows,
    totalUnits: rows.reduce((n, r) => n + r.units, ZERO),
    totalAmount: rows.reduce((n, r) => n + r.amount, ZERO),
    totalRedeemUnits: rows.reduce((n, r) => n + r.redeemUnits, ZERO),
    perUnit: perUnitAmount(instrument, params),
  };
}

/** Adds the pure, client-side views on top of a ledger. */
export function withDerivedViews<L extends MarketsLedger>(ledger: L): L & MarketsService {
  const service = ledger as L & MarketsService;

  service.previewEntitlements = async (mint: string, draft: ActionDraft) => {
    const [instrument, register] = await Promise.all([ledger.getInstrument(mint), ledger.getRegister(mint)]);
    if (!instrument) throw new Error("Instrument not found");
    return buildEntitlementSheet(instrument, draft.params, register.entries, "live-register", {
      labels: new Map(register.entries.map((e) => [e.holder, e])),
    });
  };

  service.getEntitlements = async (actionId: string) => {
    const action = await ledger.getAction(actionId);
    if (!action) throw new Error("Corporate action not found");
    const instrument = (await ledger.listInstruments()).find((i) => i.address === action.instrument);
    if (!instrument) throw new Error("Instrument not found");
    const [snapshot, register, receipts, votes] = await Promise.all([
      ledger.getSnapshot(actionId),
      ledger.getRegister(instrument.mint),
      ledger.listReceipts(actionId),
      ledger.listVotes(actionId),
    ]);
    const labels = new Map(register.entries.map((e) => [e.holder, e]));
    const holdings = snapshot ? snapshot.holdings : register.entries;
    return buildEntitlementSheet(instrument, action.params, holdings, snapshot ? "snapshot" : "live-register", { labels, receipts, votes });
  };

  service.verifyAction = async (actionId, options) => {
    const action = await ledger.getAction(actionId);
    if (!action) throw new Error("Corporate action not found");
    const instrument = (await ledger.listInstruments()).find((i) => i.address === action.instrument);
    if (!instrument) throw new Error("Instrument not found");
    const [published, receipts, votes] = await Promise.all([
      ledger.getSnapshot(actionId),
      ledger.listReceipts(actionId),
      ledger.listVotes(actionId),
    ]);
    return verifyCorporateAction({
      instrument,
      action,
      snapshot: options?.snapshotOverride ?? published,
      receipts,
      votes,
      now: ledger.now(),
    });
  };

  return service;
}

function fmtAmount(instrument: Instrument, v: bigint) {
  return formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
}

/** Re-derives a corporate action from public data. Pure apart from hashing; runs in the browser. */
export async function verifyCorporateAction(input: {
  instrument: Instrument;
  action: CorporateAction;
  snapshot: PublishedSnapshot | null;
  receipts: ClaimReceipt[];
  votes: VoteRecord[];
  now: number;
}): Promise<VerificationReport> {
  const { instrument, action, snapshot, receipts, votes } = input;
  const checks: VerificationCheck[] = [];
  const posted = stageIndex(action.status) >= stageIndex("SnapshotPosted");
  const amt = (v: bigint) => fmtAmount(instrument, v);
  const pendingSnapshot = "Becomes checkable once the snapshot is posted at the record date.";

  checks.push(timelineCheck(action));

  let recomputedRoot: string | null = null;
  let recomputedHash: string | null = null;
  let entitlements: EntitlementSheet | null = null;
  let holdings: Holding[] | null = null;
  let snapshotError: string | null = null;

  if (snapshot) {
    try {
      holdings = canonicalHoldings(snapshot.holdings);
      recomputedHash = await snapshotHash(snapshot);
      recomputedRoot = (await buildMerkleTree(holdings)).root;
      entitlements = buildEntitlementSheet(instrument, action.params, holdings, "snapshot", { receipts, votes });
    } catch (error) {
      snapshotError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!posted || !snapshot) {
    const status = posted && !snapshot ? "fail" : "pending";
    checks.push({
      id: "snapshot-hash",
      title: "Snapshot matches its on-chain fingerprint",
      status,
      explanation: status === "fail" ? "The action has a snapshot hash on-chain, but the published register snapshot could not be found." : pendingSnapshot,
    });
  } else if (snapshotError) {
    checks.push({ id: "snapshot-hash", title: "Snapshot matches its on-chain fingerprint", status: "fail", explanation: `The published snapshot is malformed: ${snapshotError}` });
  } else {
    checks.push({
      id: "snapshot-hash",
      title: "Snapshot matches its on-chain fingerprint",
      status: recomputedHash === action.snapshotHash ? "pass" : "fail",
      explanation:
        recomputedHash === action.snapshotHash
          ? "The sha256 of the published register snapshot equals the snapshot_hash the program stored. The file you are looking at is exactly the one that was committed."
          : "The sha256 of the published snapshot differs from snapshot_hash on-chain. The register file was altered after it was committed.",
      expected: action.snapshotHash ?? undefined,
      actual: recomputedHash ?? undefined,
    });
    const binds = snapshot.action === action.id && snapshot.mint === instrument.mint && snapshot.recordTs === action.recordTs && snapshot.slot === action.snapshotSlot;
    checks.push({
      id: "snapshot-binding",
      title: "Snapshot belongs to this action",
      status: binds ? "pass" : "fail",
      explanation: binds
        ? "The snapshot names this action, this bond mint, its record date and the slot it was taken at, so it cannot be replayed from another action."
        : "The snapshot names a different action, mint, record date or slot than the on-chain action.",
    });
  }

  if (posted && holdings && !snapshotError) {
    checks.push({
      id: "merkle-root",
      title: "Merkle root rebuilt in your browser",
      status: recomputedRoot === action.merkleRoot ? "pass" : "fail",
      explanation:
        recomputedRoot === action.merkleRoot
          ? `${holdings.length} (holder, units) leaves hash to the same root the program checks every claim, payment and vote against.`
          : "The root rebuilt from the published holdings differs from merkle_root on-chain. Proofs built from this register would be rejected.",
      expected: action.merkleRoot ?? undefined,
      actual: recomputedRoot ?? undefined,
    });
    const sumUnits = holdings.reduce((n, h) => n + h.units, ZERO);
    checks.push({
      id: "total-units",
      title: "Units add up to the whole supply",
      status: sumUnits === action.totalUnits && action.totalUnits === action.supplyAtRecord ? "pass" : "fail",
      explanation:
        sumUnits === action.totalUnits && action.totalUnits === action.supplyAtRecord
          ? `Σ units = ${formatUnits(sumUnits)} equals total_units and the bond supply at record date. No holder was left out.`
          : `Σ units in the snapshot is ${formatUnits(sumUnits)}; on-chain total_units is ${formatUnits(action.totalUnits ?? ZERO)} and supply at record was ${formatUnits(action.supplyAtRecord ?? ZERO)}.`,
      expected: action.supplyAtRecord?.toString(),
      actual: sumUnits.toString(),
    });
  } else {
    for (const [id, title] of [["merkle-root", "Merkle root rebuilt in your browser"], ["total-units", "Units add up to the whole supply"]] as const) {
      checks.push({ id, title, status: posted && snapshotError ? "fail" : "pending", explanation: snapshotError ? "Not computable: the snapshot is malformed." : pendingSnapshot });
    }
  }

  if (isPaymentAction(action.params)) {
    checks.push(...paymentChecks({ instrument, action, entitlements, receipts, amt, pendingSnapshot }));
  } else {
    checks.push(voteCheck(action, entitlements, votes, pendingSnapshot));
  }

  const verdict = checks.some((c) => c.status === "fail") ? "mismatch" : checks.some((c) => c.status === "pending") ? "incomplete" : "verified";
  return { action, instrument, snapshot, recomputedRoot, recomputedHash, entitlements, checks, verdict, computedAt: input.now };
}

function timelineCheck(action: CorporateAction): VerificationCheck {
  const datesOk = action.announcedTs <= action.recordTs && action.recordTs < action.paymentTs && action.paymentTs <= action.claimDeadlineTs;
  let orderOk = true;
  for (let i = 1; i < action.transitions.length; i++) {
    const a = action.transitions[i - 1];
    const b = action.transitions[i];
    if (stageIndex(b.status) <= stageIndex(a.status) || b.ts < a.ts || b.slot < a.slot) orderOk = false;
  }
  const last = action.transitions[action.transitions.length - 1];
  if (last && last.status !== action.status) orderOk = false;
  return {
    id: "timeline",
    title: "Lifecycle followed the required order",
    status: datesOk && orderOk ? "pass" : "fail",
    explanation:
      datesOk && orderOk
        ? "Announcement precedes the record date, the record date precedes payment, and every status transition happened once, in order, at increasing slots."
        : "Dates or status transitions are out of order for this action.",
  };
}

function paymentChecks(ctx: {
  instrument: Instrument;
  action: CorporateAction;
  entitlements: EntitlementSheet | null;
  receipts: ClaimReceipt[];
  amt: (v: bigint) => string;
  pendingSnapshot: string;
}): VerificationCheck[] {
  const { instrument, action, entitlements, receipts, amt, pendingSnapshot } = ctx;
  const out: VerificationCheck[] = [];
  if (!entitlements || action.totalUnits == null || action.totalEntitlement == null) {
    out.push({ id: "entitlement-total", title: "Entitlements recomputed and reconciled", status: "pending", explanation: pendingSnapshot });
    out.push({ id: "funding", title: "Paying vault funded in full", status: "pending", explanation: pendingSnapshot });
    out.push({ id: "payments", title: "Every payment matches its entitlement", status: "pending", explanation: pendingSnapshot });
    return out;
  }
  const formula = programTotal(instrument, action.params, action.totalUnits);
  const residue = action.totalEntitlement - entitlements.totalAmount;
  const maxResidue = entitlements.perUnit * BigInt(entitlements.rows.length);
  const totalOk = formula === action.totalEntitlement && residue >= ZERO && (residue === ZERO || residue < maxResidue);
  out.push({
    id: "entitlement-total",
    title: "Entitlements recomputed and reconciled",
    status: totalOk ? "pass" : "fail",
    explanation: totalOk
      ? `Each holder's entitlement was recomputed from the instrument terms. Σ = ${amt(entitlements.totalAmount)}; on-chain total_entitlement = ${amt(action.totalEntitlement)}${
          residue > ZERO ? `. The ${amt(residue)} difference is per-holder rounding down and returns to the issuer at settlement.` : ", to the base unit."
        }`
      : `Recomputed Σ = ${amt(entitlements.totalAmount)} and the formula gives ${amt(formula)}, but total_entitlement on-chain is ${amt(action.totalEntitlement)}.`,
    expected: action.totalEntitlement.toString(),
    actual: entitlements.totalAmount.toString(),
  });

  const fundedStage = stageIndex(action.status) >= stageIndex("Funded");
  out.push({
    id: "funding",
    title: "Paying vault funded in full",
    status: !fundedStage ? "pending" : action.fundedAmount >= action.totalEntitlement ? "pass" : "fail",
    explanation: !fundedStage
      ? "Becomes checkable once the issuer funds the paying vault."
      : action.fundedAmount >= action.totalEntitlement
        ? `The issuer deposited ${amt(action.fundedAmount)} into the program-owned paying vault before any payment, covering every entitlement.`
        : `Only ${amt(action.fundedAmount)} was deposited against ${amt(action.totalEntitlement)} owed.`,
  });

  const byHolder = new Map(entitlements.rows.map((r) => [r.holder, r]));
  const seen = new Set<string>();
  const problems: string[] = [];
  let paid = ZERO;
  let burned = ZERO;
  for (const r of receipts) {
    const row = byHolder.get(r.holder);
    if (!row) problems.push(`${short(r.holder)} was paid but is not in the snapshot`);
    else {
      if (r.amount !== row.amount) problems.push(`${short(r.holder)} received ${amt(r.amount)}, entitled to ${amt(row.amount)}`);
      if (isRedemption(action.params) && r.burnedUnits !== row.redeemUnits) problems.push(`${short(r.holder)} burned ${r.burnedUnits} units, expected ${row.redeemUnits}`);
    }
    if (seen.has(r.holder)) problems.push(`${short(r.holder)} was paid twice`);
    seen.add(r.holder);
    paid += r.amount;
    burned += r.burnedUnits;
  }
  if (paid !== action.paidAmount) problems.push(`receipts sum to ${amt(paid)} but paid_amount is ${amt(action.paidAmount)}`);
  if (receipts.length !== action.paidCount) problems.push(`${receipts.length} receipts but paid_count is ${action.paidCount}`);
  if (isRedemption(action.params) && burned !== action.redeemedUnits) problems.push(`receipts burned ${burned} units but redeemed_units is ${action.redeemedUnits}`);
  const owed = entitlements.rows.filter((r) => r.amount > ZERO).length;
  out.push({
    id: "payments",
    title: "Every payment matches its entitlement",
    status: problems.length ? "fail" : receipts.length === 0 && stageIndex(action.status) < stageIndex("Settling") ? "pending" : "pass",
    explanation: problems.length
      ? `${problems.join("; ")}.`
      : receipts.length === 0
        ? "No payments yet. Each ClaimReceipt will be checked against the recomputed entitlement as it lands."
        : `${receipts.length} of ${owed} holders paid, ${amt(paid)} in total. Each ClaimReceipt equals the recomputed entitlement${
            isRedemption(action.params) ? " and burned exactly the redeemed units in the same instruction" : ""
          }, and no holder was paid twice.`,
  });
  return out;
}

function voteCheck(action: CorporateAction, entitlements: EntitlementSheet | null, votes: VoteRecord[], pendingSnapshot: string): VerificationCheck {
  if (!entitlements || action.params.kind !== "Vote") return { id: "tally", title: "Tally equals the sum of snapshot weights", status: "pending", explanation: pendingSnapshot };
  const options = action.params.options;
  const weights = new Map(entitlements.rows.map((r) => [r.holder, r.weight]));
  const tally = options.map(() => ZERO);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const v of votes) {
    const w = weights.get(v.holder);
    if (w == null) problems.push(`${short(v.holder)} voted but is not in the snapshot`);
    else if (w !== v.weight) problems.push(`${short(v.holder)} voted with ${v.weight} units, snapshot has ${w}`);
    if (seen.has(v.holder)) problems.push(`${short(v.holder)} voted twice`);
    seen.add(v.holder);
    if (v.choice >= 0 && v.choice < tally.length) tally[v.choice] += v.weight;
    else problems.push(`${short(v.holder)} chose an unknown option`);
  }
  const onchain = action.tally ?? options.map(() => ZERO);
  tally.forEach((t, i) => {
    if (onchain[i] !== t) problems.push(`"${options[i]}" has ${onchain[i]} on-chain, recomputed ${t}`);
  });
  const castWeight = tally.reduce((n, t) => n + t, ZERO);
  return {
    id: "tally",
    title: "Tally equals the sum of snapshot weights",
    status: problems.length ? "fail" : "pass",
    explanation: problems.length
      ? `${problems.join("; ")}.`
      : `${votes.length} votes, ${formatUnits(castWeight)} of ${formatUnits(entitlements.totalUnits)} units cast. Every VoteRecord's weight equals the holder's snapshot units and the on-chain tally (${options
          .map((o, i) => `${o} ${formatUnits(tally[i])}`)
          .join(", ")}) matches.`,
  };
}

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
