import { formatSettlement, formatUnits } from "./format";
import { holderEntitlement, isPaymentAction, isRedemption, perUnitAmount, programTotal } from "./math";
import type {
  ActionDraft,
  Evidence,
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
import { sha256 } from "@noble/hashes/sha256";
import { buildMerkleTree, canonicalHoldings, snapshotHash, toHex } from "./snapshot";

const ZERO = BigInt(0);

/** Position in the lifecycle; -1 for Cancelled (a side exit). */
export function stageIndex(status: CorporateAction["status"]) {
  return status === "Cancelled" ? -1 : ACTION_STATUSES.indexOf(status);
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
        ...(entry?.plainInvestor ? { plainInvestor: true } : {}),
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

  const instrumentOf = async (action: CorporateAction) => {
    const instrument = (await ledger.listInstruments()).find((i) => i.address === action.instrument);
    if (!instrument) throw new Error("Instrument not found");
    return instrument;
  };

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
    const instrument = await instrumentOf(action);
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
    const instrument = await instrumentOf(action);
    // The full register replay is slow on public RPCs; the verifier UI runs it as a separate step (registerCheck).
    const [published, receipts, votes, snapshotSource, terms] = await Promise.all([
      ledger.getSnapshot(actionId),
      ledger.listReceipts(actionId),
      ledger.listVotes(actionId),
      ledger.snapshotSource ? ledger.snapshotSource(actionId) : Promise.resolve(null),
      ledger.termsDocument ? ledger.termsDocument(actionId) : Promise.resolve(undefined),
    ]);
    return verifyCorporateAction({
      instrument,
      action,
      snapshot: options?.snapshotOverride ?? published,
      snapshotSource: options?.snapshotOverride ? null : snapshotSource,
      receipts,
      votes,
      terms,
      now: ledger.now(),
    });
  };

  return service;
}

function fmtAmount(instrument: Instrument, v: bigint) {
  return formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
}

const sigOf = (action: CorporateAction, status: CorporateAction["status"]) => action.transitions.find((t) => t.status === status)?.signature;

