import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  validateIntent,
  type CanonicalInstruction,
  type CanonicalInstructionAccount,
  type InstructionIntentInput,
} from "../lib/kamino-instruction-intent";
import { KAMINO_LEND_DEVNET as config } from "../lib/kamino-lend-devnet-config";

const wallet = "7cSu6RcZNygXoDfVYaPpXazNB4XXaz6A2DAU1PDG4e6C";
const feePayer = wallet;
const ataProgram = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const systemProgram = "11111111111111111111111111111111";
const instructionsSysvar = "Sysvar1nstructions1111111111111111111111111";
const computeBudget = "ComputeBudget111111111111111111111111111111";
const depositDiscriminator = [169, 201, 30, 126, 6, 205, 102, 68];
const withdrawDiscriminator = [234, 117, 181, 125, 185, 142, 220, 29];
const ownerKey = new PublicKey(wallet);
const userUsdc = getAssociatedTokenAddressSync(new PublicKey(config.liquidityMint), ownerKey, true).toBase58();
const userCUsdc = getAssociatedTokenAddressSync(new PublicKey(config.collateralMint), ownerKey, true).toBase58();

const account = (address: string, isSigner = false, isWritable = false): CanonicalInstructionAccount => ({
  address,
  isSigner,
  isWritable,
});

function u64Instruction(
  action: "deposit" | "withdraw",
  amount: bigint,
  accounts?: CanonicalInstructionAccount[],
): CanonicalInstruction {
  const buffer = Buffer.alloc(16);
  Buffer.from(action === "deposit" ? depositDiscriminator : withdrawDiscriminator).copy(buffer);
  buffer.writeBigUInt64LE(amount, 8);
  return {
    programId: config.programId,
    accounts: accounts ?? kaminoAccounts(action),
    dataBase58: bs58.encode(buffer),
  };
}

function kaminoAccounts(action: "deposit" | "withdraw"): CanonicalInstructionAccount[] {
  const writable = (address: string) => account(address, false, true);
  const readonly = (address: string) => account(address);
  if (action === "deposit") {
    return [
      account(wallet, true, true),
      writable(config.reserve),
      readonly(config.market),
      readonly(config.lendingMarketAuthority),
      readonly(config.liquidityMint),
      writable(config.supplyVault),
      writable(config.collateralMint),
      writable(userUsdc),
      writable(userCUsdc),
      readonly(config.liquidityTokenProgram),
      readonly(config.liquidityTokenProgram),
      readonly(instructionsSysvar),
    ];
  }
  return [
    account(wallet, true, true),
    readonly(config.market),
    writable(config.reserve),
    readonly(config.lendingMarketAuthority),
    readonly(config.liquidityMint),
    writable(config.collateralMint),
    writable(config.supplyVault),
    writable(userCUsdc),
    writable(userUsdc),
    readonly(config.liquidityTokenProgram),
    readonly(config.liquidityTokenProgram),
    readonly(instructionsSysvar),
  ];
}

function ataCreate(target: string, mint: string, payer = feePayer, ownerAddress = wallet): CanonicalInstruction {
  return {
    programId: ataProgram,
    accounts: [
      account(payer, true, true),
      account(target, false, true),
      account(ownerAddress),
      account(mint),
      account(systemProgram),
      account(config.liquidityTokenProgram),
    ],
    dataBase58: bs58.encode(Uint8Array.of(1)),
  };
}

function setCuLimit(units: number): CanonicalInstruction {
  const data = Buffer.alloc(5);
  data[0] = 2;
  data.writeUInt32LE(units, 1);
  return { programId: computeBudget, accounts: [], dataBase58: bs58.encode(data) };
}

function setCuPrice(microLamports: bigint): CanonicalInstruction {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(microLamports, 1);
  return { programId: computeBudget, accounts: [], dataBase58: bs58.encode(data) };
}

function deposit(instructions: CanonicalInstruction[] = [u64Instruction("deposit", BigInt(500_000))]): InstructionIntentInput {
  return {
    action: "deposit",
    walletAddress: wallet,
    amountAtomic: "500000",
    collateralAmountAtomic: null,
    instructions,
  };
}

test("accepts the canonical deposit layout and off-curve-safe ATA derivation", () => {
  const [pdaWallet] = PublicKey.findProgramAddressSync([Buffer.from("wallet-fixture")], TOKEN_PROGRAM_ID);
  const originalWallet = wallet;
  const ataFor = (mint: string) => getAssociatedTokenAddressSync(new PublicKey(mint), pdaWallet, true).toBase58();
  const usdcAta = ataFor(config.liquidityMint);
  const cUsdcAta = ataFor(config.collateralMint);
  const [depositIx] = [u64Instruction("deposit", BigInt(500_000), kaminoAccounts("deposit").map((meta, index) =>
    index === 0 ? account(pdaWallet.toBase58(), true, true)
      : index === 7 ? account(usdcAta, false, true)
        : index === 8 ? account(cUsdcAta, false, true)
          : meta,
  ))];
  const result = validateIntent({
    ...deposit([ataCreate(cUsdcAta, config.collateralMint, pdaWallet.toBase58(), pdaWallet.toBase58()), depositIx]),
    walletAddress: pdaWallet.toBase58(),
  });
  assert.equal(result.walletAddress, pdaWallet.toBase58());
  assert.equal(result.liquidityTokenAccount, usdcAta);
  assert.equal(result.collateralTokenAccount, cUsdcAta);
  assert.equal(result.computeUnitLimit, null);
  assert.equal(result.computeUnitPriceMicroLamports, "0");
  assert.equal(originalWallet, wallet);
});

