import assert from "node:assert/strict";
import test from "node:test";
import {
  KAMINO_LEND_DEVNET,
  KaminoLendDevnetError,
  isKaminoLendDevnetCluster,
  parseKaminoLendAtomicAmount,
} from "../lib/kamino-lend-devnet-config";

test("Kamino Lend is permanently pinned to the intended Devnet program and reserve", () => {
  assert.equal(KAMINO_LEND_DEVNET.network, "devnet");
  assert.equal(KAMINO_LEND_DEVNET.programId, "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
  assert.equal(KAMINO_LEND_DEVNET.market, "8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa");
  assert.equal(KAMINO_LEND_DEVNET.reserve, "8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn");
  assert.equal(KAMINO_LEND_DEVNET.liquidityMint, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  assert.equal(KAMINO_LEND_DEVNET.collateralMint, "6Txtcxf78FxjpDxc31jAnfXzaRFECr26DNt8CNim2wb7");
});

test("atomic inputs and requested cluster fail closed", () => {
  assert.equal(parseKaminoLendAtomicAmount("1"), BigInt(1));
  assert.equal(parseKaminoLendAtomicAmount("1000000"), BigInt(1_000_000));
  assert.equal(isKaminoLendDevnetCluster(undefined), true);
  assert.equal(isKaminoLendDevnetCluster("devnet"), true);
  assert.equal(isKaminoLendDevnetCluster("mainnet-beta"), false);

  for (const input of ["0", "01", "1.0", "-1", 1, null]) {
    assert.throws(
      () => parseKaminoLendAtomicAmount(input),
      (cause: unknown) => cause instanceof KaminoLendDevnetError && cause.code === "INVALID_AMOUNT",
    );
  }
});
