/**
 * Finalized-receipt verification for a smart-wallet bond purchase (`markets-subscribe`), the
 * counterpart of `lib/kamino-smart-wallet-receipt.ts`. It accepts only this trace:
 *
 *   top level:  [ComputeBudget…] [System transfer sponsor → wallet (rent pre-funding)] wrapper
 *   wrapper →   [ATA create (USDC and/or bond, canonical CPI flow)]  subscribe
 *   subscribe → TransferChecked(wallet USDC → proceeds vault, exact cost, 6 dp, wallet authority)
 *               MintTo(bond mint → wallet bond ATA, exact units, instrument authority)
 *
 * and then checks the token deltas: wallet USDC −cost, proceeds vault +cost, wallet bond +units,
 * no other wallet account of either mint moved, sponsor paid the fee, and the wallet's lamports
 * dropped by at most the rent of the token accounts it created in this transaction.
 */
import bs58 from "bs58";
import {
  XMSWI_WALLET_WRAPPER_PROGRAM_ID,
  SmartWalletReceiptError,
  assertValidSignature,
  decode,
  readU32LE,
  readU64LE,
  sameDecodedInstruction,
  sameStrings,
  validateTopLevelComputeBudget,
  type NormalizedFinalizedRpcReceipt,
  type NormalizedTokenBalance,
  type NormalizedTraceInstruction,
} from "../kamino-smart-wallet-receipt";
import type { CanonicalInstruction } from "../kamino-instruction-intent";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  CIRCLE_DEVNET_USDC_ADDRESS,
  PLAIN_MARKETS_PROGRAM,
  SPL_TOKEN_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  USDC_DECIMALS,
  MARKETS_SUBSCRIBE_ACTION,
  validateSubscribeIntent,
  type SubscribeTerms,
  type ValidatedSubscribeIntent,
} from "./purchase";

export type SubscribeReceiptIntent = {
  walletAddress: string;
  feePayerAddress: string;
  units: string;
  costAtomic: string;
  computeUnitLimit: number | null;
  computeUnitPriceMicroLamports: string;
};

export type VerifiedSubscribeReceipt = {
  verified: true;
  signature: string;
  walletAddress: string;
  feePayerAddress: string;
  mint: string;
  units: string;
  costAtomic: string;
  feeLamports: string;
};

function reject(message: string): never {
  throw new SmartWalletReceiptError(`markets-subscribe: ${message}`);
}

function assertAtaCpis(parent: NormalizedTraceInstruction, children: NormalizedTraceInstruction[], walletAddress: string) {
  if (children.length === 0) return BigInt(0); // idempotent: the account already existed
  const [payer, ata, owner, mint, , tokenProgram] = parent.accounts;
  if (owner !== walletAddress || payer !== walletAddress) reject("ATA payer and owner must be the wallet.");
  // Current ATA program flow: GetAccountDataSize → CreateAccount → InitializeImmutableOwner → InitializeAccount3.
  if (children.length !== 4) reject("ATA CPI trace does not match the supported flow.");
  const [size, create, immutable, init] = children;
  const sizeData = decode(size.dataBase58, "GetAccountDataSize data");
  if (size.programId !== tokenProgram || sizeData[0] !== 21 || !sameStrings(size.accounts, [mint])) reject("ATA size query is not canonical.");
  if (create.programId !== SYSTEM_PROGRAM || !sameStrings(create.accounts, [payer, ata])) reject("ATA create-account CPI does not match payer and ATA.");
  const createData = decode(create.dataBase58, "System create-account data");
  if (createData.length !== 52 || readU32LE(createData, 0) !== 0) reject("ATA System CPI is not create-account.");
  const lamports = readU64LE(createData, 4);
  const space = readU64LE(createData, 12);
  const ownerProgram = bs58.encode(createData.slice(20, 52));
  if (lamports <= BigInt(0) || lamports > BigInt(10_000_000) || space < BigInt(165) || space > BigInt(512) || ownerProgram !== tokenProgram) {
    reject("ATA create-account has unexpected funding, size or owner program.");
  }
  const immutableData = decode(immutable.dataBase58, "InitializeImmutableOwner data");
  if (immutable.programId !== tokenProgram || immutableData.length !== 1 || immutableData[0] !== 22 || !sameStrings(immutable.accounts, [ata])) {
    reject("ATA immutable-owner CPI is not canonical.");
  }
  const initData = decode(init.dataBase58, "InitializeAccount3 data");
  if (init.programId !== tokenProgram || initData.length !== 33 || initData[0] !== 18 || !sameStrings(init.accounts, [ata, mint])
    || bs58.encode(initData.slice(1)) !== walletAddress) {
    reject("ATA initialization does not set the wallet as owner.");
  }
  return lamports;
}

