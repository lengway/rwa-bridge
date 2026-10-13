import bs58 from "bs58";
import {
  KAMINO_LEND_DEVNET,
  type KaminoLendAction,
} from "./kamino-lend-devnet-config";
import {
  validateIntent,
  type CanonicalInstruction,
  type ValidatedInstructionIntent,
} from "./kamino-instruction-intent";

export const XMSWI_WALLET_WRAPPER_PROGRAM_ID =
  "XmSwiXQsxSZYKVYbSAkkvQVvdrKo1nwwfvZBPQrLzbU";

const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const TOKEN_PROGRAM_ID = KAMINO_LEND_DEVNET.liquidityTokenProgram;
const MAX_COMPUTE_UNITS = 300_000;

export type NormalizedTraceInstruction = {
  programId: string;
  accounts: string[];
  dataBase58: string;
  stackHeight?: number | null;
};

export type NormalizedInnerInstructionGroup = {
  /** Index into normalized transaction.topLevelInstructions. */
  index: number;
  instructions: NormalizedTraceInstruction[];
};

export type NormalizedTokenBalance = {
  accountIndex: number;
  mint: string;
  owner: string;
  amount: string;
  decimals: number;
};

/**
 * Adapter shape for one finalized getTransaction response. `accountKeys` must
 * already contain static keys followed by loaded writable and readonly keys,
 * in the order used by RPC accountIndex fields.
 */
export type NormalizedFinalizedRpcReceipt = {
  commitment: "finalized";
  signature: string;
  accountKeys: string[];
  requiredSignerAddresses: string[];
  signatures: string[];
  topLevelInstructions: NormalizedTraceInstruction[];
  meta: {
    err: null | unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances: NormalizedTokenBalance[];
    postTokenBalances: NormalizedTokenBalance[];
    innerInstructions: NormalizedInnerInstructionGroup[];
  };
};

export type SmartWalletReceiptIntent = Pick<
  ValidatedInstructionIntent,
  | "action"
  | "walletAddress"
  | "feePayerAddress"
  | "amountAtomic"
  | "collateralAmountAtomic"
  | "liquidityTokenAccount"
  | "collateralTokenAccount"
  | "computeUnitLimit"
  | "computeUnitPriceMicroLamports"
>;

export type VerifiedSmartWalletReceipt = {
  verified: true;
  signature: string;
  action: KaminoLendAction;
  walletAddress: string;
  feePayerAddress: string;
  amountAtomic: string;
  actualLiquidityAmountAtomic: string;
  actualCollateralAmountAtomic: string;
  feeLamports: string;
};

export class SmartWalletReceiptError extends Error {
  constructor(message: string) {
    super(`SMART_WALLET_RECEIPT_REJECTED: ${message}`);
    this.name = "SmartWalletReceiptError";
  }
}

function reject(message: string): never {
  throw new SmartWalletReceiptError(message);
}

function decode(dataBase58: string, label: string): Uint8Array {
  try {
    const data = bs58.decode(dataBase58);
    if (bs58.encode(data) !== dataBase58) reject(`${label} is not canonical base58.`);
    return data;
  } catch {
    return reject(`${label} is not valid base58.`);
  }
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length) reject("truncated SPL u64 instruction data.");
  let value = BigInt(0);
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(data[offset + index]) << BigInt(index * 8);
  }
  return value;
}

function readU32LE(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) reject("truncated System Program instruction data.");
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function sameDecodedInstruction(actual: NormalizedTraceInstruction, expected: CanonicalInstruction) {
  return actual.programId === expected.programId
    && actual.dataBase58 === expected.dataBase58
    && sameStrings(actual.accounts, expected.accounts.map((account) => account.address));
}

function assertValidSignature(signature: string, label: string) {
  if (typeof signature !== "string") reject(`${label} is missing.`);
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(signature);
  } catch {
    return reject(`${label} is malformed.`);
  }
  if (bytes.length !== 64 || bs58.encode(bytes) !== signature) reject(`${label} is malformed.`);
}

