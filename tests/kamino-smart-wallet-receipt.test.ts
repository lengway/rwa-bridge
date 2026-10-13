import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  validateFinalizedSmartWalletReceipt,
  XMSWI_WALLET_WRAPPER_PROGRAM_ID,
  type NormalizedFinalizedRpcReceipt,
  type NormalizedTraceInstruction,
} from "../lib/kamino-smart-wallet-receipt";
import { validateIntent, type CanonicalInstruction } from "../lib/kamino-instruction-intent";
import { KAMINO_LEND_DEVNET as config } from "../lib/kamino-lend-devnet-config";

const wallet = "ACreLvLZcmPgHZHjzUzQWnvLtWHiqENjWNLQ7iqLewcc";
const sponsor = Keypair.generate().publicKey.toBase58();
const tokenProgram = config.liquidityTokenProgram;
const ataProgram = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const systemProgram = "11111111111111111111111111111111";
const instructionsSysvar = "Sysvar1nstructions1111111111111111111111111";
const ata = (mint: string) => getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(wallet), true).toBase58();
const usdcAta = ata(config.liquidityMint);
const cUsdcAta = ata(config.collateralMint);
const signature = bs58.encode(Buffer.alloc(64, 7));
const fee = 5000;

function instruction(programId: string, accounts: string[], data: Uint8Array, stackHeight?: number): NormalizedTraceInstruction {
  return { programId, accounts, dataBase58: bs58.encode(data), ...(stackHeight === undefined ? {} : { stackHeight }) };
}

function encodeU64(value: bigint) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

function kaminoData(action: "deposit" | "withdraw", amount: bigint) {
  const data = Buffer.alloc(16);
  Buffer.from(action === "deposit"
    ? [169, 201, 30, 126, 6, 205, 102, 68]
    : [234, 117, 181, 125, 185, 142, 220, 29]).copy(data);
  data.writeBigUInt64LE(amount, 8);
  return data;
}

function kaminoAccounts(action: "deposit" | "withdraw") {
  return action === "deposit"
    ? [wallet, config.reserve, config.market, config.lendingMarketAuthority, config.liquidityMint, config.supplyVault,
      config.collateralMint, usdcAta, cUsdcAta, tokenProgram, tokenProgram, instructionsSysvar]
    : [wallet, config.market, config.reserve, config.lendingMarketAuthority, config.liquidityMint, config.collateralMint,
      config.supplyVault, cUsdcAta, usdcAta, tokenProgram, tokenProgram, instructionsSysvar];
}

function canonicalKamino(action: "deposit" | "withdraw", amount: bigint): CanonicalInstruction {
  const addresses = kaminoAccounts(action);
  const writable = new Set(action === "deposit" ? [1, 5, 6, 7, 8] : [2, 5, 6, 7, 8]);
  return {
    programId: config.programId,
    accounts: addresses.map((address, index) => ({
      address,
      isSigner: index === 0,
      isWritable: index === 0 || writable.has(index),
    })),
    dataBase58: bs58.encode(kaminoData(action, amount)),
  };
}

function ataCreate(): CanonicalInstruction {
  return {
    programId: ataProgram,
    accounts: [
      { address: sponsor, isSigner: true, isWritable: true },
      { address: cUsdcAta, isSigner: false, isWritable: true },
      { address: wallet, isSigner: false, isWritable: false },
      { address: config.collateralMint, isSigner: false, isWritable: false },
      { address: systemProgram, isSigner: false, isWritable: false },
      { address: tokenProgram, isSigner: false, isWritable: false },
    ],
    dataBase58: bs58.encode(Uint8Array.of(1)),
  };
}

function directTrace(ix: CanonicalInstruction): NormalizedTraceInstruction {
  return instruction(ix.programId, ix.accounts.map((account) => account.address), bs58.decode(ix.dataBase58), 2);
}

function transferChecked(source: string, mint: string, destination: string, authority: string, amount: bigint) {
  const data = Buffer.concat([Buffer.from([12]), encodeU64(amount), Buffer.from([config.decimals])]);
  return instruction(tokenProgram, [source, mint, destination, authority], data, 3);
}

function mintTo(amount: bigint) {
  return instruction(tokenProgram, [config.collateralMint, cUsdcAta, config.lendingMarketAuthority], Buffer.concat([Buffer.from([7]), encodeU64(amount)]), 3);
}

function burn(amount: bigint) {
  return instruction(tokenProgram, [cUsdcAta, config.collateralMint, wallet], Buffer.concat([Buffer.from([8]), encodeU64(amount)]), 3);
}

function systemCreateAta() {
  const data = Buffer.alloc(52);
  data.writeUInt32LE(0, 0);
  data.writeBigUInt64LE(BigInt(2_039_280), 4);
  data.writeBigUInt64LE(BigInt(165), 12);
  new PublicKey(tokenProgram).toBuffer().copy(data, 20);
  return instruction(systemProgram, [sponsor, cUsdcAta], data, 3);
}

