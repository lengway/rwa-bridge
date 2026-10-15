import "server-only";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { Connection, PublicKey, VersionedTransaction, TransactionMessage, TransactionInstruction } from "@solana/web3.js";
import { decodeCrossmintSolanaEnvelope, CROSSMINT_SOLANA_SMART_WALLET_PROGRAM_ID as WRAPPER } from "./crossmint-solana-envelope";
import type { CrossmintKaminoTransaction } from "./crossmint-kamino-provider";
import type { CanonicalInstruction } from "./kamino-instruction-intent";
import { KaminoLendDevnetError } from "./kamino-lend-devnet-config";
import { SOLANA_DEVNET_GENESIS_HASH } from "./rwa-demo";
import type { MarketsSubscribeTemplate } from "./markets/purchase-server";
const CB = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
export type SmartWalletTemplate = { serializedTransaction: string; intentInstructions: CanonicalInstruction[]; action: "deposit" | "withdraw"; walletAddress: string; amountAtomic: string; collateralAmountAtomic: string | null; blockhash: string; lastValidBlockHeight: number }
  | MarketsSubscribeTemplate;
function reject(message: string): never { throw new KaminoLendDevnetError("SMART_WALLET_EXECUTION_REJECTED", message); }
function normalize(ix: TransactionInstruction): CanonicalInstruction {
  return { programId: ix.programId.toBase58(), accounts: ix.keys.map(key => ({ address: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })), dataBase58: bs58.encode(ix.data) };
}
export async function verifiedSmartWalletConnection() {
  if (process.env.SOLANA_CLUSTER !== "devnet") reject("Only Devnet is supported.");
  const c = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", { commitment: "confirmed", fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) });
  if (await c.getGenesisHash() !== SOLANA_DEVNET_GENESIS_HASH) reject("RPC is not canonical Solana Devnet.");
  return c;
}
export async function resolveSmartWalletTransaction(connection: Connection, wire: string) {
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bs58.decode(wire)); } catch { return reject("Invalid Crossmint transaction encoding."); }
  if (tx.version !== 0) reject("Unsupported transaction version.");
  const lookups = await Promise.all(tx.message.addressTableLookups.map(async lookup => {
    const result = await connection.getAddressLookupTable(lookup.accountKey);
    if (!result.value) reject("Unresolved address lookup table.");
    return result.value;
  }));
  const message = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: lookups });
  return { tx, message };
}
export function smartWalletEnvelopeDigest(instructions: CanonicalInstruction[], feePayerAddress: string, authorityAddress: string) {
  return createHash("sha256").update(JSON.stringify({ instructions, feePayerAddress, authorityAddress })).digest("hex");
}
export async function inspectKaminoSmartWalletEnvelope(
  connection: Connection, providerTx: CrossmintKaminoTransaction,
  template: SmartWalletTemplate | null, authorityAddress: string, walletAddress: string,
  initialize = false,
) {
  if (providerTx.fees?.mode !== "project" || providerTx.params.feeConfig?.feePayer !== "crossmint") reject("Project sponsorship is required.");
  if (!initialize && (!template || providerTx.params.transaction !== template.serializedTransaction)) reject("Provider input differs from the immutable intent.");
  const { tx, message } = await resolveSmartWalletTransaction(connection, providerTx.onChain.transaction);
  const payer = message.payerKey.toBase58();
  if (payer === walletAddress || payer === authorityAddress || !PublicKey.isOnCurve(message.payerKey.toBytes())) reject("Invalid sponsor fee payer.");
  const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).map(k => k.toBase58());
  if (signers.length !== 2 || !signers.includes(payer) || !signers.includes(authorityAddress)) reject("Unexpected top-level signing authority.");
  const wrappers = message.instructions.filter(ix => ix.programId.toBase58() === WRAPPER);
  if (wrappers.length !== 1 || message.instructions.at(-1) !== wrappers[0]) reject("Unexpected smart-wallet invocation.");
  const decoded = decodeCrossmintSolanaEnvelope(wrappers[0], initialize);
  if (decoded.walletAddress !== walletAddress || decoded.authorityAddress !== authorityAddress) reject("Wrapper wallet or signer differs from the verified account.");
  if (initialize) {
    if (decoded.instructions.length !== 0) reject("Activation must not execute token or protocol instructions.");
  } else {
    const original = await resolveSmartWalletTransaction(connection, template!.serializedTransaction);
    const expected = original.message.instructions.filter(ix => ix.programId.toBase58() !== CB).map(normalize);
    if (JSON.stringify(decoded.instructions) !== JSON.stringify(expected)) reject("Wrapped programs, accounts, privileges or instruction bytes differ from the intended operation.");
  }
  let units: number | null = null; let price: bigint | null = null; let rentFunding = BigInt(0);
  for (const ix of message.instructions.slice(0, -1)) {
    const id = ix.programId.toBase58();
    if (id === CB && ix.keys.length === 0) {
      if (ix.data[0] === 2 && ix.data.length === 5 && units === null) units = ix.data.readUInt32LE(1);
      else if (ix.data[0] === 3 && ix.data.length === 9 && price === null) price = ix.data.readBigUInt64LE(1);
      else reject("Unexpected compute-budget instruction.");
    } else if (id === SYSTEM && ix.data.length === 12 && ix.data.readUInt32LE(0) === 2 && rentFunding === BigInt(0)
      && ix.keys.length === 2 && ix.keys[0].pubkey.toBase58() === payer && ix.keys[0].isSigner
      && ix.keys[1].pubkey.toBase58() === walletAddress && !ix.keys[1].isSigner) {
      rentFunding = ix.data.readBigUInt64LE(4);
      if (rentFunding <= BigInt(0) || rentFunding > BigInt(10_000_000)) reject("Sponsor rent funding exceeds the policy.");
    } else reject("Unexpected outer instruction.");
  }
  if (units === null || units < 1 || units > 1_400_000 || price === null || (BigInt(units) * price + BigInt(999999)) / BigInt(1000000) > BigInt(50000)) reject("Unsupported network fee budget.");
  const settings = await connection.getAccountInfo(new PublicKey(decoded.settingsAddress), "confirmed");
  const program = await connection.getAccountInfo(new PublicKey(WRAPPER), "confirmed");
  if (!program?.executable) reject("Smart-wallet program is unavailable.");
  if (settings && (!settings.owner.equals(new PublicKey(WRAPPER)) || settings.data.length < 8)) reject("Invalid wallet settings account.");
  const topLevelInstructions = message.instructions.map(normalize);
  const fee = await connection.getFeeForMessage(tx.message, "confirmed");
  const simulation = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true });
  const setupRequired = !settings && JSON.stringify(simulation.value.err).includes("3012")
    && simulation.value.logs?.some(log => log.includes("AccountNotInitialized")) === true
    && !(simulation.value.innerInstructions?.length);
  if (simulation.value.err && !(initialize && setupRequired) && !setupRequired) reject("Wrapped transaction simulation failed.");
  if (!simulation.value.err && !initialize && !settings) reject("Wallet initialization has not been verified.");
  return { envelopeDigest: smartWalletEnvelopeDigest(topLevelInstructions, payer, authorityAddress), settingsAddress: decoded.settingsAddress, feePayerAddress: payer,
    topLevelInstructions, decodedInstructions: decoded.instructions, simulation: { ok: simulation.value.err === null, unitsConsumed: simulation.value.unitsConsumed ?? null }, setupRequired,
    feeLamports: fee.value?.toString() ?? null, computeUnitLimit: units, computeUnitPriceMicroLamports: price.toString(), rentFundingLamports: rentFunding.toString() };
}

