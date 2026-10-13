import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  KAMINO_LEND_DEVNET,
  type KaminoLendAction,
} from "./kamino-lend-devnet-config";

const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const INSTRUCTIONS_SYSVAR_ID = "Sysvar1nstructions1111111111111111111111111";
const MAX_COMPUTE_UNITS = 300_000;
const MAX_PRIORITY_FEE_LAMPORTS = BigInt(50_000);
const MICRO_LAMPORTS_PER_LAMPORT = BigInt(1_000_000);
const MAX_U64 = (BigInt(1) << BigInt(64)) - BigInt(1);

const KAMINO_DISCRIMINATORS = {
  deposit: Uint8Array.from([169, 201, 30, 126, 6, 205, 102, 68]),
  withdraw: Uint8Array.from([234, 117, 181, 125, 185, 142, 220, 29]),
} as const;

export type CanonicalInstructionAccount = {
  address: string;
  isSigner: boolean;
  isWritable: boolean;
};

export type CanonicalInstruction = {
  programId: string;
  accounts: CanonicalInstructionAccount[];
  dataBase58: string;
};

export type InstructionIntentInput = {
  action: KaminoLendAction;
  walletAddress: string;
  amountAtomic: string;
  collateralAmountAtomic: string | null;
  instructions: CanonicalInstruction[];
};

export type InstructionIntentPolicy = {
  /** Trusted expected transaction fee payer. Defaults to the wallet. */
  feePayerAddress?: string;
  /** Trusted server cap. Omitted means priority fees are disabled. */
  maxPriorityFeeLamports?: string;
};

export type ValidatedInstructionIntent = {
  action: KaminoLendAction;
  walletAddress: string;
  feePayerAddress: string;
  amountAtomic: string;
  collateralAmountAtomic: string | null;
  liquidityTokenAccount: string;
  collateralTokenAccount: string;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: string;
};

function invalid(message: string): never {
  throw new Error(`INVALID_INSTRUCTION_INTENT: ${message}`);
}

