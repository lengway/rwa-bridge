import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@solana/web3.js";

import { GuardError, createIdempotencyStore, createRateLimiter, createSerialQueue } from "../lib/markets/api-guard";
import { replayBalances } from "../lib/markets/chain-history";
import { IssuerError, demoHolderKeypair, parseSecretKey, programErrorMessage, validateDraft } from "../lib/markets/devnet-issuer";
import { httpExecutor } from "../lib/markets/devnet-service";
import { snapshotHash } from "../lib/markets/merkle";
import { parseSnapshotMemo, parseTermsMemo, snapshotFromMemo, snapshotInlineMemo, termsHash, termsJson, termsMemo, type TermsDocument } from "../lib/markets/publication";
import type { ActionDraft } from "../lib/markets/service";
import { parseMemoField } from "../lib/markets/signature-feed";

import { memoField, settledCouponFixture } from "./helpers/markets-fixture";

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