function assertSubscribeCpis(children: NormalizedTraceInstruction[], intent: Pick<SubscribeReceiptIntent, "walletAddress" | "units" | "costAtomic">, checked: ValidatedSubscribeIntent) {
  if (children.length !== 2) reject("subscribe CPI subtree must be exactly TransferChecked then MintTo.");
  const [pay, deliver] = children;
  const payData = decode(pay.dataBase58, "TransferChecked data");
  if (pay.programId !== SPL_TOKEN_PROGRAM || payData.length !== 10 || payData[0] !== 12 || payData[9] !== USDC_DECIMALS) {
    reject("payment leg is not an SPL TransferChecked of USDC.");
  }
  if (!sameStrings(pay.accounts, [checked.accounts.buyerSettlement, CIRCLE_DEVNET_USDC_ADDRESS, checked.accounts.proceedsVault, intent.walletAddress])) {
    reject("payment leg source, mint, destination or authority is not canonical.");
  }
  if (readU64LE(payData, 1) !== BigInt(intent.costAtomic)) reject("payment leg amount differs from the intent.");
  const mintData = decode(deliver.dataBase58, "MintTo data");
  if (deliver.programId !== TOKEN_2022_PROGRAM || mintData.length !== 9 || mintData[0] !== 7) reject("delivery leg is not a Token-2022 MintTo.");
  if (!sameStrings(deliver.accounts, [checked.mint, checked.accounts.buyerBond, checked.accounts.instrument])) {
    reject("delivery leg mint, destination or authority is not canonical.");
  }
  if (readU64LE(mintData, 1) !== BigInt(intent.units)) reject("delivery leg units differ from the intent.");
}

function balance(list: NormalizedTokenBalance[], index: number, owner: string, mint: string, decimals: number, optional: boolean) {
  const rows = list.filter((b) => b.accountIndex === index);
  if (rows.length === 0) {
    if (optional) return BigInt(0);
    reject(`token balance for account ${index} is missing.`);
  }
  if (rows.length !== 1) reject(`duplicate token balance for account ${index}.`);
  const b = rows[0];
  if (b.mint !== mint || b.owner !== owner || b.decimals !== decimals || !/^(0|[1-9]\d*)$/.test(b.amount)) reject(`token balance identity for account ${index} is invalid.`);
  return BigInt(b.amount);
}