test("accepts canonical instructions and optional ATAs in the required order", () => {
  const result = validateIntent(deposit([
    setCuLimit(300_000),
    ataCreate(userUsdc, config.liquidityMint),
    ataCreate(userCUsdc, config.collateralMint),
    u64Instruction("deposit", BigInt(500_000)),
  ]));
  assert.equal(result.amountAtomic, "500000");
  assert.equal(result.computeUnitLimit, 300_000);
});

test("rejects changed amount, wrong vault, swapped mint accounts and extra instructions", () => {
  const valid = deposit();
  const changedAmount = u64Instruction("deposit", BigInt(500_001));
  const wrongVaultAccounts = kaminoAccounts("deposit");
  wrongVaultAccounts[5] = account(config.market, false, true);
  const swappedMintAccounts = kaminoAccounts("deposit");
  swappedMintAccounts[4] = account(config.collateralMint);
  assert.throws(() => validateIntent({ ...valid, instructions: [changedAmount] }), /amount does not match/);
  assert.throws(() => validateIntent({ ...valid, instructions: [u64Instruction("deposit", BigInt(500_000), wrongVaultAccounts)] }), /canonical/);
  assert.throws(() => validateIntent({ ...valid, instructions: [u64Instruction("deposit", BigInt(500_000), swappedMintAccounts)] }), /canonical/);
  assert.throws(() => validateIntent({ ...valid, instructions: [
    { programId: systemProgram, accounts: [], dataBase58: bs58.encode(Uint8Array.of(0)) },
    u64Instruction("deposit", BigInt(500_000)),
  ] }), /not allowed/);
});

test("withdrawal validates redeem discriminator and exact collateral arguments", () => {
  const valid: InstructionIntentInput = {
    action: "withdraw",
    walletAddress: wallet,
    amountAtomic: "420000",
    collateralAmountAtomic: "450000",
    instructions: [u64Instruction("withdraw", BigInt(450_000))],
  };
  assert.equal(validateIntent(valid).collateralAmountAtomic, "450000");
  assert.throws(() => validateIntent({
    ...valid,
    instructions: [u64Instruction("withdraw", BigInt(450_001))],
  }), /amount does not match/);
  assert.throws(() => validateIntent({ ...valid, collateralAmountAtomic: null }), /collateralAmountAtomic/);
  assert.throws(() => validateIntent({ ...valid, instructions: [u64Instruction("deposit", BigInt(450_000))] }), /discriminator/);
});

test("ATA creation is idempotent-only, canonical and funded by the expected fee payer", () => {
  const wrongPayer = ataCreate(userCUsdc, config.collateralMint, config.reserve);
  const nonIdempotent = { ...ataCreate(userCUsdc, config.collateralMint), dataBase58: bs58.encode(Uint8Array.of(0)) };
  const wrongAtaOwner = ataCreate(userCUsdc, config.collateralMint);
  wrongAtaOwner.accounts[2] = account(config.reserve);
  assert.throws(() => validateIntent(deposit([wrongPayer, u64Instruction("deposit", BigInt(500_000))])), /fee payer/);
  assert.throws(() => validateIntent(deposit([nonIdempotent, u64Instruction("deposit", BigInt(500_000))])), /idempotent/);
  assert.throws(() => validateIntent(deposit([wrongAtaOwner, u64Instruction("deposit", BigInt(500_000))])), /ATA owner/);
  assert.throws(() => validateIntent(deposit([ataCreate(config.reserve, config.liquidityMint), u64Instruction("deposit", BigInt(500_000))])), /canonical wallet/);
});

test("a sponsored fee payer is accepted only when explicitly expected for ATA creation", () => {
  const sponsor = config.supplyVault;
  const input = {
    ...deposit([ataCreate(userCUsdc, config.collateralMint, sponsor), u64Instruction("deposit", BigInt(500_000))]),
  };
  assert.equal(validateIntent(input, { feePayerAddress: sponsor }).feePayerAddress, sponsor);
  assert.throws(() => validateIntent(input, { feePayerAddress: wallet }), /fee payer/);
});

test("compute budget accepts exact bounded opcodes and defaults to zero priority fee", () => {
  const valid = deposit([setCuLimit(250_000), setCuPrice(BigInt(200_000)), u64Instruction("deposit", BigInt(500_000))]);
  assert.throws(() => validateIntent(valid), /priority fee/);
  assert.equal(validateIntent(valid, { maxPriorityFeeLamports: "50000" }).computeUnitPriceMicroLamports, "200000");
  assert.throws(() => validateIntent(
    deposit([setCuLimit(300_001), u64Instruction("deposit", BigInt(500_000))]),
    { maxPriorityFeeLamports: "50000" },
  ), /compute unit limit/);
  assert.throws(() => validateIntent(
    deposit([setCuPrice(BigInt(1)), setCuPrice(BigInt(1)), u64Instruction("deposit", BigInt(500_000))]),
    { maxPriorityFeeLamports: "1" },
  ), /duplicate SetComputeUnitPrice/);
  const malformed = { ...setCuLimit(10), dataBase58: bs58.encode(Uint8Array.of(2, 10)) };
  assert.throws(() => validateIntent(
    deposit([malformed, u64Instruction("deposit", BigInt(500_000))]),
    { maxPriorityFeeLamports: "1" },
  ), /exact 5-byte/);
});
