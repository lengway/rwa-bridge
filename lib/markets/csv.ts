import { isoDate, settlementDecimal } from "./format";
import { KIND_LABEL } from "./lifecycle";
import type { CorporateAction, EntitlementSheet, Instrument } from "./service";

function cell(value: string | number | bigint | null | undefined) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per holder, machine-readable (plain decimals, ISO dates), for paying agents and auditors. */
export function entitlementsCsv(instrument: Instrument, action: CorporateAction | null, sheet: EntitlementSheet, kindOverride?: CorporateAction["kind"]) {
  const kind = action?.kind ?? kindOverride ?? "Coupon";
  const header = [
    "instrument",
    "action_id",
    "action_seq",
    "action_type",
    "record_date",
    "payment_date",
    "source",
    "holder",
    "label",
    "units",
    `entitlement_${instrument.settlementSymbol.toLowerCase()}`,
    "redeem_units",
    "vote_weight",
    "status",
    "receipt_signature",
    "merkle_root",
    "snapshot_sha256",
  ];
  const lines = [header.join(",")];
  for (const r of sheet.rows) {
    const status = r.receipt ? `paid_${r.receipt.mode}` : r.vote ? `voted_${r.vote.choice}` : r.amount > BigInt(0) || r.weight > BigInt(0) ? "pending" : "nothing_owed";
    lines.push(
      [
        instrument.symbol,
        action?.id,
        action?.seq,
        KIND_LABEL[kind],
        action ? isoDate(action.recordTs) : "",
        action ? isoDate(action.paymentTs) : "",
        sheet.source,
        r.holder,
        r.label,
        r.units,
        settlementDecimal(r.amount, instrument.settlementDecimals),
        r.redeemUnits,
        r.weight,
        status,
        r.receipt?.signature ?? r.vote?.signature,
        action?.merkleRoot,
        action?.snapshotHash,
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