/** Re-derives a corporate action from public data. Pure apart from hashing; runs in the browser. */
export async function verifyCorporateAction(input: {
  instrument: Instrument;
  action: CorporateAction;
  snapshot: PublishedSnapshot | null;
  snapshotSource?: Evidence | null;
  receipts: ClaimReceipt[];
  votes: VoteRecord[];
  /** Announcement document whose sha256 should equal terms_hash (chain backends). */
  terms?: { text: string; signature: string } | null;
  /** Register replayed from chain history up to record_slot (chain backends). */
  registerAtRecord?: { holdings: Holding[]; transactions: number; lastSignature: string | null } | null;
  now: number;
}): Promise<VerificationReport> {
  const { instrument, action, snapshot, receipts, votes } = input;
  const checks: VerificationCheck[] = [];
  const posted = stageIndex(action.status) >= stageIndex("SnapshotPosted");
  const amt = (v: bigint) => fmtAmount(instrument, v);
  const pendingSnapshot = "Becomes checkable once the snapshot is posted at the record date.";
  const acct = (label: string, value: string): Evidence => ({ label, value, address: action.id });
  const snapshotSig = sigOf(action, "SnapshotPosted");

  checks.push(timelineCheck(action));
  if (input.terms !== undefined) checks.push(await termsCheck(action, input.terms));

  let recomputedRoot: string | null = null;
  let recomputedHash: string | null = null;
  let entitlements: EntitlementSheet | null = null;
  let leaves: VerificationReport["leaves"] = null;
  let holdings: Holding[] | null = null;
  let snapshotError: string | null = null;

  if (snapshot) {
    try {
      holdings = canonicalHoldings(snapshot.holdings);
      recomputedHash = await snapshotHash(snapshot);
      const tree = await buildMerkleTree(action.id, holdings);
      recomputedRoot = tree.root;
      leaves = tree.holdings.map((h, i) => ({ holder: h.holder, units: h.units, hash: tree.leaves[i] }));
      entitlements = buildEntitlementSheet(instrument, action.params, holdings, "snapshot", { receipts, votes });
    } catch (error) {
      snapshotError = error instanceof Error ? error.message : String(error);
    }
  }

  const hashEvidence: Evidence[] = [
    { ...acct("snapshot_hash (CorporateAction)", action.snapshotHash ?? "—") },
    ...(input.snapshotSource ? [input.snapshotSource] : []),
  ];
  if (!posted || !snapshot) {
    const status = posted && !snapshot ? "fail" : "pending";
    checks.push({
      id: "snapshot-hash",
      title: "Snapshot matches its on-chain fingerprint",
      status,
      explanation: status === "fail" ? "The action has a snapshot hash on-chain, but the published register snapshot could not be found." : pendingSnapshot,
      evidence: posted ? hashEvidence : undefined,
    });
  } else if (snapshotError) {
    checks.push({ id: "snapshot-hash", title: "Snapshot matches its on-chain fingerprint", status: "fail", explanation: `The published snapshot is malformed: ${snapshotError}`, evidence: hashEvidence });
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
      evidence: hashEvidence,
    });
    const binds = snapshot.action === action.id && snapshot.mint === instrument.mint && snapshot.instrument === instrument.address && snapshot.recordTs === action.recordTs;
    checks.push({
      id: "snapshot-binding",
      title: "Snapshot belongs to this action",
      status: binds ? "pass" : "fail",
      explanation: binds
        ? "The snapshot names this action, this instrument, this bond mint and its record date, so it cannot be replayed from another action."
        : "The snapshot names a different action, instrument, mint or record date than the on-chain action.",
      evidence: [
        { label: "CorporateAction", value: action.id, address: action.id },
        { label: "Instrument", value: instrument.address, address: instrument.address },
        { label: "record_ts", value: String(action.recordTs), address: action.id },
      ],
    });
  }

  if (posted && holdings && !snapshotError) {
    checks.push({
      id: "merkle-root",
      title: "Merkle root rebuilt in your browser",
      status: recomputedRoot === action.merkleRoot ? "pass" : "fail",
      explanation:
        recomputedRoot === action.merkleRoot
          ? `${holdings.length} (action, holder, units) leaves hash to the same root the program checks every claim, payment and vote against.`
          : "The root rebuilt from the published holdings differs from merkle_root on-chain. Proofs built from this register would be rejected.",
      expected: action.merkleRoot ?? undefined,
      actual: recomputedRoot ?? undefined,
      evidence: [acct("merkle_root (CorporateAction)", action.merkleRoot ?? "—"), ...(snapshotSig ? [{ label: "post_snapshot transaction", value: snapshotSig, signature: snapshotSig }] : [])],
    });
    const sumUnits = holdings.reduce((n, h) => n + h.units, ZERO);
    const unitsOk = sumUnits === action.totalUnits && action.totalUnits === action.supplyAtRecord && holdings.length === action.holderCount;
    checks.push({
      id: "total-units",
      title: "Units add up to the whole supply",
      status: unitsOk ? "pass" : "fail",
      explanation: unitsOk
        ? `Σ units = ${formatUnits(sumUnits)} across ${holdings.length} holders equals total_units and the bond supply the program pinned at the record date. No holder was left out.`
        : `Σ units in the snapshot is ${formatUnits(sumUnits)} over ${holdings.length} holders; on-chain total_units is ${formatUnits(action.totalUnits ?? ZERO)}, holder_count ${action.holderCount ?? "—"}, supply at record ${formatUnits(action.supplyAtRecord ?? ZERO)}.`,
      expected: action.supplyAtRecord?.toString(),
      actual: sumUnits.toString(),
      evidence: [
        acct("total_units", String(action.totalUnits ?? "—")),
        acct("record_supply", String(action.supplyAtRecord ?? "—")),
        acct("holder_count", String(action.holderCount ?? "—")),
      ],
    });
    if (input.registerAtRecord !== undefined) checks.push(registerCheck(action, holdings, input.registerAtRecord));
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
  return { action, instrument, snapshot, snapshotSource: input.snapshotSource ?? null, recomputedRoot, recomputedHash, leaves, entitlements, checks, verdict, computedAt: input.now };
}

