import assert from "node:assert/strict";
import test from "node:test";
import { isDevnetWalletKey } from "../lib/wallet-config";

test("only a staging Crossmint client key enables the Devnet wallet bridge", () => {
  assert.equal(isDevnetWalletKey("ck_staging_test-key_123"), true);
  for (const value of [undefined, null, "", "ck_staging_", "ck_production_test", "sk_staging_test", " ck_staging_test", "ck_staging_test\n"]) {
    assert.equal(isDevnetWalletKey(value), false);
  }
});
