/**
 * ISO 20022 corporate-action messages generated from on-chain data.
 *
 * - seev.031 Corporate Action Notification: the announced terms of one action (event type,
 *   record / payment dates, rate, price, per-unit amount), one per action.
 * - seev.036 Corporate Action Movement Confirmation: one per paid holder, built from the
 *   on-chain ClaimReceipt (amount credited, units debited by a redemption, tx signature).
 *
 * The messages follow the element structure of the SR2023 schemas (seev.031.001.13,
 * seev.036.001.13) with a minimal subset of fields. They are well-formed XML with the official
 * namespaces but are not validated against the XSDs and carry no Business Application Header.
 *
 * Identification is honest rather than pretend-traditional: there is no ISIN, so the security is
 * identified by its Token-2022 mint under the proprietary scheme `SOLANA-TOKEN-2022-MINT`, holders
 * by wallet address (`SOLANA-WALLET`), and every message references the CorporateAction account
 * and the transaction signatures it was read from. Pure functions: no I/O, no secrets.
 */
import { isoDate, settlementDecimal } from "./format";
import { perUnitAmount } from "./math";
import type { ClaimReceipt, CorporateAction, EntitlementSheet, Instrument, LedgerSource } from "./service";

export const SEEV_031 = "seev.031.001.13";
export const SEEV_036 = "seev.036.001.13";
export const SECURITY_ID_SCHEME = "SOLANA-TOKEN-2022-MINT";
export const ACCOUNT_ID_SCHEME = "SOLANA-WALLET";
/** Envelope for several Documents in one file. Not an ISO 20022 message; each child is. */
export const BATCH_NS = "urn:plain:markets:iso20022-batch:1";

export type IsoEventType = "INTR" | "PCAL" | "REDM";

export type IsoContext = {
  instrument: Instrument;
  action: CorporateAction;
  /** Cluster the data was read from (goes into the narrative). */
  source?: Pick<LedgerSource, "cluster" | "kind">;
  /** Creation timestamp for the messages (unix seconds); defaults to now. */
  createdTs?: number;
};

/**
 * ISO event code. Partial redemption burns units pro rata at an unchanged face per unit, i.e. the
 * holder's position is reduced: that is PCAL (with reduction of nominal), not PRED (pool factor).
 * Votes are not exported.
 */
export function isoEventType(action: Pick<CorporateAction, "kind">): IsoEventType | null {
  switch (action.kind) {
    case "Coupon":
      return "INTR";
    case "PartialRedemption":
      return "PCAL";
    case "FinalRedemption":
      return "REDM";
    default:
      return null;
  }
}

export function supportsIso20022(action: Pick<CorporateAction, "kind" | "status">) {
  return isoEventType(action) !== null && action.status !== "Cancelled";
}

/**
 * ISO 4217 code for the settlement token. Test dollar / USDC tokens map to USD and test tenge to
 * KZT, with a note that they are devnet tokens; anything else gets XTS (the ISO code for testing).
 */
export function currencyFor(symbol: string): { code: string; note: string } {
  const s = symbol.toUpperCase().replace(/^T(?=USD|KZT)/, "");
  const code = s === "USD" || s === "USDC" ? "USD" : s === "KZT" ? "KZT" : "XTS";
  return { code, note: `Amounts are in ${symbol}, a devnet test token, reported under ISO 4217 code ${code}; no fiat moves.` };
}

/** Settlement base units → ISO amount: 2 decimals when exact to the cent, else full precision. */
export function isoAmount(value: bigint, decimals: number) {
  const full = settlementDecimal(value, decimals);
  const [int, frac = ""] = full.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return `${int}.${trimmed.length <= 2 ? trimmed.padEnd(2, "0") : trimmed}`;
}

/** bps → percent with up to 4 decimals ("10", "2.5"). */
export function bpsToPercent(bps: number) {
  return (bps / 100).toFixed(4).replace(/\.?0+$/, "");
}

export function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

type Node = { tag: string; attrs?: Record<string, string>; children?: (Node | null | false)[]; text?: string };
const el = (tag: string, children: (Node | null | false)[] | string, attrs?: Record<string, string>): Node =>
  typeof children === "string" ? { tag, text: children, attrs } : { tag, children, attrs };