async function termsCheck(action: CorporateAction, terms: { text: string; signature: string } | null): Promise<VerificationCheck> {
  const announce = sigOf(action, "Announced");
  if (!terms) {
    return {
      id: "terms",
      title: "Announcement terms match terms_hash",
      status: "pending",
      explanation: "No announcement document was published with this action, so terms_hash cannot be opened.",
      evidence: [{ label: "terms_hash (CorporateAction)", value: action.termsHash, address: action.id }],
    };
  }
  const digest = toHex(await sha256(new TextEncoder().encode(terms.text)));
  return {
    id: "terms",
    title: "Announcement terms match terms_hash",
    status: digest === action.termsHash ? "pass" : "fail",
    explanation:
      digest === action.termsHash
        ? "The announcement document published in the announce transaction hashes to terms_hash, so the terms shown here are the ones the issuer committed to."
        : "The published announcement document does not hash to terms_hash on-chain.",
    expected: action.termsHash,
    actual: digest,
    evidence: [
      { label: "terms_hash (CorporateAction)", value: action.termsHash, address: action.id },
      { label: "announce transaction (memo)", value: terms.signature, signature: terms.signature },
      ...(announce && announce !== terms.signature ? [{ label: "ActionAnnounced", value: announce, signature: announce }] : []),
    ],
  };
}

/** Compares the snapshot with the register replayed from chain history (null replay = unavailable). */
export function registerCheck(
  action: CorporateAction,
  snapshot: Holding[],
  replay: { holdings: Holding[]; transactions: number; lastSignature: string | null } | null,
): VerificationCheck {
  const lockSig = sigOf(action, "RecordLocked");
  const evidence: Evidence[] = [
    { label: "record_slot (CorporateAction)", value: String(action.recordSlot ?? "—"), address: action.id },
    ...(lockSig ? [{ label: "lock_record transaction", value: lockSig, signature: lockSig }] : []),
    ...(replay?.lastSignature ? [{ label: "last balance change before record", value: replay.lastSignature, signature: replay.lastSignature }] : []),
  ];
  if (!replay) {
    return { id: "register-replay", title: "Snapshot equals the register replayed from chain", status: "pending", explanation: "The transaction history of the instrument could not be read from this RPC.", evidence };
  }
  const want = new Map(canonicalHoldings(replay.holdings).map((h) => [h.holder, h.units]));
  const diffs: string[] = [];
  for (const h of snapshot) {
    const u = want.get(h.holder) ?? ZERO;
    if (u !== h.units) diffs.push(`${short(h.holder)} snapshot ${h.units}, chain ${u}`);
    want.delete(h.holder);
  }
  for (const [holder, units] of want) diffs.push(`${short(holder)} holds ${units} on-chain but is missing from the snapshot`);
  return {
    id: "register-replay",
    title: "Snapshot equals the register replayed from chain",
    status: diffs.length ? "fail" : "pass",
    explanation: diffs.length
      ? `${diffs.join("; ")}.`
      : `Your browser replayed the bond balances of ${replay.transactions} transactions that touched the instrument up to record_slot (every transfer runs through the transfer hook, every issue and burn through the program). Each holder's balance equals its snapshot leaf.`,
    evidence,
  };
}

