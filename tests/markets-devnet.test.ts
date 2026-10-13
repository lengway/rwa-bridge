import assert from "node:assert/strict";
import test from "node:test";

import { BN } from "@anchor-lang/core";
import { ACCOUNT_SIZE, AccountLayout, AccountState, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { GuardError, createIdempotencyStore, createRateLimiter, createSerialQueue } from "../lib/markets/api-guard";
import { replayBalances } from "../lib/markets/chain-history";
import { MarketsClient, PLAIN_MARKETS_PROGRAM_ID, pda } from "../lib/markets/client";
import { IssuerError, demoHolderKeypair, parseSecretKey, programErrorMessage, validateDraft } from "../lib/markets/devnet-issuer";
import { createDevnetMarketsService, httpExecutor, type DevnetMarketsConfig } from "../lib/markets/devnet-service";
import { buildSnapshotTree, snapshotHash } from "../lib/markets/merkle";
import { parseSnapshotMemo, parseTermsMemo, snapshotFromMemo, snapshotInlineMemo, termsHash, termsJson, termsMemo, type TermsDocument } from "../lib/markets/publication";
import type { ActionDraft } from "../lib/markets/service";
import { parseMemoField } from "../lib/markets/signature-feed";

const USD = BigInt(1_000_000);
const bn = (v: number | bigint) => new BN(v.toString());

// ---- a fake JSON-RPC endpoint holding a settled coupon -------------------------------------------

type Account = { data: Buffer; owner: PublicKey; lamports?: number };
type Sig = { signature: string; slot: number; blockTime: number; memo: string | null };

function fakeRpc(accounts: Map<string, Account>, sigs: Map<string, Sig[]>, slot = 9_000) {
  const calls: Record<string, number> = {};
  const enc = (a: Account | undefined) =>
    a ? { data: [a.data.toString("base64"), "base64"], executable: false, lamports: a.lamports ?? 1_000_000, owner: a.owner.toBase58(), rentEpoch: 0, space: a.data.length } : null;
  const fetchImpl = async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { id: string; method: string; params: unknown[] };
    calls[req.method] = (calls[req.method] ?? 0) + 1;
    const ctx = { context: { slot } };
    let result: unknown;
    switch (req.method) {
      case "getAccountInfo":
        result = { ...ctx, value: enc(accounts.get(req.params[0] as string)) };
        break;
      case "getMultipleAccounts":
        result = { ...ctx, value: (req.params[0] as string[]).map((k) => enc(accounts.get(k))) };
        break;
      case "getSignaturesForAddress": {
        const list = [...(sigs.get(req.params[0] as string) ?? [])].sort((a, b) => b.slot - a.slot);
        const until = (req.params[1] as { until?: string })?.until;
        const cut = until ? list.findIndex((s) => s.signature === until) : -1;
        result = (cut >= 0 ? list.slice(0, cut) : list).map((s) => ({ ...s, err: null, confirmationStatus: "confirmed" }));
        break;
      }
      case "getSlot":
        result = slot;
        break;
      case "getBlockTime":
        result = 1_800_000_000;
        break;
      default:
        throw new Error(`unexpected RPC ${req.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { headers: { "content-type": "application/json" } });
  };
  return { connection: new Connection("http://fake.rpc", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: fetchImpl as typeof fetch }), calls };
}

const memoField = (...memos: string[]) => memos.map((m) => `[${Buffer.byteLength(m)}] ${m}`).join("; ");

async function settledCouponFixture(opts: { tamperReceipt?: boolean; transferAfterRecord?: boolean } = {}) {
  const client = MarketsClient.fromConnection(new Connection("http://unused"));
  const issuer = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const usd = Keypair.generate().publicKey;
  const instrument = pda.instrument(mint);
  const action = pda.action(instrument, 0);
  const holders = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
  const units = [BigInt(50), BigInt(30), BigInt(20)];
  const T = 1_800_000_000;
  const recordSlot = 1_100;
  const snapSlot = 1_120;

  const doc: TermsDocument = { v: 1, kind: "Coupon", title: "Coupon 1 of 8", recordTs: T + 25, paymentTs: T + 45, claimDeadlineTs: T + 600, rateBps: 1200, redeemBps: 0, priceBps: 0, options: [], question: null };
  const json = termsJson(doc);
  const holdings = holders.map((h, i) => ({ holder: h.toBase58(), units: units[i] }));
  const snapshot = { version: 1 as const, instrument: instrument.toBase58(), mint: mint.toBase58(), action: action.toBase58(), recordTs: doc.recordTs, slot: snapSlot - 2, holdings };
  const tree = buildSnapshotTree(action, holdings);
  const perUnit = BigInt(30) * USD;

  const accounts = new Map<string, Account>();
  const put = async (address: PublicKey, name: string, value: Record<string, unknown>) =>
    accounts.set(address.toBase58(), { data: await client.coder.accounts.encode(name, value), owner: PLAIN_MARKETS_PROGRAM_ID });

  await put(instrument, "instrument", {
    issuer, payingAgent: issuer, mint, settlementMint: usd, settlementTokenProgram: TOKEN_PROGRAM_ID, settlementDecimals: 6,
    name: "Test Bond", symbol: "TB28", isin: Array(12).fill(0), faceValue: bn(BigInt(1000) * USD), couponBps: 1200, couponFrequency: 4,
    issueTs: bn(T - 90 * 86_400), maturityTs: bn(T + 700 * 86_400), status: { active: {} }, allowlistEnabled: false,
    lockFrom: bn(doc.recordTs), lockUntil: bn(doc.paymentTs), issuedUnits: bn(100), redeemedUnits: bn(0), actionCount: bn(1),
    couponPeriods: 1, pendingAction: null, openActions: 0, openRedemption: false, createdTs: bn(T - 100), bump: 255,
  });
  await put(action, "corporateAction", {
    instrument, id: bn(0), kind: { coupon: {} }, status: { settled: {} }, title: doc.title, termsHash: Array.from(termsHash(json)),
    recordTs: bn(doc.recordTs), paymentTs: bn(doc.paymentTs), claimDeadline: bn(doc.claimDeadlineTs), rateBps: 1200, redeemBps: 0, priceBps: 0, period: 1, options: [],
    amountPerUnit: bn(perUnit), recordSupply: bn(100), recordSlot: bn(recordSlot), recordLockedTs: bn(T + 26),
    merkleRoot: Array.from(tree.root), snapshotHash: Array.from(snapshotHash(snapshot)), totalUnits: bn(100), holderCount: 3, snapshotSlot: bn(snapSlot),
    totalRedeemUnits: bn(0), totalEntitlement: bn(perUnit * BigInt(100)), fundedAmount: bn(perUnit * BigInt(100)), paidAmount: bn(perUnit * BigInt(100)), paidCount: 3,
    claimedUnits: bn(100), redeemedUnits: bn(0), sweptAmount: bn(0), tally: [bn(0), bn(0), bn(0), bn(0)], votesCast: 0, winningOption: null,
    prevLockFrom: bn(0), prevLockUntil: bn(0), announcedTs: bn(T), fundedTs: bn(T + 30), settledTs: bn(T + 60), bump: 254,
  });
  for (let i = 0; i < holders.length; i++) {
    const amount = perUnit * units[i] + (opts.tamperReceipt && i === 0 ? USD : BigInt(0));
    await put(pda.claim(action, holders[i]), "claimReceipt", {
      action, holder: holders[i], units: bn(units[i]), amount: bn(amount), burnedUnits: bn(0), mode: i === 1 ? { claim: {} } : { push: {} },
      paidBy: issuer, slot: bn(1_200 + i), ts: bn(T + 50 + i), bump: 253,
    });
  }
  // Token-2022 bond mint and holder ATAs (base layouts).
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: instrument, supply: BigInt(100), decimals: 0, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  accounts.set(mint.toBase58(), { data: mintData, owner: TOKEN_2022_PROGRAM_ID });
  holders.forEach((h, i) => {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner: h, amount: units[i], delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized, isNativeOption: 0, isNative: BigInt(0), delegatedAmount: BigInt(0), closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    accounts.set(getAssociatedTokenAddressSync(mint, h, true, TOKEN_2022_PROGRAM_ID).toBase58(), { data, owner: TOKEN_2022_PROGRAM_ID });
  });

  const s = (signature: string, slot: number, blockTime: number, memo: string | null = null): Sig => ({ signature, slot, blockTime, memo });
  const sig = (n: number) => Keypair.generate().publicKey.toBase58() + String(n).padStart(4, "0");
  const feed: Sig[] = [
    s(sig(1), 1_000, T - 100),
    s(sig(2), 1_050, T, memoField(termsMemo(json))),
    s(sig(3), recordSlot, T + 26),
    s(sig(4), snapSlot, T + 28, memoField(snapshotInlineMemo(snapshot.slot, tree.holdings))),
    s(sig(5), 1_150, T + 30),
    s(sig(6), 1_200, T + 50),
    s(sig(7), 1_201, T + 51),
    s(sig(8), 1_202, T + 52),
    s(sig(9), 1_300, T + 60),
  ];
  const { connection, calls } = fakeRpc(accounts, new Map([[instrument.toBase58(), feed]]));
  const config: DevnetMarketsConfig = {
    mode: "devnet", rpcUrl: "http://fake.rpc", programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(), issuer: issuer.toBase58(), mints: [mint.toBase58()],
    directory: [{ address: holders[0].toBase58(), label: "Pension fund", custody: "custodian" }], settlementSymbol: "USD", writable: false, apiBase: "/api/markets",
  };
  const svc = createDevnetMarketsService(config, null, { connection, poll: false });
  return { svc, calls, instrument, action, mint, holders, feed, snapshot, json };
}

// ---- publication and feed parsing ------------------------------------------------------------------

test("memo field parsing honours byte lengths, '; ' inside memos and unicode", () => {
  const a = 'pm:terms:1 {"question":"Extend; or not — ✓"}';
  const b = "pm:snap:1 7 X:1";
  assert.deepEqual(parseMemoField(memoField(a, b)), [a, b]);
  assert.deepEqual(parseMemoField(null), []);
});

test("snapshot memo round-trips to the exact committed hash; terms memo hashes to terms_hash", () => {
  const holders = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()];
  const ctx = { instrument: holders[0], mint: holders[1], action: Keypair.generate().publicKey.toBase58(), recordTs: 123 };
  const snap = snapshotFromMemo(ctx, 99, [{ holder: holders[0], units: BigInt(7) }, { holder: holders[1], units: BigInt(3) }]);
  const parsed = parseSnapshotMemo(snapshotInlineMemo(99, snap.holdings));
  assert.ok(parsed && "holdings" in parsed);
  assert.deepEqual(snapshotHash(snapshotFromMemo(ctx, parsed.slot, parsed.holdings)), snapshotHash(snap));
  const doc: TermsDocument = { v: 1, kind: "Vote", title: "Vote", recordTs: 1, paymentTs: 2, claimDeadlineTs: 2, rateBps: 0, redeemBps: 0, priceBps: 0, options: ["For", "Against"], question: "Q?" };
  const t = parseTermsMemo(termsMemo(termsJson(doc)));
  assert.equal(t?.doc.question, "Q?");
  assert.deepEqual(termsHash(t!.json), termsHash(termsJson(doc)));
});

test("register replay applies balances in order and stops at the record slot", () => {
  const [alice, bob, carol] = [0, 1, 2].map(() => Keypair.generate().publicKey.toBase58());
  const records = [
    { signature: "a", slot: 10, balances: [{ account: "A1", owner: alice, amount: "60" }, { account: "B1", owner: bob, amount: "40" }] },
    { signature: "b", slot: 20, balances: [{ account: "A1", owner: alice, amount: "50" }, { account: "B1", owner: bob, amount: "50" }] },
    { signature: "c", slot: 30, balances: [{ account: "A1", owner: alice, amount: "0" }, { account: "C1", owner: carol, amount: "50" }] },
  ];
  const keyed = (r: ReturnType<typeof replayBalances>) => Object.fromEntries(r.holdings.map((h) => [h.holder, Number(h.units)]));
  assert.deepEqual(keyed(replayBalances(records, 20)), { [alice]: 50, [bob]: 50 });
  assert.deepEqual(keyed(replayBalances(records)), { [bob]: 50, [carol]: 50 });
  assert.equal(replayBalances(records, 20).lastSignature, "b");
});

// ---- the service over a mock RPC -----------------------------------------------------------------

test("devnet service: a settled coupon verifies from accounts + memos, with evidence and links", async () => {
  const { svc, calls, action, mint, holders, feed } = await settledCouponFixture();
  const [inst] = await svc.listInstruments();
  assert.equal(inst.symbol, "TB28");
  assert.equal(inst.supply, BigInt(100));
  const [a] = await svc.listActions(mint.toBase58());
  assert.equal(a.status, "Settled");
  assert.equal(a.params.kind === "Coupon" && a.params.period, 1);
  assert.deepEqual(a.transitions.map((t) => t.status), ["Announced", "RecordLocked", "SnapshotPosted", "Funded", "Settling", "Settled"]);
  assert.deepEqual(a.transitions.map((t) => t.signature), [feed[1], feed[2], feed[3], feed[4], feed[5], feed[8]].map((s) => s.signature));

  const report = await svc.verifyAction(action.toBase58());
  assert.equal(report.verdict, "verified", JSON.stringify(report.checks.filter((c) => c.status !== "pass")));
  assert.ok(report.checks.find((c) => c.id === "terms")?.status === "pass");
  for (const c of report.checks) assert.ok(c.evidence?.length, `${c.id} has on-chain evidence`);
  assert.equal(report.snapshotSource?.signature, feed[3].signature);
  assert.match(svc.explorerTxUrl(feed[3].signature) ?? "", /cluster=devnet/);

  const receipts = await svc.listReceipts(action.toBase58());
  assert.equal(receipts.length, 3);
  assert.equal(receipts.find((r) => r.holder === holders[1].toBase58())?.mode, "claim");

  const register = await svc.getRegister(mint.toBase58());
  assert.equal(register.entries.find((e) => e.holder === holders[0].toBase58())?.label, "Pension fund");

  const events = await svc.listEvents(mint.toBase58());
  assert.deepEqual(new Set(events.map((e) => e.name)), new Set(["InstrumentCreated", "ActionAnnounced", "RecordLocked", "SnapshotPosted", "ActionFunded", "EntitlementPaid", "ActionSettled"]));
  // Shaped for the public RPC: one signature listing, no transaction downloads.
  assert.equal(calls.getSignaturesForAddress, 1);
  assert.equal(calls.getTransaction ?? 0, 0);
});

test("devnet service: an overpaid receipt and a tampered snapshot are caught", async () => {
  const { svc, action } = await settledCouponFixture({ tamperReceipt: true });
  const report = await svc.verifyAction(action.toBase58());
  assert.equal(report.verdict, "mismatch");
  assert.equal(report.checks.find((c) => c.id === "payments")?.status, "fail");

  const clean = await settledCouponFixture();
  const snap = (await clean.svc.getSnapshot(clean.action.toBase58()))!;
  const tampered = { ...snap, holdings: snap.holdings.map((h, i) => (i === 0 ? { ...h, units: h.units + BigInt(1) } : h)) };
  const r2 = await clean.svc.verifyAction(clean.action.toBase58(), { snapshotOverride: tampered });
  for (const id of ["snapshot-hash", "merkle-root", "total-units"]) assert.equal(r2.checks.find((c) => c.id === id)?.status, "fail", id);
});

test("devnet service: unknown actions resolve to null and writes need a server", async () => {
  const { svc, mint } = await settledCouponFixture();
  assert.equal(await svc.getAction(Keypair.generate().publicKey.toBase58()), null);
  assert.equal(await svc.getAction("not-an-address"), null);
  await assert.rejects(svc.lockRecord(Keypair.generate().publicKey.toBase58()), /read-only/);
  assert.equal((await svc.getInstrument(mint.toBase58()))?.symbol, "TB28");
});

// ---- issuer helpers ------------------------------------------------------------------------------

test("issuer: secret parsing, deterministic demo wallets, draft validation, error messages", () => {
  const kp = Keypair.generate();
  assert.equal(parseSecretKey(JSON.stringify(Array.from(kp.secretKey)))?.publicKey.toBase58(), kp.publicKey.toBase58());
  assert.equal(parseSecretKey(""), null);
  assert.throws(() => parseSecretKey("[1,2,3]"), /64-byte/);
  assert.equal(demoHolderKeypair(kp, 2).publicKey.toBase58(), demoHolderKeypair(kp, 2).publicKey.toBase58());
  assert.notEqual(demoHolderKeypair(kp, 1).publicKey.toBase58(), demoHolderKeypair(kp, 2).publicKey.toBase58());

  const T = 1_800_000_000;
  const ok: ActionDraft = { kind: "Coupon", recordTs: T, paymentTs: T + 60, claimDeadlineTs: T + 600, params: { kind: "Coupon", period: 1, couponBps: 1200 } };
  assert.doesNotThrow(() => validateDraft(ok));
  assert.throws(() => validateDraft({ ...ok, paymentTs: T - 1 }), IssuerError);
  assert.throws(() => validateDraft({ ...ok, kind: "Vote" }), /disagree/);
  assert.throws(() => validateDraft({ ...ok, kind: "Vote", params: { kind: "Vote", question: "Q", options: ["only"] } }), /Two to four/);

  const logs = ["Program log: AnchorError occurred. Error Code: TransferLocked. Error Number: 6010. Error Message: Bond transfers are locked during the record window."];
  assert.equal(programErrorMessage(new Error("x"), logs), "Bond transfers are locked during the record window (TransferLocked)");
  assert.match(programErrorMessage(new Error("custom program error: 0x1770")), /\(\w+\)$/);
});

// ---- request guards and the HTTP executor ---------------------------------------------------------

test("guards: rate limit per client and globally", () => {
  const check = createRateLimiter({ windowMs: 1_000, perClient: 2, global: 3 });
  assert.ok(check("a", 0).ok);
  assert.ok(check("a", 1).ok);
  assert.equal(check("a", 2).ok, false);
  assert.ok(check("b", 3).ok);
  assert.equal(check("c", 4).ok, false);
  assert.ok(check("a", 1_500).ok);
});

test("guards: the serial queue runs one task at a time, in order, and survives failures", async () => {
  const enqueue = createSerialQueue(10);
  const log: string[] = [];
  let running = 0;
  const task = (name: string, fail = false) => async () => {
    running += 1;
    assert.equal(running, 1);
    await new Promise((r) => setTimeout(r, 5));
    log.push(name);
    running -= 1;
    if (fail) throw new Error(name);
    return name;
  };
  const results = await Promise.allSettled([enqueue(task("a")), enqueue(task("b", true)), enqueue(task("c"))]);
  assert.deepEqual(log, ["a", "b", "c"]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected", "fulfilled"]);
  const tiny = createSerialQueue(1);
  const first = tiny(task("x"));
  await assert.rejects(tiny(task("y")), (e: unknown) => e instanceof GuardError && e.status === 503);
  await first;
});

test("guards: idempotency returns the first result, rejects reuse with another body, forgets failures", async () => {
  const run = createIdempotencyStore<number>();
  let sends = 0;
  const send = () => Promise.resolve(++sends);
  assert.equal(await run("k1", "body", send), 1);
  assert.equal(await run("k1", "body", send), 1);
  assert.equal(sends, 1);
  await assert.rejects(run("k1", "other", send), (e: unknown) => e instanceof GuardError && e.status === 409);
  await assert.rejects(run("k2", "b", () => Promise.reject(new Error("boom"))));
  assert.equal(await run("k2", "b", send), 2);
});

test("http executor: posts JSON with an idempotency key, reuses it on a network retry, surfaces server errors", async () => {
  const seen: { url: string; key: string | null; body: unknown }[] = [];
  let failOnce = true;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const key = new Headers(init.headers).get("idempotency-key");
    seen.push({ url, key, body: JSON.parse(String(init.body)) });
    if (failOnce) {
      failOnce = false;
      throw new TypeError("network down");
    }
    if (url.endsWith("/settle")) return new Response(JSON.stringify({ error: "Already settled." }), { status: 400 });
    return new Response(JSON.stringify({ signature: "sig", slot: 1, ts: 2 }), { status: 200 });
  }) as typeof fetch;
  const ex = httpExecutor("/api/markets", fetchImpl);
  assert.deepEqual(await ex.pay("A", "H"), { signature: "sig", slot: 1, ts: 2 });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].key, seen[1].key);
  assert.equal(seen[0].url, "/api/markets/pay");
  assert.deepEqual(seen[0].body, { actionId: "A", holder: "H" });
  await assert.rejects(ex.settle("A"), /Already settled/);
});
