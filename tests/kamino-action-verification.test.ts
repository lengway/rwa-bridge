import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertKaminoReceiptIdentity, verifyKaminoTokenDeltas } from "../lib/kamino-action-verification";
import { KAMINO_LEND_DEVNET as route } from "../lib/kamino-lend-devnet-config";

const wallet = "wallet-under-test";
const message = Uint8Array.from([1, 2, 3]);
const receipt = {
  preparedDigest: createHash("sha256").update(message).digest("hex"),
  serializedMessage: message,
  expectedWallet: wallet,
  staticKeys: [wallet, route.market, route.reserve, route.liquidityMint, route.collateralMint, route.supplyVault],
  expectedInstructionDigests: ["instruction-digest"],
  actualInstructionDigests: ["instruction-digest"],
  walletIsSigner: true,
};
const mismatch = { code: "TRANSACTION_MISMATCH" };
const balance = (mint: string, amount: string, owner = wallet) => ({ mint, owner, uiTokenAmount: { amount } });

test("receipt identity requires exact message, pinned accounts, payer, instruction and signer", () => {
  assert.doesNotThrow(() => assertKaminoReceiptIdentity(receipt));
  for (const changed of [
    { serializedMessage: Uint8Array.from([4]) },
    { walletIsSigner: false },
    { staticKeys: receipt.staticKeys.slice(0, -1) },
    { staticKeys: [...receipt.staticKeys.slice(1), wallet] },
    { actualInstructionDigests: ["another-instruction"] },
    { expectedInstructionDigests: [], actualInstructionDigests: [] },
  ]) {
    assert.throws(() => assertKaminoReceiptIdentity({ ...receipt, ...changed }), mismatch);
  }
});

test("deposit deltas are exact even beyond safe-number limits and exclude other owners", () => {
  const amount = "9007199254740993";
  const input = {
    action: "deposit" as const, walletAddress: wallet, amountAtomic: amount, collateralAmountAtomic: null,
    preBalances: [balance(route.liquidityMint, amount)],
    postBalances: [balance(route.liquidityMint, "0"), balance(route.collateralMint, "123"), balance(route.liquidityMint, "999", "other")],
  };
  assert.deepEqual(verifyKaminoTokenDeltas(input), { actualLiquidityAmountAtomic: amount, actualCollateralAmountAtomic: "123" });
  assert.throws(() => verifyKaminoTokenDeltas({ ...input, postBalances: [balance(route.collateralMint, "0")] }), mismatch);
  assert.throws(() => verifyKaminoTokenDeltas({ ...input, postBalances: [balance(route.collateralMint, "123"), balance(route.liquidityMint, "1")] }), mismatch);
  assert.throws(() => verifyKaminoTokenDeltas({ ...input, postBalances: [balance(route.collateralMint, "NaN")] }), mismatch);
});

test("withdrawal requires exact collateral burn and at least the requested proceeds", () => {
  const input = {
    action: "withdraw" as const, walletAddress: wallet, amountAtomic: "100", collateralAmountAtomic: "110",
    preBalances: [balance(route.collateralMint, "110")],
    postBalances: [balance(route.liquidityMint, "101")],
  };
  assert.deepEqual(verifyKaminoTokenDeltas(input), { actualLiquidityAmountAtomic: "101", actualCollateralAmountAtomic: "110" });
  assert.throws(() => verifyKaminoTokenDeltas({ ...input, postBalances: [balance(route.liquidityMint, "99")] }), mismatch);
  assert.throws(() => verifyKaminoTokenDeltas({ ...input, collateralAmountAtomic: null }), mismatch);
  assert.throws(() => verifyKaminoTokenDeltas({ ...input, preBalances: [balance(route.collateralMint, "111")] }), mismatch);
  assert.throws(() => verifyKaminoTokenDeltas({ ...input, postBalances: undefined }), mismatch);
});
