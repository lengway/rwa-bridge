import { stageIndex } from "./derive";
import { formatDateTime, formatSettlement } from "./format";
import { isPaymentAction } from "./math";
import type { ActionDraft, ActionKind, ActionStatus, CorporateAction, EntitlementSheet, Instrument, UnixTs } from "./service";

/** Lifecycle presentation for the console and verifier. Rules live in the program; this only describes them. */

export type Stage = {
  status: ActionStatus;
  label: string;
  /** What the stage means, in one line. */
  hint: string;
  /** When the stage is due (scheduled), if it has a fixed date. */
  dueTs: UnixTs | null;
};

export const KIND_LABEL: Record<ActionKind, string> = {
  Coupon: "Coupon",
  PartialRedemption: "Partial redemption",
  FinalRedemption: "Final redemption",
  Vote: "Bondholder vote",
};

export function stagesFor(a: Pick<CorporateAction, "kind" | "announcedTs" | "recordTs" | "paymentTs" | "claimDeadlineTs">): Stage[] {
  if (a.kind === "Vote") {
    return [
      { status: "Announced", label: "Announced", hint: "Question, options and record date published on-chain", dueTs: a.announcedTs },
      { status: "RecordLocked", label: "Record locked", hint: "Transfer hook freezes the register", dueTs: a.recordTs },
      { status: "SnapshotPosted", label: "Snapshot posted", hint: "Voting weights committed as a Merkle root", dueTs: null },
      { status: "Settling", label: "Voting open", hint: "Holders vote with their snapshot units", dueTs: null },
      { status: "Settled", label: "Tallied", hint: "Vote closed; on-chain tally is final", dueTs: a.paymentTs },
    ];
  }
  return [
    { status: "Announced", label: "Announced", hint: "Terms and dates published on-chain", dueTs: a.announcedTs },
    { status: "RecordLocked", label: "Record locked", hint: "Ex-date lock: transfer hook freezes the register", dueTs: a.recordTs },
    { status: "SnapshotPosted", label: "Snapshot posted", hint: "Register committed as a Merkle root", dueTs: null },
    { status: "Funded", label: "Funded", hint: "Issuer deposits the total into the paying vault", dueTs: null },
    { status: "Settling", label: "Settling", hint: "Payments land against Merkle proofs", dueTs: a.paymentTs },
    { status: "Settled", label: "Settled", hint: "All paid or claim window closed", dueTs: null },
  ];
}

export function stageLabel(a: Pick<CorporateAction, "kind" | "status" | "announcedTs" | "recordTs" | "paymentTs" | "claimDeadlineTs">) {
  return stagesFor(a).find((s) => s.status === a.status)?.label ?? a.status;
}

export function progress(a: CorporateAction) {
  const stages = stagesFor(a);
  const idx = stages.findIndex((s) => s.status === a.status);
  return { done: idx + 1, total: stages.length };
}

export type StepOp = "lockRecord" | "postSnapshot" | "fund" | "payAll" | "settle";

export type NextStep = {
  op: StepOp;
  label: string;
  signer: "Issuer" | "Snapshot indexer" | "Paying agent";
  /** What the instruction does, for the confirmation dialog. */
  effects: string[];
  /** If set and in the future, the program will reject the instruction until then. */
  opensAt: UnixTs | null;
  /** If set, the step cannot run for a reason other than time. */
  blocked: string | null;
};