export function validateFinalizedSubscribeReceipt({
  intent,
  terms,
  expectedDecodedWrapperInstructions,
  receipt,
}: {
  intent: SubscribeReceiptIntent;
  terms: SubscribeTerms;
  expectedDecodedWrapperInstructions: CanonicalInstruction[];
  receipt: NormalizedFinalizedRpcReceipt;
}): VerifiedSubscribeReceipt {
  if (!receipt || receipt.commitment !== "finalized" || !receipt.meta) reject("a finalized RPC receipt with metadata is required.");
  if (receipt.meta.err !== null) reject("transaction failed or execution status is unavailable.");
  if (!Array.isArray(receipt.accountKeys) || receipt.accountKeys.length === 0 || new Set(receipt.accountKeys).size !== receipt.accountKeys.length) {
    reject("normalized receipt account keys are invalid.");
  }
  if (!Number.isSafeInteger(receipt.meta.fee) || receipt.meta.fee < 0) reject("transaction fee is invalid.");
  assertValidSignature(receipt.signature, "transaction signature");
  if (!Array.isArray(receipt.signatures) || receipt.signatures.length !== receipt.requiredSignerAddresses?.length || receipt.signatures.length === 0) {
    reject("required signer signatures are missing.");
  }
  receipt.signatures.forEach((s, i) => assertValidSignature(s, `required signature ${i}`));
  if (receipt.signatures[0] !== receipt.signature) reject("transaction signature does not match the fee-payer signature.");
  if (receipt.requiredSignerAddresses[0] !== intent.feePayerAddress || receipt.requiredSignerAddresses.includes(intent.walletAddress)) {
    reject("the sponsor must sign as fee payer and the smart wallet must not sign as a keypair.");
  }
  if (receipt.accountKeys[0] !== intent.feePayerAddress) reject("transaction fee payer differs from the reviewed envelope.");
  const rootIndex = validateTopLevelComputeBudget(receipt.topLevelInstructions, intent);
  const root = receipt.topLevelInstructions[rootIndex];
  if (root.programId !== XMSWI_WALLET_WRAPPER_PROGRAM_ID || !root.accounts.includes(intent.walletAddress)) reject("wrapper root does not include the wallet.");

  // The reviewed payload must itself be a valid purchase intent for these trusted terms.
  let checked: ValidatedSubscribeIntent;
  try {
    checked = validateSubscribeIntent(
      { action: MARKETS_SUBSCRIBE_ACTION, walletAddress: intent.walletAddress, units: intent.units, costAtomic: intent.costAtomic, instructions: expectedDecodedWrapperInstructions },
      terms,
    );
  } catch (cause) {
    reject(cause instanceof Error ? `wrapper payload does not match intent: ${cause.message}` : "wrapper payload does not match intent.");
  }

  const groups = new Map<number, NormalizedTraceInstruction[]>();
  for (const g of receipt.meta.innerInstructions ?? []) {
    if (!Number.isInteger(g.index) || g.index !== rootIndex || groups.has(g.index) || !Array.isArray(g.instructions)) reject("unexpected inner-instruction group.");
    groups.set(g.index, g.instructions);
  }
  const trace = groups.get(rootIndex);
  if (!trace?.length) reject("wallet wrapper has no recorded CPI trace.");
  const rentPaid = verifyPurchaseTrace({ trace, payloadDepth: 2, expected: expectedDecodedWrapperInstructions, intent, checked });

  // Lamports: sponsor pays the fee; the wallet loses at most the rent of accounts it created.
  const { preBalances, postBalances } = receipt.meta;
  if (preBalances?.length !== receipt.accountKeys.length || postBalances?.length !== receipt.accountKeys.length) reject("lamport balances do not align with account keys.");
  const walletIndex = receipt.accountKeys.indexOf(intent.walletAddress);
  const walletDelta = BigInt(postBalances[walletIndex]) - BigInt(preBalances[walletIndex]);
  if (walletDelta < -rentPaid) reject("smart-wallet lamports dropped by more than the rent of its new token accounts.");
  if (BigInt(postBalances[0]) - BigInt(preBalances[0]) > -BigInt(receipt.meta.fee)) reject("the sponsor did not pay the transaction fee.");

  verifyPurchaseDeltas(receipt, intent, checked);
  return {
    verified: true,
    signature: receipt.signature,
    walletAddress: intent.walletAddress,
    feePayerAddress: intent.feePayerAddress,
    mint: checked.mint,
    units: intent.units,
    costAtomic: intent.costAtomic,
    feeLamports: receipt.meta.fee.toString(),
  };
}

/**
 * The purchase payload's execution trace: `payloadDepth` is the stack height of the payload
 * instructions (2 inside the Crossmint wrapper, 1 for a directly signed transaction) and their CPIs
 * sit one level deeper. Returns the rent the wallet paid for token accounts created here.
 */