function initializeAta() {
  return instruction(tokenProgram, [cUsdcAta, config.collateralMint], Buffer.concat([Buffer.from([18]), new PublicKey(wallet).toBuffer()]), 3);
}

function makeIntent(action: "deposit" | "withdraw", amount: string, collateral: string | null, payload: CanonicalInstruction[]) {
  return validateIntent({
    action,
    walletAddress: wallet,
    amountAtomic: amount,
    collateralAmountAtomic: collateral,
    instructions: payload,
  }, { feePayerAddress: sponsor });
}

function balance(account: string, mint: string, owner: string, amount: string, decimals = 6) {
  const index = accountKeys.indexOf(account);
  return { accountIndex: index, mint, owner, amount, decimals };
}

const accountKeys = [
  sponsor,
  wallet,
  usdcAta,
  cUsdcAta,
  config.supplyVault,
  config.reserve,
  config.market,
  config.lendingMarketAuthority,
  config.liquidityMint,
  config.collateralMint,
  tokenProgram,
  ataProgram,
  systemProgram,
  instructionsSysvar,
  XMSWI_WALLET_WRAPPER_PROGRAM_ID,
];

function baseReceipt({
  topLevelInstructions = [instruction(XMSWI_WALLET_WRAPPER_PROGRAM_ID, [wallet], Uint8Array.of(1))],
  innerInstructions,
  preTokenBalances,
  postTokenBalances,
  preBalances = accountKeys.map(() => 10_000_000),
  postBalances = accountKeys.map(() => 10_000_000),
  metaErr = null,
  receiptSignature = signature,
  feeValue = fee,
}: {
  topLevelInstructions?: NormalizedTraceInstruction[];
  innerInstructions: Array<{ index: number; instructions: NormalizedTraceInstruction[] }>;
  preTokenBalances: Array<{ accountIndex: number; mint: string; owner: string; amount: string; decimals: number }>;
  postTokenBalances: Array<{ accountIndex: number; mint: string; owner: string; amount: string; decimals: number }>;
  preBalances?: number[];
  postBalances?: number[];
  metaErr?: unknown;
  receiptSignature?: string;
  feeValue?: number;
}): NormalizedFinalizedRpcReceipt {
  const afterFee = [...postBalances];
  afterFee[0] = afterFee[0] - feeValue - 2_039_280;
  return {
    commitment: "finalized",
    signature: receiptSignature,
    accountKeys,
    requiredSignerAddresses: [sponsor],
    signatures: [receiptSignature],
    topLevelInstructions,
    meta: {
      err: metaErr,
      fee: feeValue,
      preBalances,
      postBalances: afterFee,
      preTokenBalances,
      postTokenBalances,
      innerInstructions,
    },
  };
}

function depositFixture(overrides: Partial<Parameters<typeof baseReceipt>[0]> = {}) {
  const payload = [ataCreate(), canonicalKamino("deposit", BigInt(500_000))];
  const intent = makeIntent("deposit", "500000", null, payload);
  const trace = [
    directTrace(payload[0]),
    systemCreateAta(),
    initializeAta(),
    directTrace(payload[1]),
    transferChecked(usdcAta, config.liquidityMint, config.supplyVault, wallet, BigInt(500_000)),
    mintTo(BigInt(490_000)),
  ];
  return {
    intent,
    payload,
    receipt: baseReceipt({
      innerInstructions: [{ index: 0, instructions: trace }],
      preTokenBalances: [
        balance(usdcAta, config.liquidityMint, wallet, "1000000"),
        balance(config.supplyVault, config.liquidityMint, config.lendingMarketAuthority, "10000000"),
      ],
      postTokenBalances: [
        balance(usdcAta, config.liquidityMint, wallet, "500000"),
        balance(cUsdcAta, config.collateralMint, wallet, "490000"),
        balance(config.supplyVault, config.liquidityMint, config.lendingMarketAuthority, "10500000"),
      ],
      ...overrides,
    }),
  };
}

function withdrawFixture(overrides: Partial<Parameters<typeof baseReceipt>[0]> = {}) {
  const payload = [canonicalKamino("withdraw", BigInt(500_000))];
  const intent = makeIntent("withdraw", "450000", "500000", payload);
  const trace = [
    directTrace(payload[0]),
    transferChecked(config.supplyVault, config.liquidityMint, usdcAta, config.lendingMarketAuthority, BigInt(500_000)),
    burn(BigInt(500_000)),
  ];
  return {
    intent,
    payload,
    receipt: baseReceipt({
      innerInstructions: [{ index: 0, instructions: trace }],
      preTokenBalances: [
        balance(usdcAta, config.liquidityMint, wallet, "0"),
        balance(cUsdcAta, config.collateralMint, wallet, "600000"),
        balance(config.supplyVault, config.liquidityMint, config.lendingMarketAuthority, "10000000"),
      ],
      postTokenBalances: [
        balance(usdcAta, config.liquidityMint, wallet, "500000"),
        balance(cUsdcAta, config.collateralMint, wallet, "100000"),
        balance(config.supplyVault, config.liquidityMint, config.lendingMarketAuthority, "9500000"),
      ],
      ...overrides,
    }),
  };
}