export type SmartWalletEnvelopeInspection = Awaited<ReturnType<typeof inspectKaminoSmartWalletEnvelope>>;
export type SmartWalletFinalizationRecord = {
  action: "deposit" | "withdraw" | "initialize" | "markets-subscribe";
  walletAddress: string;
  authorityAddress: string;
  template: SmartWalletTemplate | null;
  envelope: SmartWalletEnvelopeInspection;
};

/** Provider IDs only locate candidate signatures; all evidence below comes from canonical RPC. */
export async function verifyKaminoSmartWalletFinalized(connection: Connection, providerTx: CrossmintKaminoTransaction, record: SmartWalletFinalizationRecord) {
  const candidates = [...new Set([providerTx.onChain.txId, providerTx.onChain.proxiedTxId].filter((value): value is string => typeof value === "string"))];
  for (const signature of candidates) {
    let signatureBytes: Uint8Array;
    try { signatureBytes = bs58.decode(signature); } catch { reject("Invalid provider transaction signature."); }
    if (signatureBytes.length !== 64) reject("Invalid provider transaction signature.");
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (!status || status.confirmationStatus !== "finalized") continue;
    const raw = await connection.getTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
    if (!raw?.meta || raw.transaction.message.version !== 0) continue;
    const message = raw.transaction.message;
    const keys = [...message.staticAccountKeys, ...(raw.meta.loadedAddresses?.writable ?? []), ...(raw.meta.loadedAddresses?.readonly ?? [])];
    const key = (index: number) => { const result = keys[index]; if (!result) reject("Invalid RPC account index."); return result; };
    const topLevel = message.compiledInstructions.map(ix => new TransactionInstruction({
      programId: key(ix.programIdIndex), data: Buffer.from(ix.data),
      keys: Array.from(ix.accountKeyIndexes).map(index => ({ pubkey: key(index), isSigner: message.isAccountSigner(index), isWritable: message.isAccountWritable(index) })),
    }));
    const actualTopLevel = topLevel.map(normalize);
    const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(k => k.toBase58());
    if (signers.length !== 2 || !signers.includes(record.authorityAddress) || signers[0] !== record.envelope.feePayerAddress) reject("Confirmed signer or fee payer mismatch.");
    if (smartWalletEnvelopeDigest(actualTopLevel, signers[0], record.authorityAddress) !== record.envelope.envelopeDigest) {
      // A linked initialization signature is not a Kamino receipt.
      if (candidates.length > 1) continue;
      reject("Finalized transaction differs from the reviewed smart-wallet envelope.");
    }
    if (status.err || raw.meta.err) return { confirmed: false as const, status: "FAILED" as const, signature };
    const wrapper = topLevel.at(-1)!;
    const decoded = decodeCrossmintSolanaEnvelope(wrapper, record.action === "initialize");
    if (decoded.walletAddress !== record.walletAddress || decoded.authorityAddress !== record.authorityAddress
      || JSON.stringify(decoded.instructions) !== JSON.stringify(record.envelope.decodedInstructions)) reject("Finalized operation payload differs from the intended action.");
    const settings = await connection.getAccountInfo(new PublicKey(record.envelope.settingsAddress), "finalized");
    if (!settings?.owner.equals(new PublicKey(WRAPPER)) || settings.data.length < 8) reject("Initialized smart-wallet settings could not be verified.");
    const trace = (ix: { programIdIndex: number; accounts: number[]; data: string; stackHeight?: number | null }) => ({
      programId: key(ix.programIdIndex).toBase58(), accounts: ix.accounts.map(index => key(index).toBase58()), dataBase58: ix.data, stackHeight: ix.stackHeight,
    });
    const groups = (raw.meta.innerInstructions ?? []).map(group => ({ index: group.index, instructions: group.instructions.map(ix => trace(ix)) }));
    if (record.action === "initialize") {
      const balances = await readSmartWalletResultBalances(connection, record.walletAddress);
      if (decoded.instructions.length !== 0 || groups.some(group => group.instructions.length !== 0)
        || raw.meta.postBalances[keys.findIndex(k => k.toBase58() === record.walletAddress)] < raw.meta.preBalances[keys.findIndex(k => k.toBase58() === record.walletAddress)]) reject("Activation unexpectedly moved wallet assets.");
      return { confirmed: true as const, status: "COMPLETED" as const, signature, feeLamports: raw.meta.fee.toString(), balances };
    }
    if (!record.template) reject("Missing immutable intent.");
    const tokenBalances = (entries: typeof raw.meta.preTokenBalances) => (entries ?? []).map(entry => ({ accountIndex: entry.accountIndex, mint: entry.mint, owner: entry.owner ?? "", amount: entry.uiTokenAmount.amount, decimals: entry.uiTokenAmount.decimals }));
    const normalizedReceipt = { commitment: "finalized" as const, signature, accountKeys: keys.map(k => k.toBase58()), requiredSignerAddresses: signers, signatures: raw.transaction.signatures,
      topLevelInstructions: actualTopLevel.map(ix => ({ programId: ix.programId, accounts: ix.accounts.map(a => a.address), dataBase58: ix.dataBase58 })),
      meta: { err: raw.meta.err, fee: raw.meta.fee, preBalances: raw.meta.preBalances, postBalances: raw.meta.postBalances,
        preTokenBalances: tokenBalances(raw.meta.preTokenBalances), postTokenBalances: tokenBalances(raw.meta.postTokenBalances), innerInstructions: groups } };
    if (record.template.action === "markets-subscribe") {
      // A bond purchase has its own intent and receipt rules; it never goes through the Kamino validators.
      const { validateFinalizedSubscribeReceipt } = await import("./markets/purchase-receipt");
      const { readPurchaseBalances } = await import("./markets/purchase-server");
      const { markets } = record.template;
      const receipt = validateFinalizedSubscribeReceipt({
        intent: { walletAddress: record.walletAddress, feePayerAddress: record.envelope.feePayerAddress, units: markets.units, costAtomic: markets.costAtomic,
          computeUnitLimit: record.envelope.computeUnitLimit, computeUnitPriceMicroLamports: record.envelope.computeUnitPriceMicroLamports },
        terms: markets.terms,
        expectedDecodedWrapperInstructions: withTemplateAccountFlags(record.envelope.decodedInstructions, record.template.intentInstructions),
        receipt: normalizedReceipt,
      });
      const after = await readPurchaseBalances(record.walletAddress, markets.terms.mint);
      return { confirmed: true as const, status: "COMPLETED" as const, signature, feeLamports: receipt.feeLamports,
        purchase: { mint: receipt.mint, units: receipt.units, costAtomic: receipt.costAtomic, ...(after ?? {}) } };
    }
    const { validateIntent } = await import("./kamino-instruction-intent");
    const { validateFinalizedSmartWalletReceipt } = await import("./kamino-smart-wallet-receipt");
    const intent = validateIntent({ action: record.template.action, walletAddress: record.walletAddress,
      amountAtomic: record.template.amountAtomic, collateralAmountAtomic: record.template.collateralAmountAtomic, instructions: record.template.intentInstructions });
    const receipt = validateFinalizedSmartWalletReceipt({
      intent: { ...intent, feePayerAddress: record.envelope.feePayerAddress, computeUnitLimit: record.envelope.computeUnitLimit, computeUnitPriceMicroLamports: record.envelope.computeUnitPriceMicroLamports },
      expectedDecodedWrapperInstructions: withTemplateAccountFlags(record.envelope.decodedInstructions, record.template?.intentInstructions ?? []),
      receipt: normalizedReceipt,
    });
    const balances = await readSmartWalletResultBalances(connection, record.walletAddress);
    return { confirmed: true as const, status: "COMPLETED" as const, signature,
      actualLiquidityAmountAtomic: receipt.actualLiquidityAmountAtomic, actualCollateralAmountAtomic: receipt.actualCollateralAmountAtomic, feeLamports: receipt.feeLamports, balances };
  }
  return { confirmed: false as const, status: "PENDING" as const };
}