export function verifyPurchaseTrace(input: {
  trace: NormalizedTraceInstruction[];
  payloadDepth: number;
  expected: CanonicalInstruction[];
  intent: Pick<SubscribeReceiptIntent, "walletAddress" | "units" | "costAtomic">;
  checked: ValidatedSubscribeIntent;
}): bigint {
  const { trace, payloadDepth, expected, intent, checked } = input;
  const direct = trace.filter((ix) => ix.stackHeight === payloadDepth);
  if (direct.length !== expected.length || direct.some((ix, i) => !sameDecodedInstruction(ix, expected[i]))) {
    reject("wallet payload differs byte-for-byte from the reviewed instructions.");
  }
  const children: NormalizedTraceInstruction[][] = [];
  for (const ix of trace) {
    if (ix.stackHeight === payloadDepth) children.push([]);
    else if (ix.stackHeight === payloadDepth + 1 && children.length) children[children.length - 1].push(ix);
    else reject("unsupported CPI depth in the purchase trace.");
  }
  let rentPaid = BigInt(0);
  let subscribed = false;
  direct.forEach((ix, i) => {
    if (ix.programId === ASSOCIATED_TOKEN_PROGRAM && !subscribed) rentPaid += assertAtaCpis(ix, children[i], intent.walletAddress);
    else if (ix.programId === PLAIN_MARKETS_PROGRAM && !subscribed) {
      assertSubscribeCpis(children[i], intent, checked);
      subscribed = true;
    } else reject(`unexpected payload instruction ${ix.programId}.`);
  });
  if (!subscribed) reject("no subscribe instruction in the trace.");
  return rentPaid;
}

/** Exact token deltas: wallet USDC −cost, proceeds vault +cost, wallet bond +units, nothing else of either mint. */
export function verifyPurchaseDeltas(
  receipt: Pick<NormalizedFinalizedRpcReceipt, "accountKeys"> & { meta: Pick<NormalizedFinalizedRpcReceipt["meta"], "preTokenBalances" | "postTokenBalances"> },
  intent: Pick<SubscribeReceiptIntent, "walletAddress" | "units" | "costAtomic">,
  checked: ValidatedSubscribeIntent,
) {
  const indexOf = (address: string) => {
    const hits = receipt.accountKeys.flatMap((k, i) => (k === address ? [i] : []));
    if (hits.length !== 1) reject(`receipt account ${address} is missing or duplicated.`);
    return hits[0];
  };
  const delta = (address: string, owner: string, mint: string, decimals: number, optional: boolean) => {
    const i = indexOf(address);
    return balance(receipt.meta.postTokenBalances, i, owner, mint, decimals, optional) - balance(receipt.meta.preTokenBalances, i, owner, mint, decimals, optional);
  };
  const usdcIndex = indexOf(checked.accounts.buyerSettlement);
  const bondIndex = indexOf(checked.accounts.buyerBond);
  const cost = BigInt(intent.costAtomic);
  if (delta(checked.accounts.buyerSettlement, intent.walletAddress, CIRCLE_DEVNET_USDC_ADDRESS, USDC_DECIMALS, false) !== -cost) reject("wallet USDC was not debited exactly the price.");
  if (delta(checked.accounts.proceedsVault, checked.accounts.offering, CIRCLE_DEVNET_USDC_ADDRESS, USDC_DECIMALS, false) !== cost) reject("proceeds vault did not receive exactly the price.");
  if (delta(checked.accounts.buyerBond, intent.walletAddress, checked.mint, 0, true) !== BigInt(intent.units)) reject("wallet bond account was not credited exactly the units.");
  for (const b of [...receipt.meta.preTokenBalances, ...receipt.meta.postTokenBalances]) {
    if (b.owner === intent.walletAddress && (b.mint === CIRCLE_DEVNET_USDC_ADDRESS || b.mint === checked.mint) && b.accountIndex !== usdcIndex && b.accountIndex !== bondIndex) {
      reject("a non-canonical wallet token account moved.");
    }
  }
}
