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
    for (const [holder, proof] of Object.entries(t.proofs as Record<string, string[]>)) {
      assert.deepEqual(tree.proof(holder).map(toHex), proof, `${t.name} proof ${holder}`);
      const units = tree.holdingOf(holder)!.units;
      assert.ok(verifyProof(leafHash(t.action, holder, units), proof.map(fromHex), tree.root));
      assert.ok(!verifyProof(leafHash(t.action, holder, units + 1n), proof.map(fromHex), tree.root));
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
  assert.throws(() => buildSnapshotTree(a, [{ holder: b, units: 1n }, { holder: b, units: 2n }]), /duplicate/);
  assert.throws(() => buildSnapshotTree(a, [{ holder: b, units: 0n }]), /invalid units/);
  const merged = aggregateHoldings([
    { owner: b, amount: 3n },
    { owner: a, amount: 0n },
    { owner: b, amount: 2n },
  ]);
  assert.deepEqual(merged, [{ holder: b, units: 5n }]);
});

test("totals reconcile with on-chain formulas for every action kind", () => {
  const instrument = { faceValue: 1_000_000_000n, couponBps: 1250, frequency: 2 };
  const holdings = [
    { holder: "A", units: 50n },
    { holder: "B", units: 30n },
    { holder: "C", units: 20n },
  ];
  const coupon = actionTotals(instrument, { kind: "Coupon", rateBps: 0, redeemBps: 0, priceBps: 0 }, holdings);
  assert.equal(coupon.perUnit, 62_500_000n);
  assert.equal(coupon.totalEntitlement, 100n * 62_500_000n);

  const partial = actionTotals(instrument, { kind: "PartialRedemption", rateBps: 0, redeemBps: 3333, priceBps: 10_000 }, holdings);
  assert.equal(partial.totalRedeemUnits, 16n + 9n + 6n);
  const [min, max] = partialRedeemBounds(100n, 3333, 3);
  assert.deepEqual([min, max], [31n, 33n]);
  assert.equal(partial.totalEntitlement, 31n * 1_000_000_000n);

  const fin = { kind: "FinalRedemption" as const, rateBps: 1250, redeemBps: 0, priceBps: 10_000 };
  assert.equal(amountPerUnit(instrument, fin), 1_062_500_000n);
  assert.deepEqual(entitlementFor("FinalRedemption", 1_062_500_000n, 0, 20n), { amount: 21_250_000_000n, burnUnits: 20n, weight: 0n });
  assert.deepEqual(entitlementFor("Vote", 0n, 0, 7n), { amount: 0n, burnUnits: 0n, weight: 7n });
});
