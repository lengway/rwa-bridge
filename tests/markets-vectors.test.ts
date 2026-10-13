import assert from "node:assert/strict";
import test from "node:test";

import vectors from "../lib/markets/test-vectors.json";
import {
  actionTotals,
  amountPerUnit,
  couponPerUnit,
  entitlementFor,
  finalPerUnit,
  partialRedeemBounds,
  partialRedeemUnits,
  pricePerUnit,
} from "../lib/markets/entitlements";
import {
  aggregateHoldings,
  buildSnapshotTree,
  canonicalSnapshotJson,
  fromHex,
  leafHash,
  nodeHash,
  parseCanonicalSnapshot,
  snapshotHash,
  toHex,
  verifyProof,
} from "../lib/markets/merkle";

const orNull = (f: () => bigint) => {
  try {
    return f().toString();
  } catch {
    return null;
  }
};

// The same file is asserted by the Rust program tests (programs/plain-markets/.../tests/vectors.rs).

test("per-unit amounts match shared vectors", () => {
  for (const c of vectors.coupon) assert.equal(orNull(() => couponPerUnit(BigInt(c.face), c.rateBps, c.frequency)), c.perUnit);
  for (const c of vectors.price) assert.equal(orNull(() => pricePerUnit(BigInt(c.face), c.priceBps)), c.perUnit);
  for (const c of vectors.final)
    assert.equal(orNull(() => finalPerUnit(BigInt(c.face), c.priceBps, c.rateBps, c.frequency)), c.perUnit);
  for (const c of vectors.partial) assert.equal(orNull(() => partialRedeemUnits(BigInt(c.units), c.redeemBps)), c.redeemUnits);
});

test("merkle trees, proofs and snapshot hashes match shared vectors", () => {
  for (const c of vectors.nodes) assert.equal(toHex(nodeHash(fromHex(c.a), fromHex(c.b))), c.hash);
  for (const t of vectors.trees) {
    const tree = buildSnapshotTree(
      t.action,
      t.holdings.map((h) => ({ holder: h.holder, units: BigInt(h.units) })),
    );
    assert.deepEqual(
      tree.holdings.map((h) => h.holder),
      t.sortedHolders,
      `${t.name} ordering`,
    );
    assert.deepEqual(tree.leaves.map(toHex), t.leaves, `${t.name} leaves`);
    assert.equal(toHex(tree.root), t.root, `${t.name} root`);
    assert.equal(tree.totalUnits.toString(), t.totalUnits);
    for (const [holder, proof] of Object.entries(t.proofs as unknown as Record<string, string[]>)) {
      assert.deepEqual(tree.proof(holder).map(toHex), proof, `${t.name} proof ${holder}`);
      const units = tree.holdingOf(holder)!.units;
      assert.ok(verifyProof(leafHash(t.action, holder, units), proof.map(fromHex), tree.root));
      assert.ok(!verifyProof(leafHash(t.action, holder, units + BigInt(1)), proof.map(fromHex), tree.root));
    }
    const snap = parseCanonicalSnapshot(t.snapshot.json);
    assert.equal(canonicalSnapshotJson(snap), t.snapshot.json);
    assert.equal(toHex(snapshotHash(snap)), t.snapshot.sha256);
  }
});

test("a proof from another action never verifies", () => {
  const t = vectors.trees[2];
  const holdings = t.holdings.map((h) => ({ holder: h.holder, units: BigInt(h.units) }));
  const other = buildSnapshotTree(vectors.trees[0].action, holdings);
  const holder = holdings[0].holder;
  assert.ok(!verifyProof(leafHash(t.action, holder, holdings[0].units), other.proof(holder), fromHex(t.root)));
});

test("snapshot builder rejects duplicates and empty holdings; aggregator merges token accounts", () => {
  const a = vectors.trees[1].holdings[0].holder;
  const b = vectors.trees[1].holdings[1].holder;
  assert.throws(() => buildSnapshotTree(a, []));
  assert.throws(() => buildSnapshotTree(a, [{ holder: b, units: BigInt(1) }, { holder: b, units: BigInt(2) }]), /duplicate/);
  assert.throws(() => buildSnapshotTree(a, [{ holder: b, units: BigInt(0) }]), /invalid units/);
  const merged = aggregateHoldings([
    { owner: b, amount: BigInt(3) },
    { owner: a, amount: BigInt(0) },
    { owner: b, amount: BigInt(2) },
  ]);
  assert.deepEqual(merged, [{ holder: b, units: BigInt(5) }]);
});

test("totals reconcile with on-chain formulas for every action kind", () => {
  const instrument = { faceValue: BigInt(1_000_000_000), couponBps: 1250, frequency: 2 };
  const holdings = [
    { holder: "A", units: BigInt(50) },
    { holder: "B", units: BigInt(30) },
    { holder: "C", units: BigInt(20) },
  ];
  const coupon = actionTotals(instrument, { kind: "Coupon", rateBps: 0, redeemBps: 0, priceBps: 0 }, holdings);
  assert.equal(coupon.perUnit, BigInt(62_500_000));
  assert.equal(coupon.totalEntitlement, BigInt(100) * BigInt(62_500_000));

  const partial = actionTotals(instrument, { kind: "PartialRedemption", rateBps: 0, redeemBps: 3333, priceBps: 10_000 }, holdings);
  assert.equal(partial.totalRedeemUnits, BigInt(16) + BigInt(9) + BigInt(6));
  const [min, max] = partialRedeemBounds(BigInt(100), 3333, 3);
  assert.deepEqual([min, max], [BigInt(31), BigInt(33)]);
  assert.equal(partial.totalEntitlement, BigInt(31) * BigInt(1_000_000_000));

  const fin = { kind: "FinalRedemption" as const, rateBps: 1250, redeemBps: 0, priceBps: 10_000 };
  assert.equal(amountPerUnit(instrument, fin), BigInt(1_062_500_000));
  assert.deepEqual(entitlementFor("FinalRedemption", BigInt(1_062_500_000), 0, BigInt(20)), { amount: BigInt(21_250_000_000), burnUnits: BigInt(20), weight: BigInt(0) });
  assert.deepEqual(entitlementFor("Vote", BigInt(0), 0, BigInt(7)), { amount: BigInt(0), burnUnits: BigInt(0), weight: BigInt(7) });
});