function canonicalAddress(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a base58 address.`);
  try {
    const address = new PublicKey(value).toBase58();
    if (address !== value) invalid(`${label} must be canonical base58.`);
    return address;
  } catch {
    return invalid(`${label} must be a valid Solana address.`);
  }
}

function atomicU64(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    invalid(`${label} must be a positive atomic integer string.`);
  }
  const amount = BigInt(value);
  if (amount > MAX_U64) invalid(`${label} exceeds u64.`);
  return amount;
}

export function normalizeIntentInstruction(value: unknown): CanonicalInstruction {
  if (!value || typeof value !== "object") invalid("instruction must be an object.");
  const source = value as Record<string, unknown>;
  const programId = canonicalAddress(source.programId, "programId");
  const dataBase58 = source.dataBase58;
  if (typeof dataBase58 !== "string" || dataBase58.length === 0) {
    invalid("instruction data must be base58.");
  }
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(dataBase58);
  } catch {
    return invalid("instruction data must be valid base58.");
  }
  if (bs58.encode(decoded) !== dataBase58) invalid("instruction data must use canonical base58.");
  if (!Array.isArray(source.accounts)) invalid("instruction accounts must be an array.");
  const accounts = source.accounts.map((account, index) => {
    if (!account || typeof account !== "object") invalid(`account ${index} must be an object.`);
    const item = account as Record<string, unknown>;
    if (typeof item.isSigner !== "boolean" || typeof item.isWritable !== "boolean") {
      invalid(`account ${index} must include signer and writable flags.`);
    }
    return {
      address: canonicalAddress(item.address, `account ${index} address`),
      isSigner: item.isSigner,
      isWritable: item.isWritable,
    };
  });
  return { programId, accounts, dataBase58 };
}

function meta(address: string, isSigner = false, isWritable = false): CanonicalInstructionAccount {
  return { address, isSigner, isWritable };
}

function ata(owner: PublicKey, mint: string) {
  return getAssociatedTokenAddressSync(
    new PublicKey(mint),
    owner,
    true,
    TOKEN_PROGRAM_ID,
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  ).toBase58();
}

function expectedKaminoAccounts(
  action: KaminoLendAction,
  walletAddress: string,
  liquidityTokenAccount: string,
  collateralTokenAccount: string,
): CanonicalInstructionAccount[] {
  const wallet = meta(walletAddress, true, true);
  const writable = (address: string) => meta(address, false, true);
  const readonly = (address: string) => meta(address);
  if (action === "deposit") {
    return [
      wallet,
      writable(KAMINO_LEND_DEVNET.reserve),
      readonly(KAMINO_LEND_DEVNET.market),
      readonly(KAMINO_LEND_DEVNET.lendingMarketAuthority),
      readonly(KAMINO_LEND_DEVNET.liquidityMint),
      writable(KAMINO_LEND_DEVNET.supplyVault),
      writable(KAMINO_LEND_DEVNET.collateralMint),
      writable(liquidityTokenAccount),
      writable(collateralTokenAccount),
      readonly(KAMINO_LEND_DEVNET.liquidityTokenProgram),
      readonly(KAMINO_LEND_DEVNET.liquidityTokenProgram),
      readonly(INSTRUCTIONS_SYSVAR_ID),
    ];
  }
  return [
    wallet,
    readonly(KAMINO_LEND_DEVNET.market),
    writable(KAMINO_LEND_DEVNET.reserve),
    readonly(KAMINO_LEND_DEVNET.lendingMarketAuthority),
    readonly(KAMINO_LEND_DEVNET.liquidityMint),
    writable(KAMINO_LEND_DEVNET.collateralMint),
    writable(KAMINO_LEND_DEVNET.supplyVault),
    writable(collateralTokenAccount),
    writable(liquidityTokenAccount),
    readonly(KAMINO_LEND_DEVNET.liquidityTokenProgram),
    readonly(KAMINO_LEND_DEVNET.liquidityTokenProgram),
    readonly(INSTRUCTIONS_SYSVAR_ID),
  ];
}

function assertSameAccounts(
  actual: CanonicalInstructionAccount[],
  expected: CanonicalInstructionAccount[],
  label: string,
) {
  if (actual.length !== expected.length) invalid(`${label} must have exactly ${expected.length} accounts.`);
  for (let index = 0; index < expected.length; index += 1) {
    const a = actual[index];
    const e = expected[index];
    // Kamino declares the owner as a signer; whether the builder also marks it writable
    // varies with the SDK version, so for the owner slot only signer status is enforced.
    const ownerSlot = index === 0 && e.isSigner;
    if (a.address !== e.address || a.isSigner !== e.isSigner || (!ownerSlot && a.isWritable !== e.isWritable)) {
      invalid(`${label} account ${index} does not match the canonical ${e.address} role.`);
    }
  }
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  let value = BigInt(0);
  for (let i = 0; i < 8; i += 1) value |= BigInt(data[offset + i]) << BigInt(8 * i);
  return value;
}

function parseComputeBudget(instruction: CanonicalInstruction) {
  if (instruction.accounts.length !== 0) invalid("Compute Budget instructions must not include accounts.");
  const data = bs58.decode(instruction.dataBase58);
  if (data[0] === 2) {
    if (data.length !== 5) invalid("SetComputeUnitLimit must use its exact 5-byte encoding.");
    const units = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
    if (units < 1 || units > MAX_COMPUTE_UNITS) invalid(`compute unit limit must be between 1 and ${MAX_COMPUTE_UNITS}.`);
    return { kind: "limit" as const, value: BigInt(units) };
  }
  if (data[0] === 3) {
    if (data.length !== 9) invalid("SetComputeUnitPrice must use its exact 9-byte encoding.");
    return { kind: "price" as const, value: readU64LE(data, 1) };
  }
  invalid("unsupported Compute Budget opcode.");
}

function assertIdempotentAta(
  instruction: CanonicalInstruction,
  walletAddress: string,
  feePayerAddress: string,
  liquidityTokenAccount: string,
  collateralTokenAccount: string,
) {
  const data = bs58.decode(instruction.dataBase58);
  if (data.length !== 1 || data[0] !== 1) invalid("only idempotent associated-token-account creation is allowed.");
  const expectedTargets = new Set([liquidityTokenAccount, collateralTokenAccount]);
  if (instruction.accounts.length !== 6) invalid("associated-token-account instruction must have exactly 6 accounts.");
  const [payer, target, owner, mint, systemProgram, tokenProgram] = instruction.accounts;
  if (!expectedTargets.has(target.address)) invalid("ATA target must be the canonical wallet USDC or cUSDC account.");
  if (payer.address !== feePayerAddress || !payer.isSigner || !payer.isWritable) {
    invalid("ATA payer must be the expected fee payer and a writable signer.");
  }
  if (owner.address !== walletAddress || owner.isSigner || owner.isWritable) invalid("ATA owner must be the wallet and readonly.");
  if (mint.isSigner || mint.isWritable) invalid("ATA mint must be readonly.");
  if (target.isSigner || !target.isWritable) invalid("ATA target must be writable and not a signer.");
  if (systemProgram.address !== SYSTEM_PROGRAM_ID || systemProgram.isSigner || systemProgram.isWritable) {
    invalid("ATA system program is not canonical.");
  }
  if (tokenProgram.address !== KAMINO_LEND_DEVNET.liquidityTokenProgram || tokenProgram.isSigner || tokenProgram.isWritable) {
    invalid("ATA token program is not canonical.");
  }
  const targetMint = target.address === liquidityTokenAccount
    ? KAMINO_LEND_DEVNET.liquidityMint
    : KAMINO_LEND_DEVNET.collateralMint;
  const ownerKey = new PublicKey(walletAddress);
  if (ata(ownerKey, targetMint) !== target.address || mint.address !== targetMint) {
    invalid("ATA must match the canonical wallet/mint derivation.");
  }
  return target.address;
}

export function validateIntent(
  input: InstructionIntentInput,
  policy: InstructionIntentPolicy = {},
): ValidatedInstructionIntent {
  if (!input || (input.action !== "deposit" && input.action !== "withdraw")) invalid("action is unsupported.");
  const walletAddress = canonicalAddress(input.walletAddress, "walletAddress");
  const feePayerAddress = canonicalAddress(policy.feePayerAddress ?? walletAddress, "feePayerAddress");
  const amount = atomicU64(input.amountAtomic, "amountAtomic");
  const collateral = input.action === "withdraw"
    ? atomicU64(input.collateralAmountAtomic, "collateralAmountAtomic")
    : null;
  if (input.action === "deposit" && input.collateralAmountAtomic !== null) {
    invalid("deposit collateralAmountAtomic must be null.");
  }
  if (!Array.isArray(input.instructions) || input.instructions.length < 1 || input.instructions.length > 5) {
    invalid("instructions must contain one Kamino instruction and only supported setup instructions.");
  }
  const instructions = input.instructions.map(normalizeIntentInstruction);
  const liquidityTokenAccount = ata(new PublicKey(walletAddress), KAMINO_LEND_DEVNET.liquidityMint);
  const collateralTokenAccount = ata(new PublicKey(walletAddress), KAMINO_LEND_DEVNET.collateralMint);
  let kaminoCount = 0;
  let kaminoIndex = -1;
  let computeUnitLimit: number | null = null;
  let computeUnitPrice = BigInt(0);
  let computeUnitPriceSeen = false;
  const createdAtas = new Set<string>();
  let sawNonCompute = false;
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction.programId === COMPUTE_BUDGET_PROGRAM_ID) {
      if (sawNonCompute) invalid("Compute Budget instructions must precede account-creation and Kamino instructions.");
      const parsed = parseComputeBudget(instruction);
      if (parsed.kind === "limit") {
        if (computeUnitLimit !== null) invalid("duplicate SetComputeUnitLimit instruction.");
        computeUnitLimit = Number(parsed.value);
      } else {
        if (computeUnitPriceSeen) invalid("duplicate SetComputeUnitPrice instruction.");
        computeUnitPriceSeen = true;
        computeUnitPrice = parsed.value;
      }
      continue;
    }
    sawNonCompute = true;
    if (instruction.programId === ASSOCIATED_TOKEN_PROGRAM_ID) {
      if (kaminoIndex >= 0) invalid("ATA creation must precede the Kamino instruction.");
      const target = assertIdempotentAta(
        instruction,
        walletAddress,
        feePayerAddress,
        liquidityTokenAccount,
        collateralTokenAccount,
      );
      if (createdAtas.has(target)) invalid("duplicate canonical ATA creation.");
      createdAtas.add(target);
      continue;
    }
    if (instruction.programId === KAMINO_LEND_DEVNET.programId) {
      kaminoCount += 1;
      kaminoIndex = index;
      if (index !== instructions.length - 1) invalid("the Kamino instruction must be last.");
      const data = bs58.decode(instruction.dataBase58);
      const discriminator = KAMINO_DISCRIMINATORS[input.action];
      if (data.length !== 16 || !discriminator.every((byte, i) => data[i] === byte)) {
        invalid("Kamino instruction discriminator or u64 argument layout is invalid.");
      }
      const actualAmount = readU64LE(data, 8);
      const expectedAmount = input.action === "deposit" ? amount : collateral!;
      if (actualAmount !== expectedAmount) invalid("Kamino instruction amount does not match the requested intent.");
      assertSameAccounts(
        instruction.accounts,
        expectedKaminoAccounts(input.action, walletAddress, liquidityTokenAccount, collateralTokenAccount),
        "Kamino instruction",
      );
      continue;
    }
    invalid(`program ${instruction.programId} is not allowed in this intent.`);
  }
  if (kaminoCount !== 1) invalid("exactly one canonical Kamino instruction is required.");
  const effectiveCuLimit = BigInt(computeUnitLimit ?? MAX_COMPUTE_UNITS);
  const capInput = policy.maxPriorityFeeLamports ?? "0";
  if (typeof capInput !== "string" || !/^(0|[1-9]\d*)$/.test(capInput)) {
    invalid("maxPriorityFeeLamports must be a non-negative integer string.");
  }
  const priorityFeeCap = BigInt(capInput);
  if (priorityFeeCap > MAX_PRIORITY_FEE_LAMPORTS) {
    invalid("configured priority fee cap exceeds the hard 50,000 lamport ceiling.");
  }
  if (computeUnitPrice * effectiveCuLimit > priorityFeeCap * MICRO_LAMPORTS_PER_LAMPORT) {
    invalid("priority fee exceeds the configured lamport cap.");
  }
  return {
    action: input.action,
    walletAddress,
    feePayerAddress,
    amountAtomic: amount.toString(),
    collateralAmountAtomic: collateral?.toString() ?? null,
    liquidityTokenAccount,
    collateralTokenAccount,
    computeUnitLimit,
    computeUnitPriceMicroLamports: computeUnitPrice.toString(),
  };
}