function render(node: Node, depth = 0): string {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(node.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  if (node.text !== undefined) return `${pad}<${node.tag}${attrs}>${escapeXml(node.text)}</${node.tag}>`;
  const kids = (node.children ?? []).filter((c): c is Node => !!c);
  if (!kids.length) return `${pad}<${node.tag}${attrs}/>`;
  return `${pad}<${node.tag}${attrs}>\n${kids.map((k) => render(k, depth + 1)).join("\n")}\n${pad}</${node.tag}>`;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const isoDateTime = (ts: number) => new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
/** ISO Max16Text / Max35Text: truncate identifiers deterministically. */
const max = (text: string, n: number) => text.slice(0, n);

/** Event reference: instrument symbol + action sequence, unique per instrument (Max35Text). */
export function corporateActionEventId(instrument: Pick<Instrument, "symbol">, action: Pick<CorporateAction, "seq">) {
  return max(`${instrument.symbol}-CA-${action.seq}`, 35);
}

function security(instrument: Instrument): Node {
  return el("UndrlygScty", [
    el("FinInstrmId", [
      el("OthrId", [el("Id", instrument.mint), el("Tp", [el("Prtry", SECURITY_ID_SCHEME)])]),
      el("Desc", max(`${instrument.name} (${instrument.symbol})`, 140)),
    ]),
  ]);
}

function generalInfo(ctx: IsoContext, eventType: IsoEventType): Node {
  return el("CorpActnGnlInf", [
    el("CorpActnEvtId", corporateActionEventId(ctx.instrument, ctx.action)),
    el("OffclCorpActnEvtId", max(ctx.action.id, 35)),
    el("EvtTp", [el("Cd", eventType)]),
    el("MndtryVlntryEvtTp", [el("Cd", "MAND")]),
    security(ctx.instrument),
  ]);
}

function txSignature(action: CorporateAction, status: CorporateAction["status"]) {
  return action.transitions.find((t) => t.status === status)?.signature ?? null;
}

function narrative(ctx: IsoContext, extra: string[] = []) {
  const { action, instrument, source } = ctx;
  const cur = currencyFor(instrument.settlementSymbol);
  const lines = [
    source?.kind === "simulated"
      ? `Generated by Plain Markets from the in-browser simulated ledger (same rules as program ${instrument.programId}), not a live cluster.`
      : `Generated from Solana ${source?.cluster ?? "devnet"} program accounts by Plain Markets (program ${instrument.programId}).`,
    `CorporateAction account ${action.id}; Instrument account ${instrument.address}; bond mint ${instrument.mint}.`,
    `Settlement token mint ${instrument.settlementMint}. ${cur.note}`,
    txSignature(action, "Announced") ? `Announce tx ${txSignature(action, "Announced")}; terms sha256 ${action.termsHash}.` : `Terms sha256 ${action.termsHash}.`,
    action.merkleRoot ? `Record-date snapshot: merkle root ${action.merkleRoot}, snapshot sha256 ${action.snapshotHash ?? "-"}, slot ${action.snapshotSlot ?? "-"}.` : "Snapshot not yet posted; entitlements are fixed at record date.",
    ...extra,
  ];
  return lines;
}

function addtlInf(lines: string[]): Node {
  // AddtlTxt is Max8000Text in SR2023; one paragraph per reference keeps it readable.
  return el("AddtlInf", [el("AddtlTxt", [el("AddtlInf", max(lines.join("\n"), 8000))])]);
}

function priceNode(instrument: Instrument, priceBps: number, cur: string): Node {
  return el("GncCshPricRcvdPerPdct", [
    el("AmtPric", [
      el("AmtPricTp", [el("Cd", "ACTU")]),
      el("PricVal", isoAmount((instrument.faceValue * BigInt(priceBps)) / BigInt(10_000), instrument.settlementDecimals), { Ccy: cur }),
    ]),
  ]);
}

/** seev.031 Corporate Action Notification for one action (announced terms). */
export function buildNotification(ctx: IsoContext): string {
  const { action, instrument } = ctx;
  const eventType = isoEventType(action);
  if (!eventType) throw new Error(`ISO 20022 export is not available for ${action.kind} actions`);
  const created = ctx.createdTs ?? Math.floor(Date.now() / 1000);
  const cur = currencyFor(instrument.settlementSymbol).code;
  const p = action.params;
  const perUnit = action.amountPerUnit || perUnitAmount(instrument, p);
  const rateBps = p.kind === "Coupon" ? p.couponBps : p.kind === "FinalRedemption" && p.includeCoupon ? p.couponBps : null;
  const priceBps = p.kind === "PartialRedemption" || p.kind === "FinalRedemption" ? p.priceBps : null;
  const facts = [
    `Face value per unit ${isoAmount(instrument.faceValue, instrument.settlementDecimals)} ${cur}; ${instrument.frequency} coupon(s) per year; maturity ${isoDate(instrument.maturityTs)}.`,
    `Amount per ${p.kind === "PartialRedemption" ? "redeemed" : "held"} unit ${isoAmount(perUnit, instrument.settlementDecimals)} ${cur}.`,
    p.kind === "PartialRedemption" ? `Pro-rata redemption of ${bpsToPercent(p.redeemBps)}% of each holding, units rounded down per holder.` : "",
    action.totalEntitlement != null ? `Total entitlement ${isoAmount(action.totalEntitlement, instrument.settlementDecimals)} ${cur} over ${action.totalUnits ?? "-"} units, ${action.holderCount ?? "-"} holders.` : "",
    `Claim deadline ${isoDate(action.claimDeadlineTs)}; transfers are locked from record date to payment date.`,
  ].filter(Boolean);

  const doc = el(
    "Document",
    [
      el("CorpActnNtfctn", [
        el("NtfctnGnlInf", [
          el("NtfctnTp", "NEWM"),
          el("PrcgSts", [el("Cd", [el("EvtCmpltnsSts", "COMP"), el("EvtConfSts", "CONF")])]),
        ]),
        generalInfo(ctx, eventType),
        el("AcctDtls", [el("ForAllAccts", [el("IdCd", "GENR")])]),
        el("CorpActnDtls", [
          el("DtDtls", [
            el("AnncmntDt", [el("Dt", isoDate(action.announcedTs))]),
            el("RcrdDt", [el("Dt", isoDate(action.recordTs))]),
          ]),
          rateBps != null ? el("RateAndAmtDtls", [el("Intrst", [el("Rate", bpsToPercent(rateBps))])]) : null,
          p.kind === "Coupon" ? el("CpnNb", [el("Nb", String(p.period).padStart(3, "0"))]) : null,
        ]),
        el("CorpActnOptnDtls", [
          el("OptnNb", "001"),
          el("OptnTp", [el("Cd", "CASH")]),
          el("DfltPrcgOrStgInstr", [el("DfltOptnInd", "true")]),
          el("CcyOptn", cur),
          p.kind === "PartialRedemption"
            ? el("SctiesMvmntDtls", [
                el("SctyDtls", [el("FinInstrmId", [el("OthrId", [el("Id", instrument.mint), el("Tp", [el("Prtry", SECURITY_ID_SCHEME)])])])]),
                el("CdtDbtInd", "DBIT"),
                el("RateAndAmtDtls", [el("AddtlQtyForExstgScties", [el("QtyToQty", [el("Qty1", bpsToPercent(p.redeemBps)), el("Qty2", "100")])])]),
              ])
            : null,
          el("CshMvmntDtls", [
            el("CdtDbtInd", "CRDT"),
            el("DtDtls", [el("PmtDt", [el("Dt", isoDate(action.paymentTs))])]),
            rateBps != null ? el("RateAndAmtDtls", [el("IntrstRateUsdForPmt", [el("Rate", bpsToPercent(rateBps))])]) : null,
            priceBps != null ? el("PricDtls", [priceNode(instrument, priceBps, cur)]) : null,
          ]),
        ]),
        addtlInf(narrative(ctx, facts)),
      ]),
    ],
    { xmlns: `urn:iso:std:iso:20022:tech:xsd:${SEEV_031}` },
  );
  return `${XML_DECL}\n<!-- ${SEEV_031} generated ${isoDateTime(created)} from on-chain data; structure follows SR2023, not XSD-validated. -->\n${render(doc)}\n`;
}

function confirmationDoc(ctx: IsoContext, eventType: IsoEventType, receipt: ClaimReceipt, label?: string): Node {
  const { action, instrument } = ctx;
  const cur = currencyFor(instrument.settlementSymbol).code;
  return el(
    "Document",
    [
      el("CorpActnMvmntConf", [
        el("NtfctnId", [el("Id", max(receipt.address, 35))]),
        el("CorpActnGnlInf", [
          el("CorpActnEvtId", corporateActionEventId(instrument, action)),
          el("OffclCorpActnEvtId", max(action.id, 35)),
          el("EvtTp", [el("Cd", eventType)]),
          security(instrument),
        ]),
        el("AcctDtls", [
          el("SfkpgAcct", max(receipt.holder, 35)),
          label ? el("AcctOwnr", [el("NmAndAdr", [el("Nm", max(label, 140))])]) : null,
          el("BlckChainAdrOrWllt", [el("Id", receipt.holder), el("Tp", [el("Prtry", ACCOUNT_ID_SCHEME)])]),
          el("ConfdBal", [el("Bal", [el("Qty", [el("Unit", receipt.units.toString())])])]),
        ]),
        el("CorpActnDtls", [el("DtDtls", [el("RcrdDt", [el("Dt", isoDate(action.recordTs))])])]),
        el("CorpActnConfDtls", [
          el("OptnNb", "001"),
          el("OptnTp", [el("Cd", "CASH")]),
          receipt.burnedUnits > BigInt(0)
            ? el("SctiesMvmntDtls", [
                el("SctyDtls", [el("FinInstrmId", [el("OthrId", [el("Id", instrument.mint), el("Tp", [el("Prtry", SECURITY_ID_SCHEME)])])])]),
                el("CdtDbtInd", "DBIT"),
                el("PstngQty", [el("Qty", [el("Unit", receipt.burnedUnits.toString())])]),
                el("DtDtls", [el("PstngDt", [el("DtTm", isoDateTime(receipt.ts))])]),
              ])
            : null,
          el("CshMvmntDtls", [
            el("CdtDbtInd", "CRDT"),
            el("AmtDtls", [el("PstngAmt", isoAmount(receipt.amount, instrument.settlementDecimals), { Ccy: cur })]),
            el("DtDtls", [el("PstngDt", [el("DtTm", isoDateTime(receipt.ts))]), el("ValDt", [el("Dt", isoDate(receipt.ts))])]),
          ]),
        ]),
        el("TxId", [el("AcctSvcrTxId", max(receipt.signature, 35))]),
        addtlInf(
          narrative(ctx, [
            `Payment tx ${receipt.signature} (slot ${receipt.slot}, ${receipt.mode === "push" ? "pushed by the paying agent" : "claimed by the holder"}).`,
            `ClaimReceipt account ${receipt.address}; holder wallet ${receipt.holder}; ${receipt.units} snapshot units proven against the merkle root.`,
          ]),
        ),
      ]),
    ],
    { xmlns: `urn:iso:std:iso:20022:tech:xsd:${SEEV_036}` },
  );
}

/** Paid rows of the sheet (those with an on-chain receipt), in sheet order. */
export function paidReceipts(sheet: EntitlementSheet) {
  return sheet.rows.flatMap((r) => (r.receipt ? [{ receipt: r.receipt, label: r.label }] : []));
}

/**
 * seev.036 Movement Confirmations, one Document per paid holder. A single message is returned as
 * a plain ISO Document; several are wrapped in a `<Batch>` envelope (each Document keeps its own
 * ISO namespace) so the file stays one well-formed XML document.
 */
export function buildMovementConfirmations(ctx: IsoContext, sheet: EntitlementSheet): { xml: string; count: number } {
  const eventType = isoEventType(ctx.action);
  if (!eventType) throw new Error(`ISO 20022 export is not available for ${ctx.action.kind} actions`);
  const created = ctx.createdTs ?? Math.floor(Date.now() / 1000);
  const paid = paidReceipts(sheet);
  const docs = paid.map((p) => confirmationDoc(ctx, eventType, p.receipt, p.label));
  const comment = `<!-- ${SEEV_036} x${docs.length} generated ${isoDateTime(created)} from on-chain ClaimReceipt accounts of ${ctx.action.id}; structure follows SR2023, not XSD-validated. -->`;
  const body =
    docs.length === 1
      ? render(docs[0])
      : render({
          tag: "Batch",
          attrs: { xmlns: BATCH_NS, action: ctx.action.id, messageDefinition: SEEV_036, count: String(docs.length) },
          children: docs,
        });
  return { xml: `${XML_DECL}\n${comment}\n${body}\n`, count: docs.length };
}

export function isoFilename(instrument: Pick<Instrument, "symbol">, action: Pick<CorporateAction, "seq">, msg: "seev031" | "seev036") {
  return `${instrument.symbol}-action-${action.seq}-${msg === "seev031" ? SEEV_031 : SEEV_036}.xml`;
}