function timelineCheck(action: CorporateAction): VerificationCheck {
  const datesOk = action.announcedTs <= action.recordTs && action.recordTs < action.paymentTs && action.paymentTs <= action.claimDeadlineTs;
  let orderOk = true;
  // Transitions whose transaction is not known yet (slot 0) are ordered by status only.
  const ordered = action.transitions.filter((t) => t.status !== "Cancelled");
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1];
    const b = ordered[i];
    const known = a.slot > 0 && b.slot > 0;
    if (stageIndex(b.status) <= stageIndex(a.status) || (known && (b.ts < a.ts || b.slot < a.slot))) orderOk = false;
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
    evidence: [
      { label: "status (CorporateAction)", value: action.status, address: action.id },
      ...action.transitions.map((t) => (t.signature ? { label: `${t.status} · slot ${t.slot}`, value: t.signature, signature: t.signature } : { label: t.status, value: "transaction not indexed yet", address: action.id })),
    ],
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
  const acct = (label: string, value: string): Evidence => ({ label, value, address: action.id });
  if (!entitlements || action.totalUnits == null || action.totalEntitlement == null) {
    out.push({ id: "entitlement-total", title: "Entitlements recomputed and reconciled", status: "pending", explanation: pendingSnapshot });
    out.push({ id: "funding", title: "Paying vault funded in full", status: "pending", explanation: pendingSnapshot });
    out.push({ id: "payments", title: "Every payment matches its entitlement", status: "pending", explanation: pendingSnapshot });
    return out;
  }
  const perUnit = perUnitAmount(instrument, action.params);
  const redeemOk = !isRedemption(action.params) || action.totalRedeemUnits === entitlements.totalRedeemUnits;
  const formula = programTotal(instrument, action.params, action.totalUnits, entitlements.totalRedeemUnits);
  const totalOk = perUnit === action.amountPerUnit && formula === action.totalEntitlement && entitlements.totalAmount === action.totalEntitlement && redeemOk;
  out.push({
    id: "entitlement-total",
    title: "Entitlements recomputed and reconciled",
    status: totalOk ? "pass" : "fail",
    explanation: totalOk
      ? `Each holder's entitlement was recomputed from the instrument terms at ${amt(perUnit)} per ${action.kind === "PartialRedemption" ? "redeemed" : ""} unit. Σ = ${amt(entitlements.totalAmount)} equals total_entitlement on-chain to the base unit${
          action.kind === "PartialRedemption" ? `, and ${formatUnits(entitlements.totalRedeemUnits)} units to burn equals total_redeem_units` : ""
        }.`
      : `Recomputed: ${amt(perUnit)} per unit, Σ = ${amt(entitlements.totalAmount)}${isRedemption(action.params) ? `, ${entitlements.totalRedeemUnits} units to burn` : ""}. On-chain: amount_per_unit ${amt(action.amountPerUnit)}, total_entitlement ${amt(action.totalEntitlement)}${
          isRedemption(action.params) ? `, total_redeem_units ${action.totalRedeemUnits ?? "—"}` : ""
        }.`,
    expected: action.totalEntitlement.toString(),
    actual: entitlements.totalAmount.toString(),
    evidence: [
      { label: "face_value / coupon_bps / frequency (Instrument)", value: `${instrument.faceValue} / ${instrument.couponBps} / ${instrument.frequency}`, address: instrument.address },
      acct("amount_per_unit", action.amountPerUnit.toString()),
      acct("total_entitlement", action.totalEntitlement.toString()),
      ...(isRedemption(action.params) ? [acct("total_redeem_units", String(action.totalRedeemUnits ?? "—"))] : []),
    ],
  });

  const fundedStage = stageIndex(action.status) >= stageIndex("Funded");
  const fundSig = sigOf(action, "Funded");
  out.push({
    id: "funding",
    title: "Paying vault funded in full",
    status: !fundedStage ? "pending" : action.fundedAmount >= action.totalEntitlement ? "pass" : "fail",
    explanation: !fundedStage
      ? "Becomes checkable once the issuer funds the paying vault."
      : action.fundedAmount >= action.totalEntitlement
        ? `The issuer deposited ${amt(action.fundedAmount)} into the program-owned paying vault before any payment, covering every entitlement.`
        : `Only ${amt(action.fundedAmount)} was deposited against ${amt(action.totalEntitlement)} owed.`,
    evidence: [
      acct("funded_amount", action.fundedAmount.toString()),
      ...(action.vault ? [{ label: "Paying vault [vault, action]", value: action.vault, address: action.vault }] : []),
      ...(fundSig ? [{ label: "ActionFunded transaction", value: fundSig, signature: fundSig }] : []),
    ],
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
    evidence: [
      acct("paid_amount", action.paidAmount.toString()),
      acct("paid_count", String(action.paidCount)),
      ...(isRedemption(action.params) ? [acct("redeemed_units", action.redeemedUnits.toString())] : []),
      ...receipts.map((r) => ({ label: `ClaimReceipt ${short(r.holder)} · ${r.amount} (${r.mode})`, value: r.address, address: r.address })),
    ],
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
  if (action.status === "Settled") {
    const max = tally.reduce((m, t) => (t > m ? t : m), ZERO);
    const leaders = tally.flatMap((t, i) => (t === max && max > ZERO ? [i] : []));
    const expected = leaders.length === 1 ? leaders[0] : null;
    if (expected !== action.winningOption) problems.push(`winning_option is ${action.winningOption ?? "none"}, recomputed ${expected ?? "none (tie)"}`);
  }
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
    evidence: [
      { label: "tally (CorporateAction)", value: onchain.map(String).join(" / "), address: action.id },
      ...(action.status === "Settled" ? [{ label: "winning_option", value: action.winningOption == null ? "none" : options[action.winningOption] ?? String(action.winningOption), address: action.id }] : []),
      ...votes.map((v) => ({ label: `VoteRecord ${short(v.holder)} · ${options[v.choice] ?? v.choice} · ${v.weight}`, value: v.address, address: v.address })),
    ],
  };
}

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