function validateTopLevelComputeBudget(
  instructions: NormalizedTraceInstruction[],
  intent: SmartWalletReceiptIntent,
) {
  let limits = 0;
  let prices = 0;
  let wrapperIndex = -1;
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction.programId === XMSWI_WALLET_WRAPPER_PROGRAM_ID) {
      if (wrapperIndex !== -1) reject("multiple smart-wallet wrapper roots are not allowed.");
      wrapperIndex = index;
      continue;
    }
    if (instruction.programId !== COMPUTE_BUDGET_PROGRAM_ID) {
      reject(`unexpected top-level program ${instruction.programId}.`);
    }
    if (instruction.accounts.length !== 0) reject("Compute Budget instruction must not have accounts.");
    if (wrapperIndex !== -1) reject("Compute Budget instructions must precede the wallet wrapper.");
    const data = decode(instruction.dataBase58, "Compute Budget data");
    if (data[0] === 2) {
      if (data.length !== 5 || intent.computeUnitLimit === null) reject("unexpected or malformed compute unit limit.");
      const units = readU32LE(data, 1);
      if (units < 1 || units > MAX_COMPUTE_UNITS || units !== intent.computeUnitLimit) {
        reject("compute unit limit differs from the validated intent.");
      }
      limits += 1;
    } else if (data[0] === 3) {
      if (data.length !== 9 || intent.computeUnitPriceMicroLamports === "0") {
        reject("unexpected or malformed compute unit price.");
      }
      const price = readU64LE(data, 1);
      if (price.toString() !== intent.computeUnitPriceMicroLamports) {
        reject("compute unit price differs from the validated intent.");
      }
      prices += 1;
    } else {
      reject("unsupported top-level Compute Budget opcode.");
    }
  }
  if (wrapperIndex < 0 || wrapperIndex !== instructions.length - 1) {
    reject("exactly one final top-level smart-wallet wrapper root is required.");
  }
  if (limits !== (intent.computeUnitLimit === null ? 0 : 1)) reject("compute unit limit instruction count differs from intent.");
  if (prices !== (intent.computeUnitPriceMicroLamports === "0" ? 0 : 1)) reject("compute unit price instruction count differs from intent.");
  return wrapperIndex;
}

function validateExpectedWrapperInstructions(
  intent: SmartWalletReceiptIntent,
  expected: CanonicalInstruction[],
) {
  if (!Array.isArray(expected) || expected.length < 1 || expected.length > 3) {
    reject("expected wallet payload must contain one Kamino instruction and at most two ATA instructions.");
  }
  if (expected.some((instruction) => instruction.programId === COMPUTE_BUDGET_PROGRAM_ID)) {
    reject("Compute Budget instructions must be top-level, outside the wallet wrapper payload.");
  }
  let checked: ValidatedInstructionIntent;
  try {
    checked = validateIntent({
      action: intent.action,
      walletAddress: intent.walletAddress,
      amountAtomic: intent.amountAtomic,
      collateralAmountAtomic: intent.collateralAmountAtomic,
      instructions: expected,
    }, { feePayerAddress: intent.feePayerAddress });
  } catch (cause) {
    reject(cause instanceof Error ? `wrapper payload does not match intent: ${cause.message}` : "wrapper payload does not match intent.");
  }
  if (checked.liquidityTokenAccount !== intent.liquidityTokenAccount
    || checked.collateralTokenAccount !== intent.collateralTokenAccount) {
    reject("validated intent token accounts do not match canonical wallet ATAs.");
  }
}

