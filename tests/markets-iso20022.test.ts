import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  BATCH_NS,
  SECURITY_ID_SCHEME,
  SEEV_031,
  SEEV_036,
  buildMovementConfirmations,
  buildNotification,
  currencyFor,
  escapeXml,
  isoAmount,
  isoEventType,
} from "../lib/markets/iso20022";
import { holderEntitlement } from "../lib/markets/math";
import { ts } from "../lib/markets/mock-service";
import type { ActionParams, ClaimReceipt, CorporateAction, EntitlementSheet, Instrument } from "../lib/markets/service";

const usd = (n: number) => BigInt(n) * BigInt(1_000_000);
const MINT = "BondMint1111111111111111111111111111111111";
const ACTION = "Action1111111111111111111111111111111111111";

const instrument: Instrument = {
  mint: MINT,
  address: "Instrument111111111111111111111111111111111",
  programId: "H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm",
  issuer: "Issuer11111111111111111111111111111111111111",
  payingAgent: "Agent111111111111111111111111111111111111111",
  settlementMint: "UsdMint111111111111111111111111111111111111",
  settlementSymbol: "USD",
  settlementDecimals: 6,
  name: "Astana Green Bond 2028 <test> & co",
  symbol: "AGB28",
  faceValue: usd(1_000),
  couponBps: 1_000,
  frequency: 2,
  issueTs: ts("2026-10-01T00:00:00Z"),
  maturityTs: ts("2028-10-01T00:00:00Z"),
  status: "Active",
  lockFrom: 0,
  lockUntil: 0,
  allowlist: false,
  issuedUnits: BigInt(1_000),
  supply: BigInt(1_000),
  redeemedUnits: BigInt(0),
  actionCount: 1,
};

function action(params: ActionParams, amountPerUnit: bigint): CorporateAction {
  const kind = params.kind;
  return {
    id: ACTION,
    seq: 1,
    instrument: instrument.address,
    kind,
    params,
    status: "Settled",
    title: "Coupon 1",
    announcedTs: ts("2026-10-13T09:00:00Z"),
    recordTs: ts("2026-10-14T09:00:00Z"),
    paymentTs: ts("2026-10-15T09:00:00Z"),
    claimDeadlineTs: ts("2026-11-15T09:00:00Z"),
    vault: null,
    amountPerUnit,
    termsHash: "ab".repeat(32),
    recordSlot: 10,
    merkleRoot: "cd".repeat(32),
    snapshotHash: "ef".repeat(32),
    snapshotSlot: 11,
    totalUnits: BigInt(10),
    supplyAtRecord: BigInt(10),
    holderCount: 1,
    totalRedeemUnits: null,
    totalEntitlement: amountPerUnit * BigInt(10),
    fundedAmount: BigInt(0),
    paidAmount: BigInt(0),
    paidCount: 1,
    redeemedUnits: BigInt(0),
    sweptAmount: BigInt(0),
    tally: null,
    winningOption: null,
    transitions: [{ status: "Announced", ts: ts("2026-10-13T09:00:00Z"), slot: 9, signature: "AnnounceSig111" }],
  };
}