async function readSmartWalletResultBalances(connection: Connection, walletAddress: string) {
  const { getAccount } = await import("@solana/spl-token");
  const { KAMINO_LEND_DEVNET: route } = await import("./kamino-lend-devnet-config");
  const { kaminoWalletTokenAccount } = await import("./kamino-token-account");
  const owner = new PublicKey(walletAddress);
  const [liquidity, collateral, lamports] = await Promise.all([
    getAccount(connection, kaminoWalletTokenAccount(new PublicKey(route.liquidityMint), owner), "finalized"),
    getAccount(connection, kaminoWalletTokenAccount(new PublicKey(route.collateralMint), owner), "finalized").catch(error => { if (error?.name === "TokenAccountNotFoundError") return { amount: BigInt(0) }; throw error; }),
    connection.getBalance(owner, "finalized"),
  ]);
  if (!Number.isSafeInteger(lamports)) reject("Invalid wallet lamport balance.");
  return { liquidityAmountAtomic: liquidity.amount.toString(), collateralAmountAtomic: collateral.amount.toString(), solBalanceLamports: lamports.toString() };
}

/**
 * Crossmint's wrapper payload carries transaction-level merged signer/writable flags.
 * The exact payload was already pinned by the reviewed envelope digest, so for the
 * intent re-check use the server template's flags wherever the account address matches.
 */
function withTemplateAccountFlags(decoded: CanonicalInstruction[], template: CanonicalInstruction[]): CanonicalInstruction[] {
  return decoded.map(instruction => {
    const match = template.find(candidate => candidate.programId === instruction.programId && candidate.dataBase58 === instruction.dataBase58);
    if (!match) return instruction;
    return { ...instruction, accounts: instruction.accounts.map((account, index) => {
      const expected = match.accounts[index];
      return expected && expected.address === account.address ? { ...account, isSigner: expected.isSigner, isWritable: expected.isWritable } : account;
    }) };
  });
}