function assertAtaCreationCpis(
  parent: NormalizedTraceInstruction,
  children: NormalizedTraceInstruction[],
  intent: SmartWalletReceiptIntent,
) {
  if (parent.programId !== ASSOCIATED_TOKEN_PROGRAM_ID) reject("unexpected ATA parent instruction.");
  if (children.length === 0) return;
  if (children.length !== 2) reject("ATA CPI trace does not match the supported classic SPL ATA flow.");
  const [systemCreate, initialize] = children;
  const expectedAta = parent.accounts[1];
  const expectedPayer = parent.accounts[0];
  const expectedOwner = parent.accounts[2];
  const expectedMint = parent.accounts[3];
  if (systemCreate.programId !== SYSTEM_PROGRAM_ID || !sameStrings(systemCreate.accounts, [expectedPayer, expectedAta])) {
    reject("ATA System Program create-account CPI does not match payer and ATA.");
  }
  const createData = decode(systemCreate.dataBase58, "System create-account data");
  if (createData.length !== 52 || readU32LE(createData, 0) !== 0) {
    reject("ATA System Program CPI is not the exact create-account variant.");
  }
  const accountSpace = readU64LE(createData, 12);
  const tokenProgram = bs58.encode(createData.slice(20, 52));
  if (readU64LE(createData, 4) <= BigInt(0) || accountSpace !== BigInt(165) || tokenProgram !== TOKEN_PROGRAM_ID) {
    reject("ATA System Program CPI has unexpected funding, size, or owner program.");
  }
  if (initialize.programId !== TOKEN_PROGRAM_ID || !sameStrings(initialize.accounts, [expectedAta, expectedMint])) {
    reject("ATA token initialization does not match ATA and mint.");
  }
  const initializeData = decode(initialize.dataBase58, "SPL InitializeAccount3 data");
  if (initializeData.length !== 33 || initializeData[0] !== 18) {
    reject("ATA CPI is not the supported classic SPL InitializeAccount3 variant.");
  }
  const initializedOwner = bs58.encode(initializeData.slice(1));
  if (initializedOwner !== intent.walletAddress || expectedOwner !== intent.walletAddress) {
    reject("ATA initialization owner does not match the smart wallet.");
  }
}

function assertKaminoCpis(
  parent: NormalizedTraceInstruction,
  children: NormalizedTraceInstruction[],
  intent: SmartWalletReceiptIntent,
) {
  if (parent.programId !== KAMINO_LEND_DEVNET.programId || children.length !== 2) {
    reject("Kamino CPI subtree does not match the supported two-token-call flow.");
  }
  const [transfer, tokenChange] = children;
  if (transfer.programId !== TOKEN_PROGRAM_ID || tokenChange.programId !== TOKEN_PROGRAM_ID) {
    reject("unexpected program in the Kamino CPI subtree.");
  }
  const transferData = decode(transfer.dataBase58, "SPL TransferChecked data");
  if (transferData.length !== 10 || transferData[0] !== 12 || transferData[9] !== KAMINO_LEND_DEVNET.decimals) {
    reject("Kamino token transfer is not the supported TransferChecked instruction.");
  }
  const liquidityAmount = readU64LE(transferData, 1);
  const transferAccounts = intent.action === "deposit"
    ? [intent.liquidityTokenAccount, KAMINO_LEND_DEVNET.liquidityMint, KAMINO_LEND_DEVNET.supplyVault, intent.walletAddress]
    : [KAMINO_LEND_DEVNET.supplyVault, KAMINO_LEND_DEVNET.liquidityMint, intent.liquidityTokenAccount, KAMINO_LEND_DEVNET.lendingMarketAuthority];
  if (!sameStrings(transfer.accounts, transferAccounts)) reject("TransferChecked source, mint, destination, or authority is not canonical.");

  let collateralAmount: bigint;
  if (intent.action === "deposit") {
    const data = decode(tokenChange.dataBase58, "SPL MintTo data");
    if (data.length !== 9 || data[0] !== 7) reject("deposit must use the supported SPL MintTo instruction.");
    collateralAmount = readU64LE(data, 1);
    if (!sameStrings(tokenChange.accounts, [KAMINO_LEND_DEVNET.collateralMint, intent.collateralTokenAccount, KAMINO_LEND_DEVNET.lendingMarketAuthority])) {
      reject("MintTo mint, destination, or authority is not canonical.");
    }
    if (liquidityAmount !== BigInt(intent.amountAtomic) || collateralAmount <= BigInt(0)) {
      reject("deposit CPI amounts do not match the validated intent.");
    }
  } else {
    const data = decode(tokenChange.dataBase58, "SPL Burn data");
    if (data.length !== 9 || data[0] !== 8) reject("withdrawal must use the supported SPL Burn instruction.");
    collateralAmount = readU64LE(data, 1);
    if (!sameStrings(tokenChange.accounts, [intent.collateralTokenAccount, KAMINO_LEND_DEVNET.collateralMint, intent.walletAddress])) {
      reject("Burn source, mint, or owner is not canonical.");
    }
    if (intent.collateralAmountAtomic === null
      || collateralAmount !== BigInt(intent.collateralAmountAtomic)
      || liquidityAmount < BigInt(intent.amountAtomic)) {
      reject("withdrawal CPI amounts do not match the validated intent.");
    }
  }
  return { liquidityAmount, collateralAmount };
}