export function nextStep(a: CorporateAction, instrument: Instrument, sheet: EntitlementSheet | null): NextStep | null {
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
  const payment = isPaymentAction(a.params);
  switch (a.status) {
    case "Announced":
      return {
        op: "lockRecord",
        label: "Lock register at record date",
        signer: "Issuer",
        effects: [
          `Sets the ex-date lock on ${instrument.symbol} until ${formatDateTime(a.paymentTs)}.`,
          "From this slot the Token-2022 transfer hook rejects every transfer of the bond, so the register cannot change before payment.",
          "No account is frozen individually; the rule is enforced by the program for all holders.",
        ],
        opensAt: a.recordTs,
        blocked: null,
      };
    case "RecordLocked":
      return {
        op: "postSnapshot",
        label: "Post register snapshot",
        signer: "Snapshot indexer",
        effects: [
          "Reads every holder of the bond mint at the record date.",
          "Builds a Merkle tree of (holder, units) and posts its root, the total units and the sha256 of the canonical snapshot file.",
          "The program rejects the snapshot unless total units equal the bond supply, then computes total_entitlement itself.",
        ],
        opensAt: null,
        blocked: null,
      };
    case "SnapshotPosted":
      if (!payment) {
        return {
          op: "settle",
          label: "Close vote and finalise tally",
          signer: "Issuer",
          effects: ["Closes voting. The on-chain tally becomes final and is emitted as an event."],
          opensAt: a.paymentTs,
          blocked: null,
        };
      }
      return {
        op: "fund",
        label: `Fund paying vault · ${money(a.totalEntitlement ?? BigInt(0))}`,
        signer: "Issuer",
        effects: [
          `Transfers exactly ${money(a.totalEntitlement ?? BigInt(0))} from the issuer treasury to the program-owned paying vault.`,
          "The amount is fixed by the program from total units × terms; the issuer cannot under- or over-fund.",
          "Payments cannot start until the vault is funded.",
        ],
        opensAt: null,
        blocked: null,
      };
    case "Funded":
    case "Settling": {
      if (!payment) {
        return {
          op: "settle",
          label: "Close vote and finalise tally",
          signer: "Issuer",
          effects: ["Closes voting. The on-chain tally becomes final and is emitted as an event."],
          opensAt: a.paymentTs,
          blocked: null,
        };
      }
      const unpaid = sheet ? sheet.rows.filter((r) => r.amount > BigInt(0) && !r.receipt) : [];
      if (unpaid.length > 0) {
        const total = unpaid.reduce((n, r) => n + r.amount, BigInt(0));
        const redemption = a.kind !== "Coupon";
        return {
          op: "payAll",
          label: `Pay ${unpaid.length} outstanding · ${money(total)}`,
          signer: "Paying agent",
          effects: [
            `Sends ${unpaid.length} push payment${unpaid.length > 1 ? "s" : ""}, one per holder, each carrying the holder's Merkle proof.`,
            "The program recomputes each amount from the proof and writes a ClaimReceipt, so a holder can never be paid twice.",
            ...(redemption ? ["Each payment burns the redeemed units in the same instruction (delivery versus payment)."] : []),
            "Holders who prefer to claim themselves can still do so until the claim deadline.",
          ],
          opensAt: a.paymentTs,
          blocked: null,
        };
      }
      const residue = a.fundedAmount - a.paidAmount;
      return {
        op: "settle",
        label: "Settle action",
        signer: "Issuer",
        effects: [
          "Marks the action Settled and emits the final totals.",
          ...(residue > BigInt(0) ? [`Returns ${money(residue)} of rounding residue from the paying vault to the issuer.`] : []),
        ],
        opensAt: null,
        blocked: null,
      };
    }
    case "Settled":
    case "Cancelled":
      return null;
  }
}

/** Date-only next events across open actions, soonest first. */
export function upcomingEvents(actions: CorporateAction[], now: UnixTs) {
  const out: { ts: UnixTs; label: string; action: CorporateAction }[] = [];
  for (const a of actions) {
    if (a.status === "Settled" || a.status === "Cancelled") continue;
    if (stageIndex(a.status) < stageIndex("RecordLocked")) out.push({ ts: a.recordTs, label: "Record date", action: a });
    out.push({ ts: a.paymentTs, label: a.kind === "Vote" ? "Voting closes" : "Payment date", action: a });
    if (isPaymentAction(a.params)) out.push({ ts: a.claimDeadlineTs, label: "Claim deadline", action: a });
  }
  return out.filter((e) => e.ts > now).sort((x, y) => x.ts - y.ts);
}

export function couponPeriods(i: Pick<Instrument, "issueTs" | "maturityTs" | "frequency">) {
  return Math.round(((i.maturityTs - i.issueTs) / (365.25 * 86_400)) * i.frequency);
}

export function actionTitle(i: Pick<Instrument, "issueTs" | "maturityTs" | "frequency">, d: Pick<ActionDraft, "params">) {
  const p = d.params;
  switch (p.kind) {
    case "Coupon":
      return `Coupon ${p.period} of ${couponPeriods(i)}`;
    case "PartialRedemption":
      return `Partial redemption · ${p.redeemBps / 100}% ${p.priceBps === 10_000 ? "at par" : `at ${p.priceBps / 100}%`}`;
    case "FinalRedemption":
      return p.includeCoupon ? "Final redemption with last coupon" : "Final redemption";
    case "Vote":
      return `Bondholder vote · ${p.question}`;
  }
}