test("verifies a finalized canonical deposit receipt by CPI trace and exact account deltas", () => {
  const fixture = depositFixture();
  const result = validateFinalizedSmartWalletReceipt({
    intent: fixture.intent,
    expectedDecodedWrapperInstructions: fixture.payload,
    receipt: fixture.receipt,
  });
  assert.deepEqual(result, {
    verified: true,
    signature,
    action: "deposit",
    walletAddress: wallet,
    feePayerAddress: sponsor,
    amountAtomic: "500000",
    actualLiquidityAmountAtomic: "500000",
    actualCollateralAmountAtomic: "490000",
    feeLamports: "5000",
  });
});

test("verifies withdrawal token flow and collateral burn exactly", () => {
  const fixture = withdrawFixture();
  const result = validateFinalizedSmartWalletReceipt({
    intent: fixture.intent,
    expectedDecodedWrapperInstructions: fixture.payload,
    receipt: fixture.receipt,
  });
  assert.equal(result.actualLiquidityAmountAtomic, "500000");
  assert.equal(result.actualCollateralAmountAtomic, "500000");
});

test("rejects transfer amount, reserve vault, token approval, and wrong balance mint", () => {
  const valid = depositFixture();
  const changedAmount = depositFixture();
  changedAmount.receipt.meta.innerInstructions[0].instructions[4] = transferChecked(
    usdcAta, config.liquidityMint, config.supplyVault, wallet, BigInt(499_999),
  );
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: valid.intent,
    expectedDecodedWrapperInstructions: valid.payload,
    receipt: changedAmount.receipt,
  }), /deposit CPI amounts/);

  const wrongVault = depositFixture();
  wrongVault.receipt.meta.innerInstructions[0].instructions[4] = transferChecked(
    usdcAta, config.liquidityMint, config.reserve, wallet, BigInt(500_000),
  );
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: wrongVault.intent,
    expectedDecodedWrapperInstructions: wrongVault.payload,
    receipt: wrongVault.receipt,
  }), /source, mint, destination, or authority/);

  const approval = depositFixture();
  approval.receipt.meta.innerInstructions[0].instructions.splice(5, 0, instruction(tokenProgram, [usdcAta, wallet], Uint8Array.of(4), 3));
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: approval.intent,
    expectedDecodedWrapperInstructions: approval.payload,
    receipt: approval.receipt,
  }), /two-token-call flow/);

  const wrongMint = depositFixture();
  wrongMint.receipt.meta.postTokenBalances[0].mint = config.collateralMint;
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: wrongMint.intent,
    expectedDecodedWrapperInstructions: wrongMint.payload,
    receipt: wrongMint.receipt,
  }), /token balance identity/);
});

test("rejects unsponsored wallet signatures, failed transactions and missing metadata", () => {
  const signer = depositFixture();
  signer.receipt.requiredSignerAddresses = [sponsor, wallet];
  signer.receipt.signatures = [signature, signature];
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: signer.intent,
    expectedDecodedWrapperInstructions: signer.payload,
    receipt: signer.receipt,
  }), /must not sign/);

  const failed = depositFixture({ metaErr: { InstructionError: [1, "Custom"] } });
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: failed.intent,
    expectedDecodedWrapperInstructions: failed.payload,
    receipt: failed.receipt,
  }), /failed/);

  const missingMeta = depositFixture();
  const receiptWithoutMeta = { ...missingMeta.receipt, meta: undefined } as unknown as NormalizedFinalizedRpcReceipt;
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: missingMeta.intent,
    expectedDecodedWrapperInstructions: missingMeta.payload,
    receipt: receiptWithoutMeta,
  }), /metadata is required/);
});

test("rejects unverified CPI stack shapes and smart-wallet lamport charges", () => {
  const unsupported = depositFixture();
  unsupported.receipt.meta.innerInstructions[0].instructions[2].stackHeight = 4;
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: unsupported.intent,
    expectedDecodedWrapperInstructions: unsupported.payload,
    receipt: unsupported.receipt,
  }), /unsupported or missing CPI stack height/);

  const walletCharged = depositFixture();
  const walletIndex = accountKeys.indexOf(wallet);
  walletCharged.receipt.meta.postBalances[walletIndex] -= 1;
  assert.throws(() => validateFinalizedSmartWalletReceipt({
    intent: walletCharged.intent,
    expectedDecodedWrapperInstructions: walletCharged.payload,
    receipt: walletCharged.receipt,
  }), /lamports changed/);
});