function balanceAmount(
  balances: NormalizedTokenBalance[],
  accountIndex: number,
  accountAddress: string,
  owner: string,
  mint: string,
  decimals: number,
  optional: boolean,
) {
  const matches = balances.filter((balance) => balance.accountIndex === accountIndex);
  if (matches.length === 0) {
    if (optional) return BigInt(0);
    reject(`required token balance for ${accountAddress} is missing.`);
  }
  if (matches.length !== 1) reject(`duplicate token balance for ${accountAddress}.`);
  const balance = matches[0];
  if (balance.mint !== mint || balance.owner !== owner || balance.decimals !== decimals || !/^(0|[1-9]\d*)$/.test(balance.amount)) {
    reject(`token balance identity for ${accountAddress} is invalid.`);
  }
  return BigInt(balance.amount);
}

function assertNoUnexpectedWalletMintBalances(
  balances: NormalizedTokenBalance[],
  intent: SmartWalletReceiptIntent,
  allowedIndexes: Set<number>,
) {
  for (const balance of balances) {
    if (balance.owner === intent.walletAddress
      && (balance.mint === KAMINO_LEND_DEVNET.liquidityMint || balance.mint === KAMINO_LEND_DEVNET.collateralMint)) {
      if (!allowedIndexes.has(balance.accountIndex)) reject("wallet token delta appeared in a noncanonical token account.");
    }
  }
}

function assertReceiptTokenDeltas(
  receipt: NormalizedFinalizedRpcReceipt,
  intent: SmartWalletReceiptIntent,
  liquidityAmountFromCpi: bigint,
  collateralAmountFromCpi: bigint,
) {
  const accountIndex = (address: string) => {
    const indexes = receipt.accountKeys.flatMap((key, index) => key === address ? [index] : []);
    if (indexes.length !== 1) reject(`receipt account key ${address} is missing or duplicated.`);
    return indexes[0];
  };
  const userUsdcIndex = accountIndex(intent.liquidityTokenAccount);
  const userCUsdcIndex = accountIndex(intent.collateralTokenAccount);
  const vaultIndex = accountIndex(KAMINO_LEND_DEVNET.supplyVault);
  const readDelta = (
    index: number,
    address: string,
    owner: string,
    mint: string,
    optional: boolean,
  ) => {
    const pre = balanceAmount(receipt.meta.preTokenBalances, index, address, owner, mint, KAMINO_LEND_DEVNET.decimals, optional);
    const post = balanceAmount(receipt.meta.postTokenBalances, index, address, owner, mint, KAMINO_LEND_DEVNET.decimals, optional);
    return post - pre;
  };
  const sourceUsdcDelta = readDelta(userUsdcIndex, intent.liquidityTokenAccount, intent.walletAddress, KAMINO_LEND_DEVNET.liquidityMint, false);
  const walletCUsdcDelta = readDelta(userCUsdcIndex, intent.collateralTokenAccount, intent.walletAddress, KAMINO_LEND_DEVNET.collateralMint, true);
  const vaultUsdcDelta = readDelta(vaultIndex, KAMINO_LEND_DEVNET.supplyVault, KAMINO_LEND_DEVNET.lendingMarketAuthority, KAMINO_LEND_DEVNET.liquidityMint, false);
  assertNoUnexpectedWalletMintBalances(
    [...receipt.meta.preTokenBalances, ...receipt.meta.postTokenBalances],
    intent,
    new Set([userUsdcIndex, userCUsdcIndex]),
  );
  if (intent.action === "deposit") {
    if (sourceUsdcDelta !== -liquidityAmountFromCpi
      || vaultUsdcDelta !== liquidityAmountFromCpi
      || walletCUsdcDelta !== collateralAmountFromCpi) {
      reject("deposit pre/post token deltas do not match exact source, vault, and collateral CPI amounts.");
    }
    return { actualLiquidityAmountAtomic: liquidityAmountFromCpi, actualCollateralAmountAtomic: collateralAmountFromCpi };
  }
  if (intent.collateralAmountAtomic === null
    || sourceUsdcDelta !== liquidityAmountFromCpi
    || vaultUsdcDelta !== -liquidityAmountFromCpi
    || walletCUsdcDelta !== -collateralAmountFromCpi) {
    reject("withdrawal pre/post token deltas do not match exact source, vault, and collateral CPI amounts.");
  }
  return { actualLiquidityAmountAtomic: liquidityAmountFromCpi, actualCollateralAmountAtomic: collateralAmountFromCpi };
}

