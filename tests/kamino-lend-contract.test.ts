import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import {
  decimalToAtomic,
  formatAtomicAmount,
  normalizeKaminoLendConfirmation,
  normalizeKaminoLendMarket,
  normalizePreparedKaminoLendAction,
  preparedActionMatchesMarket,
} from "../components/app/kamino-lend-contract";

const MARKET = "11111111111111111111111111111111";
const RESERVE = "22222222222222222222222222222222";
const MINT = "33333333333333333333333333333333";
const BLOCKHASH = "44444444444444444444444444444444";
const SIGNATURE = bs58.encode(new Uint8Array(64).fill(5));

test("a ready Devnet Kamino market requires verified market and reserve metadata", () => {
  const market = normalizeKaminoLendMarket({
    ready: true,
    configured: true,
    network: "devnet",
    market: { address: MARKET, name: "Kamino Lend" },
    reserve: {
      address: RESERVE,
      mint: MINT,
      collateralMint: BLOCKHASH,
      decimals: 6,
      availableLiquidityAtomic: "2500000",
    },
    limits: { maxAmountAtomic: "1000000000" },
  });

  assert.deepEqual(market, {
    ready: true,
    network: "devnet",
    reason: null,
    market: { address: MARKET, name: "Kamino Lend" },
    reserve: {
      address: RESERVE,
      mint: MINT,
      collateralMint: BLOCKHASH,
      decimals: 6,
      maximumAmountAtomic: "1000000000",
      availableLiquidityAtomic: "2500000",
    },
  });
  assert.equal(normalizeKaminoLendMarket({ ready: true, configured: true, network: "mainnet-beta" }), null);
  assert.equal(normalizeKaminoLendMarket({ ready: true, configured: true, network: "devnet", market: MARKET }), null);
});

test("an unavailable Devnet route remains displayable but cannot expose transaction metadata", () => {
  assert.deepEqual(normalizeKaminoLendMarket({
    ready: false,
    configured: false,
    network: "devnet",
    reason: "Reserve maintenance",
  }), {
    ready: false,
    network: "devnet",
    reason: "Reserve maintenance",
    market: null,
    reserve: null,
  });
});

test("a prepared action needs a passing simulation and exact atomic route details", () => {
  const prepared = normalizePreparedKaminoLendAction({
    action: "deposit",
    actionId: "lend_deposit_01",
    network: "devnet",
    serializedTransaction: "4Q3B6ov5y6x5eN3E8bRmn3",
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 123,
    expiresAt: 1000,
    transactionMessageDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    market: MARKET,
    reserve: RESERVE,
    amountAtomic: "1250000",
    simulation: { ok: true, err: null, unitsConsumed: 45678 },
  }, "deposit");

  assert.ok(prepared);
  const market = normalizeKaminoLendMarket({
    ready: true,
    configured: true,
    network: "devnet",
    market: { address: MARKET },
    reserve: { address: RESERVE, mint: MINT, collateralMint: BLOCKHASH, decimals: 6 },
  });
  assert.ok(market);
  assert.equal(preparedActionMatchesMarket(prepared, market, "1250000"), true);
  assert.equal(preparedActionMatchesMarket(prepared, market, "1250001"), false);

  assert.equal(normalizePreparedKaminoLendAction({
    action: "deposit",
    actionId: "lend_deposit_01",
    network: "devnet",
    serializedTransaction: "4Q3B6ov5y6x5eN3E8bRmn3",
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 123,
    expiresAt: 1000,
    transactionMessageDigest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    market: MARKET,
    reserve: RESERVE,
    amountAtomic: "1250000",
    simulation: { ok: false, err: null, unitsConsumed: 45678 },
  }, "deposit"), null);
});

test("the drawer can only report success after matching API confirmation", () => {
  const confirmation = normalizeKaminoLendConfirmation({
    action: "deposit",
    actionId: "lend_deposit_01",
    network: "devnet",
    confirmed: true,
    status: "COMPLETED",
    signature: SIGNATURE,
  }, "deposit", "lend_deposit_01", SIGNATURE);

  assert.equal(confirmation?.confirmed, true);
  assert.match(confirmation?.explorerUrl ?? "", /cluster=devnet/);
  const complete = { action: "deposit", actionId: "lend_deposit_01", network: "devnet", confirmed: true, status: "COMPLETED", signature: SIGNATURE, actualLiquidityAmountAtomic: "100001" };
  assert.equal(normalizeKaminoLendConfirmation(complete, "deposit", "lend_deposit_01", SIGNATURE)?.actualLiquidityAmountAtomic, "100001");
  assert.equal(normalizeKaminoLendConfirmation({ ...complete, signature: undefined }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({ ...complete, signature: "invalid" }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({ ...complete, signature: bs58.encode(new Uint8Array(64).fill(6)) }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({ ...complete, signature: MINT }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({ ...complete, actualLiquidityAmountAtomic: "0" }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({
    action: "deposit",
    actionId: "lend_deposit_01",
    network: "devnet",
    confirmed: false,
    status: "COMPLETED",
    signature: SIGNATURE,
  }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({
    action: "deposit",
    actionId: "lend_deposit_01",
    network: "devnet",
    confirmed: true,
    status: "PENDING",
    signature: SIGNATURE,
  }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({
    action: "withdraw",
    actionId: "lend_deposit_01",
    network: "devnet",
    confirmed: true,
    signature: SIGNATURE,
  }, "deposit", "lend_deposit_01", SIGNATURE), null);
  assert.equal(normalizeKaminoLendConfirmation({
    action: "deposit",
    actionId: "another_action",
    network: "devnet",
    confirmed: true,
    signature: SIGNATURE,
  }, "deposit", "lend_deposit_01", SIGNATURE), null);
});

test("decimal input stays exact and never uses floating point atomic conversion", () => {
  assert.equal(decimalToAtomic("1.25", 6), "1250000");
  assert.equal(decimalToAtomic("9007199254740993.123456", 6), "9007199254740993123456");
  assert.equal(decimalToAtomic("1", 0), "1");
  assert.equal(decimalToAtomic("0", 6), null);
  assert.equal(decimalToAtomic("1.0000001", 6), null);
  assert.equal(decimalToAtomic("01", 6), null);
  assert.equal(formatAtomicAmount("9007199254740993123456", 6), "9 007 199 254 740 993.123456");
});