function sheetFor(params: ActionParams, holders: { holder: string; units: number; label?: string }[]): EntitlementSheet {
  const rows = holders.map((h, i) => {
    const e = holderEntitlement(instrument, params, BigInt(h.units));
    const receipt: ClaimReceipt = {
      address: `Receipt${i}`,
      action: ACTION,
      holder: h.holder,
      units: BigInt(h.units),
      amount: e.amount,
      burnedUnits: e.redeemUnits,
      mode: "push",
      slot: 20 + i,
      ts: ts("2026-10-15T10:00:00Z"),
      signature: `PaySig${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
    };
    return { holder: h.holder, label: h.label, units: BigInt(h.units), amount: e.amount, redeemUnits: e.redeemUnits, weight: BigInt(0), receipt, vote: null };
  });
  return { source: "snapshot", rows, totalUnits: BigInt(0), totalAmount: BigInt(0), totalRedeemUnits: BigInt(0), perUnit: BigInt(0) };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, isArray: (name) => name === "Document" });
const parse = (xml: string) => {
  assert.equal(XMLValidator.validate(xml), true, "well-formed XML");
  return parser.parse(xml);
};
const created = ts("2026-10-16T12:00:00Z");
const coupon: ActionParams = { kind: "Coupon", period: 1, couponBps: 1_000 };

test("seev.031 coupon notification: INTR, dates, rate, mint identifier, well-formed", () => {
  const xml = buildNotification({ instrument, action: action(coupon, usd(50)), createdTs: created });
  const doc = parse(xml).Document[0];
  assert.equal(doc["@xmlns"], `urn:iso:std:iso:20022:tech:xsd:${SEEV_031}`);
  const n = doc.CorpActnNtfctn;
  assert.equal(n.CorpActnGnlInf.EvtTp.Cd, "INTR");
  assert.equal(n.CorpActnGnlInf.CorpActnEvtId, "AGB28-CA-1");
  assert.equal(n.CorpActnGnlInf.UndrlygScty.FinInstrmId.OthrId.Id, MINT);
  assert.equal(n.CorpActnGnlInf.UndrlygScty.FinInstrmId.OthrId.Tp.Prtry, SECURITY_ID_SCHEME);
  assert.ok(!/ISIN/.test(xml), "no ISIN is claimed");
  assert.equal(n.CorpActnDtls.DtDtls.RcrdDt.Dt, "2026-10-14");
  assert.equal(n.CorpActnOptnDtls.CshMvmntDtls.DtDtls.PmtDt.Dt, "2026-10-15");
  assert.equal(n.CorpActnOptnDtls.CshMvmntDtls.RateAndAmtDtls.IntrstRateUsdForPmt.Rate, "10");
  assert.equal(n.CorpActnOptnDtls.CcyOptn, "USD");
  const text: string = n.AddtlInf.AddtlTxt.AddtlInf;
  assert.match(text, /Amount per held unit 50\.00 USD/);
  assert.match(text, new RegExp(`CorporateAction account ${ACTION}`));
  assert.match(text, /Announce tx AnnounceSig111/);
  assert.match(text, /devnet test token/);
  assert.match(xml, /Astana Green Bond 2028 &lt;test&gt; &amp; co/);
});

test("seev.036 confirmation: 10 units × 1000 × 10% ÷ 2 = 500.00 USD (track example)", () => {
  const sheet = sheetFor(coupon, [{ holder: "HolderA", units: 10, label: "Pension fund" }]);
  const { xml, count } = buildMovementConfirmations({ instrument, action: action(coupon, usd(50)), createdTs: created }, sheet);
  assert.equal(count, 1);
  const doc = parse(xml).Document[0];
  assert.equal(doc["@xmlns"], `urn:iso:std:iso:20022:tech:xsd:${SEEV_036}`);
  const c = doc.CorpActnMvmntConf;
  assert.equal(c.CorpActnConfDtls.CshMvmntDtls.AmtDtls.PstngAmt["#text"], "500.00");
  assert.equal(c.CorpActnConfDtls.CshMvmntDtls.AmtDtls.PstngAmt["@Ccy"], "USD");
  assert.equal(c.CorpActnConfDtls.CshMvmntDtls.DtDtls.ValDt.Dt, "2026-10-15");
  assert.equal(c.AcctDtls.SfkpgAcct, "HolderA");
  assert.equal(c.AcctDtls.ConfdBal.Bal.Qty.Unit, "10");
  assert.equal(c.CorpActnDtls.DtDtls.RcrdDt.Dt, "2026-10-14");
  assert.equal(c.TxId.AcctSvcrTxId.length, 35);
  assert.match(c.AddtlInf.AddtlTxt.AddtlInf, /Payment tx PaySig0x+ \(slot 20, pushed by the paying agent\)/);
  assert.equal(c.CorpActnConfDtls.SctiesMvmntDtls, undefined, "a coupon burns no units");
});

test("seev.036 batch: one Document per paid holder, amounts match entitlements", () => {
  const holders = [
    { holder: "A", units: 400 },
    { holder: "B", units: 250 },
    { holder: "C", units: 3 },
  ];
  const sheet = sheetFor(coupon, holders);
  sheet.rows.push({ holder: "Unpaid", units: BigInt(5), amount: usd(250), redeemUnits: BigInt(0), weight: BigInt(0), receipt: null, vote: null });
  const { xml, count } = buildMovementConfirmations({ instrument, action: action(coupon, usd(50)), createdTs: created }, sheet);
  assert.equal(count, 3, "only holders with an on-chain receipt are confirmed");
  const batch = parse(xml).Batch;
  assert.equal(batch["@xmlns"], BATCH_NS);
  const amounts = batch.Document.map((d: { CorpActnMvmntConf: { CorpActnConfDtls: { CshMvmntDtls: { AmtDtls: { PstngAmt: { "#text": string } } } } } }) => d.CorpActnMvmntConf.CorpActnConfDtls.CshMvmntDtls.AmtDtls.PstngAmt["#text"]);
  assert.deepEqual(amounts, ["20000.00", "12500.00", "150.00"]);
  for (const d of batch.Document) assert.equal(d["@xmlns"], `urn:iso:std:iso:20022:tech:xsd:${SEEV_036}`);
});

test("partial redemption → PCAL with units debited; final redemption → REDM with price; votes unsupported", () => {
  const partial: ActionParams = { kind: "PartialRedemption", redeemBps: 2_500, priceBps: 10_000 };
  const n = parse(buildNotification({ instrument, action: action(partial, usd(1_000)), createdTs: created })).Document[0].CorpActnNtfctn;
  assert.equal(n.CorpActnGnlInf.EvtTp.Cd, "PCAL");
  assert.equal(n.CorpActnOptnDtls.SctiesMvmntDtls.CdtDbtInd, "DBIT");
  assert.equal(n.CorpActnOptnDtls.CshMvmntDtls.PricDtls.GncCshPricRcvdPerPdct.AmtPric.PricVal["#text"], "1000.00");
  const c = parse(buildMovementConfirmations({ instrument, action: action(partial, usd(1_000)), createdTs: created }, sheetFor(partial, [{ holder: "A", units: 250 }])).xml).Document[0].CorpActnMvmntConf;
  assert.equal(c.CorpActnConfDtls.SctiesMvmntDtls.PstngQty.Qty.Unit, "62");
  assert.equal(c.CorpActnConfDtls.CshMvmntDtls.AmtDtls.PstngAmt["#text"], "62000.00");

  const final: ActionParams = { kind: "FinalRedemption", priceBps: 10_000, includeCoupon: true, couponBps: 1_000 };
  const f = parse(buildNotification({ instrument, action: action(final, usd(1_050)), createdTs: created })).Document[0].CorpActnNtfctn;
  assert.equal(f.CorpActnGnlInf.EvtTp.Cd, "REDM");
  assert.equal(f.CorpActnOptnDtls.CshMvmntDtls.RateAndAmtDtls.IntrstRateUsdForPmt.Rate, "10");

  assert.equal(isoEventType({ kind: "Vote" }), null);
  assert.throws(() => buildNotification({ instrument, action: action({ kind: "Vote", question: "q", options: ["a"] }, BigInt(0)) }));
});

test("helpers: currency mapping, amount precision, escaping", () => {
  assert.equal(currencyFor("USD").code, "USD");
  assert.equal(currencyFor("USDC").code, "USD");
  assert.equal(currencyFor("tKZT").code, "KZT");
  assert.equal(currencyFor("FOO").code, "XTS");
  assert.equal(isoAmount(usd(500), 6), "500.00");
  assert.equal(isoAmount(BigInt(1_234_567), 6), "1.234567");
  assert.equal(isoAmount(BigInt(1_230_000), 6), "1.23");
  assert.equal(isoAmount(BigInt(0), 0), "0.00");
  assert.equal(escapeXml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;");
});
