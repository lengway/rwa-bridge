import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NotifyStore,
  announceEmail,
  createSendLimiter,
  notifyAnnounce,
  notifyEnabled,
  notifyPayment,
  paymentEmail,
  scheduleNotification,
  type NotifyDeps,
  type NotifyEmail,
} from "../lib/markets/notify";
import type { ClaimReceipt, CorporateAction, Instrument, Register } from "../lib/markets/service";

const ALICE = "A1iceWa11et1111111111111111111111111111111";
const BOB = "BobWa11et11111111111111111111111111111111";
const CUSTODIAN = "Cust0dian1111111111111111111111111111111";

const instrument = {
  mint: "Mint111111111111111111111111111111111111111",
  address: "Inst111111111111111111111111111111111111111",
  name: "Plain Test Bond 2027",
  symbol: "PTB27",
  settlementSymbol: "USD",
  settlementDecimals: 6,
  faceValue: BigInt(1_000_000_000), // $1,000
  couponBps: 800,
  frequency: 4,
} as Instrument;

const recordTs = Date.UTC(2026, 10, 1, 12, 0) / 1000;
const paymentTs = Date.UTC(2026, 10, 15, 12, 0) / 1000;
const action = {
  id: "Act1on11111111111111111111111111111111111111",
  seq: 3,
  instrument: instrument.address,
  kind: "Coupon",
  params: { kind: "Coupon", period: 1, couponBps: 800 },
  title: "Q4 coupon",
  recordTs,
  paymentTs,
  amountPerUnit: BigInt(20_000_000), // $20 per unit
} as CorporateAction;

const register: Register = {
  mint: instrument.mint,
  slot: 1,
  ts: 0,
  supply: BigInt(100),
  entries: [
    { holder: ALICE, units: BigInt(5), plainInvestor: true },
    { holder: BOB, units: BigInt(2), plainInvestor: true },
    { holder: CUSTODIAN, units: BigInt(93) },
  ],
};

const receipt = { holder: ALICE, units: BigInt(5), amount: BigInt(100_000_000), burnedUnits: BigInt(0), signature: "SigAlice" } as ClaimReceipt;

async function tempStore() {
  return new NotifyStore(path.join(await mkdtemp(path.join(tmpdir(), "notify-")), "store.json"));
}

function makeDeps(store: NotifyStore, send: (e: NotifyEmail) => Promise<void>): NotifyDeps {
  return {
    ledger: {
      getAction: async (id) => (id === action.id ? action : null),
      listInstruments: async () => [instrument],
      getRegister: async () => register,
      listReceipts: async () => [receipt],
      explorerTxUrl: (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
    },
    store,
    send,
    limit: () => true,
    siteUrl: "https://plain.lengway.me",
  };
}

test("flag is off by default", () => {
  assert.equal(notifyEnabled({}), false);
  assert.equal(notifyEnabled({ MARKETS_NOTIFY_EMAILS: "off" }), false);
  assert.equal(notifyEnabled({ MARKETS_NOTIFY_EMAILS: "on" }), true);
});

test("reverse lookup returns the linked email and null for unknown wallets", async () => {
  const store = await tempStore();
  await store.setContact(ALICE, "alice@example.com");
  assert.equal(await store.emailFor(ALICE), "alice@example.com");
  assert.equal(await store.emailFor(BOB), null);
});

test("dedupe: each (action, holder, kind) is claimed once and survives a new store instance", async () => {
  const store = await tempStore();
  assert.equal(await store.claim("act", ALICE, "announce"), true);
  assert.equal(await store.claim("act", ALICE, "announce"), false);
  assert.equal(await store.claim("act", ALICE, "payment"), true);
  const reopened = new NotifyStore((store as unknown as { file: string }).file);
  assert.equal(await reopened.claim("act", ALICE, "announce"), false);
});

test("rate limiter caps sends per window", () => {
  let now = 0;
  const limit = createSendLimiter(2, 1000, () => now);
  assert.equal(limit(), true);
  assert.equal(limit(), true);
  assert.equal(limit(), false);
  now = 1001;
  assert.equal(limit(), true);
});

test("announce template carries dates, per-unit amount and the expected entitlement", () => {
  const email = announceEmail({ to: "alice@example.com", instrument, action, siteUrl: "https://plain.lengway.me" }, BigInt(5));
  assert.match(email.subject, /Coupon payment announced · PTB27/);
  assert.match(email.text, /Record date: 1 Nov 2026, 12:00 UTC/);
  assert.match(email.text, /Payment date: 15 Nov 2026, 12:00 UTC/);
  assert.match(email.text, /Amount per unit: \$20\.00/);
  assert.match(email.text, /Your expected entitlement: \$100\.00/);
  assert.match(email.text, /https:\/\/plain\.lengway\.me\/verify\/Act1on/);
  assert.match(email.html, /\$100\.00/);
});

test("payment template carries the amount, explorer and verify links", () => {
  const email = paymentEmail({ to: "a@x", instrument, action, siteUrl: "https://plain.lengway.me" }, receipt, "https://explorer.solana.com/tx/SigAlice?cluster=devnet");
  assert.match(email.subject, /You received \$100\.00/);
  assert.match(email.text, /Amount received: \$100\.00/);
  assert.match(email.text, /Open in Explorer: https:\/\/explorer\.solana\.com\/tx\/SigAlice/);
  assert.match(email.text, /Verify this payment: https:\/\/plain\.lengway\.me\/verify\//);
});

test("announce mails only Plain investors with a known email, once", async () => {
  const store = await tempStore();
  await store.setContact(ALICE, "alice@example.com");
  const sent: NotifyEmail[] = [];
  const deps = makeDeps(store, async (e) => void sent.push(e));
  assert.deepEqual(await notifyAnnounce(deps, action.id), { sent: 1, skipped: 1, failed: 0 });
  assert.equal(sent[0].to, "alice@example.com");
  await notifyAnnounce(deps, action.id);
  assert.equal(sent.length, 1, "retry must not double-send");
});

test("a failed send is released so a retry can deliver", async () => {
  const store = await tempStore();
  await store.setContact(ALICE, "alice@example.com");
  let fail = true;
  const sent: NotifyEmail[] = [];
  const deps = makeDeps(store, async (e) => {
    if (fail) throw new Error("smtp down");
    sent.push(e);
  });
  assert.deepEqual(await notifyPayment(deps, action.id, ALICE, "SigAlice"), { sent: 0, skipped: 0, failed: 1 });
  fail = false;
  assert.deepEqual(await notifyPayment(deps, action.id, ALICE, "SigAlice"), { sent: 1, skipped: 0, failed: 0 });
});

test("email failure never affects the issuer op result", async () => {
  const store = await tempStore();
  await store.setContact(ALICE, "alice@example.com");
  const deps = makeDeps(store, async () => {
    throw new Error("smtp down");
  });
  const brokenLedger = { ...deps, ledger: { ...deps.ledger, getAction: async () => { throw new Error("rpc down"); } } } as NotifyDeps;
  const result = { signature: "SigOp", slot: 1, ts: 1, actionId: action.id };
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    const op = async () => {
      scheduleNotification(() => deps, "pay", { actionId: action.id, holder: ALICE }, result);
      scheduleNotification(() => brokenLedger, "announce", {}, result);
      scheduleNotification(() => { throw new Error("deps exploded"); }, "announce", {}, result);
      return result;
    };
    assert.deepEqual(await op(), result);
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    console.error = original;
  }
  assert.ok(errors.length >= 2, "failures are logged, not thrown");
});