/**
 * Verify only the explicitly supported finalized wrapper trace. This narrow
 * parser intentionally rejects unknown or incomplete CPI trees; it has not
 * been validated against a production receipt yet.
 */
export function validateFinalizedSmartWalletReceipt({
  intent,
  expectedDecodedWrapperInstructions,
  receipt,
}: {
  intent: SmartWalletReceiptIntent;
  expectedDecodedWrapperInstructions: CanonicalInstruction[];
  receipt: NormalizedFinalizedRpcReceipt;
}): VerifiedSmartWalletReceipt {
  if (!receipt || receipt.commitment !== "finalized" || !receipt.meta) reject("a finalized RPC receipt with metadata is required.");
  if (receipt.meta.err !== null) reject("transaction failed or execution status is unavailable.");
  if (!Array.isArray(receipt.accountKeys) || receipt.accountKeys.length === 0
    || new Set(receipt.accountKeys).size !== receipt.accountKeys.length) reject("normalized receipt account keys are invalid.");
  if (!Array.isArray(receipt.topLevelInstructions) || !Array.isArray(receipt.meta.innerInstructions)) {
    reject("transaction instruction trace is missing.");
  }
  if (!Number.isSafeInteger(receipt.meta.fee) || receipt.meta.fee < 0) reject("transaction fee is invalid.");
  assertValidSignature(receipt.signature, "transaction signature");
  if (!Array.isArray(receipt.signatures) || !Array.isArray(receipt.requiredSignerAddresses)
    || receipt.signatures.length !== receipt.requiredSignerAddresses.length
    || receipt.signatures.length === 0) reject("required signer signatures are missing.");
  receipt.signatures.forEach((signature, index) => assertValidSignature(signature, `required signature ${index}`));
  if (receipt.signatures[0] !== receipt.signature) reject("transaction signature does not match the fee-payer signature.");
  if (receipt.requiredSignerAddresses[0] !== intent.feePayerAddress
    || !receipt.requiredSignerAddresses.includes(intent.feePayerAddress)
    || receipt.requiredSignerAddresses.includes(intent.walletAddress)) {
    reject("the expected sponsor must sign as fee payer and the smart wallet must not sign as a keypair.");
  }
  if (receipt.accountKeys[0] !== intent.feePayerAddress) reject("transaction fee payer differs from the validated intent.");
  if (!receipt.accountKeys.includes(intent.walletAddress)) reject("smart wallet is absent from the normalized account keys.");
  const rootIndex = validateTopLevelComputeBudget(receipt.topLevelInstructions, intent);
  if (!receipt.topLevelInstructions[rootIndex].accounts.includes(intent.walletAddress)) {
    reject("smart-wallet wrapper root does not include the intended wallet account.");
  }
  validateExpectedWrapperInstructions(intent, expectedDecodedWrapperInstructions);

  const groupsByIndex = new Map<number, NormalizedTraceInstruction[]>();
  for (const group of receipt.meta.innerInstructions) {
    if (!Number.isInteger(group.index) || group.index < 0 || group.index >= receipt.topLevelInstructions.length
      || groupsByIndex.has(group.index) || !Array.isArray(group.instructions)) {
      reject("RPC inner-instruction groups are invalid or duplicated.");
    }
    groupsByIndex.set(group.index, group.instructions);
  }
  for (const index of groupsByIndex.keys()) {
    if (index !== rootIndex) reject("unexpected top-level instruction has a CPI subtree.");
  }
  const trace = groupsByIndex.get(rootIndex);
  if (!trace || trace.length === 0) reject("wallet wrapper has no recorded CPI trace.");
  const direct = trace.filter((instruction) => instruction.stackHeight === 2);
  if (direct.length !== expectedDecodedWrapperInstructions.length
    || direct.some((instruction, index) => !sameDecodedInstruction(instruction, expectedDecodedWrapperInstructions[index]))) {
    reject("stack-height-2 wallet payload differs byte-for-byte from the expected decoded instructions.");
  }

  const childrenByParent = new Map<number, NormalizedTraceInstruction[]>();
  let currentParentIndex = -1;
  let directIndex = -1;
  for (const instruction of trace) {
    if (instruction.stackHeight === 2) {
      currentParentIndex += 1;
      directIndex = currentParentIndex;
      childrenByParent.set(directIndex, []);
    } else if (instruction.stackHeight === 3) {
      if (directIndex < 0) reject("CPI child appeared before a wrapper instruction.");
      childrenByParent.get(directIndex)!.push(instruction);
    } else {
      reject("unsupported or missing CPI stack height; receipt shape is unverified.");
    }
  }
  let kaminoCpiAmounts: { liquidityAmount: bigint; collateralAmount: bigint } | null = null;
  for (let index = 0; index < direct.length; index += 1) {
    const instruction = direct[index];
    const children = childrenByParent.get(index) ?? [];
    if (instruction.programId === ASSOCIATED_TOKEN_PROGRAM_ID) {
      assertAtaCreationCpis(instruction, children, intent);
    } else if (instruction.programId === KAMINO_LEND_DEVNET.programId) {
      if (kaminoCpiAmounts !== null) reject("more than one Kamino CPI was observed.");
      kaminoCpiAmounts = assertKaminoCpis(instruction, children, intent);
    } else {
      reject(`unexpected wrapper child program ${instruction.programId}.`);
    }
  }
  if (!kaminoCpiAmounts) reject("the wrapper trace contains no canonical Kamino CPI.");

  if (!Array.isArray(receipt.meta.preBalances) || !Array.isArray(receipt.meta.postBalances)
    || receipt.meta.preBalances.length !== receipt.accountKeys.length
    || receipt.meta.postBalances.length !== receipt.accountKeys.length) {
    reject("pre/post lamport balances are missing or do not align with normalized account keys.");
  }
  const walletIndex = receipt.accountKeys.indexOf(intent.walletAddress);
  const sponsorIndex = receipt.accountKeys.indexOf(intent.feePayerAddress);
  const walletLamportDelta = BigInt(receipt.meta.postBalances[walletIndex]) - BigInt(receipt.meta.preBalances[walletIndex]);
  const sponsorLamportDelta = BigInt(receipt.meta.postBalances[sponsorIndex]) - BigInt(receipt.meta.preBalances[sponsorIndex]);
  if (walletLamportDelta !== BigInt(0)) reject("smart-wallet lamports changed; sponsor-paid execution is required.");
  if (sponsorIndex !== 0 || sponsorLamportDelta > -BigInt(receipt.meta.fee)) {
    reject("expected sponsor did not pay the transaction fee.");
  }

  const deltas = assertReceiptTokenDeltas(
    receipt,
    intent,
    kaminoCpiAmounts.liquidityAmount,
    kaminoCpiAmounts.collateralAmount,
  );
  return {
    verified: true,
    signature: receipt.signature,
    action: intent.action,
    walletAddress: intent.walletAddress,
    feePayerAddress: intent.feePayerAddress,
    amountAtomic: intent.amountAtomic,
    actualLiquidityAmountAtomic: deltas.actualLiquidityAmountAtomic.toString(),
    actualCollateralAmountAtomic: deltas.actualCollateralAmountAtomic.toString(),
    feeLamports: receipt.meta.fee.toString(),
  };
}
