import "server-only";

/**
 * Server side of a smart-wallet bond purchase: reads the trusted terms from the pinned program,
 * checks the offering would accept the purchase (friendly errors before Crossmint is involved),
 * builds the exact wallet payload and self-validates it with `validateSubscribeIntent`.
 *
 * The template is handed to the shared smart-wallet executor (`lib/kamino-smart-wallet-executor.ts`),
 * which wraps it through Crossmint, inspects the envelope and later verifies the finalized receipt
 * with `validateFinalizedSubscribeReceipt`.
 */
import bs58 from "bs58";
import { PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, unpackAccount } from "@solana/spl-token";

import type { CanonicalInstruction } from "../kamino-instruction-intent";
import { KaminoLendDevnetError } from "../kamino-lend-devnet-config";
import { PLAIN_MARKETS_PROGRAM_ID, enumName, toBigInt, type InstrumentRef, type OfferingAccount } from "./client";
import { issueStateOf } from "./devnet-service";
import { allocationWindow } from "./investor";
import {
  CIRCLE_DEVNET_USDC_ADDRESS,
  MARKETS_SUBSCRIBE_ACTION,
  MAX_UNITS_PER_PURCHASE,
  PLAIN_MARKETS_PROGRAM,
  SPL_TOKEN_PROGRAM,
  subscribeAccounts,
  validateSubscribeIntent,
  type SubscribeTerms,
} from "./purchase";
import { marketsReader } from "./server";
import { rpcRetry } from "./signature-feed";

export type MarketsSubscribeTemplate = {
  serializedTransaction: string;
  intentInstructions: CanonicalInstruction[];
  action: typeof MARKETS_SUBSCRIBE_ACTION;
  walletAddress: string;
  /** Units (bond units are indivisible, so the atomic amount is the unit count). */
  amountAtomic: string;
  collateralAmountAtomic: null;
  blockhash: string;
  lastValidBlockHeight: number;
  markets: { terms: SubscribeTerms; units: string; costAtomic: string; instrument: string };
};

function reject(code: string, message: string): never {
  throw new KaminoLendDevnetError(code, message);
}

export function marketsPurchasesEnabled() {
  return process.env.MARKETS_MODE === "devnet" && process.env.SOLANA_CLUSTER === "devnet";
}

function parseUnits(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,9}$/.test(value)) reject("INVALID_AMOUNT", "Choose a whole number of units.");
  const units = BigInt(value);
  if (units > MAX_UNITS_PER_PURCHASE) reject("AMOUNT_LIMIT", `At most ${MAX_UNITS_PER_PURCHASE} units per purchase.`);
  return units;
}

function canonical(ix: TransactionInstruction): CanonicalInstruction {
  return {
    programId: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({ address: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    dataBase58: bs58.encode(ix.data),
  };
}

/** Plain words for every reason the program would refuse the purchase right now. */
export function purchaseBlocker(input: {
  instrument: InstrumentRef["account"];
  offering: OfferingAccount | null;
  now: number;
  units: bigint;
  heldUnits: bigint;
  settlementBalance: bigint;
}): { code: string; message: string } | null {
  const { offering, now, units } = input;
  if (!offering) return { code: "OFFERING_CLOSED", message: "This bond has no open offering." };
  const window = allocationWindow(issueStateOf(input.instrument), now);
  if (offering.closed) return { code: "OFFERING_CLOSED", message: "The offering is closed." };
  if (now < Number(toBigInt(offering.startTs))) return { code: "OFFERING_CLOSED", message: "The offering has not opened yet." };
  if (now >= Number(toBigInt(offering.endTs))) return { code: "OFFERING_CLOSED", message: "The offering period has ended." };
  if (!window.open) return { code: "OFFERING_CLOSED", message: window.reason.replace(/Allocations/g, "Purchases") };
  const left = toBigInt(offering.capUnits) - toBigInt(offering.soldUnits);
  if (units > left) return { code: "OFFERING_SOLD_OUT", message: left > BigInt(0) ? `Only ${left} units are left in this offering.` : "The offering is sold out." };
  const room = toBigInt(offering.perHolderCap) - input.heldUnits;
  if (units > room) return { code: "HOLDER_CAP", message: room > BigInt(0) ? `You can buy up to ${room} more units (limit ${toBigInt(offering.perHolderCap)} per investor).` : "You already hold the maximum for this bond." };
  const cost = units * toBigInt(offering.issuePrice);
  if (input.settlementBalance < cost) return { code: "INSUFFICIENT_LIQUIDITY_BALANCE", message: "Your USDC balance doesn't cover this purchase." };
  return null;
}

export async function prepareMarketsSubscribeTemplate(input: { walletAddress: string; mint: unknown; units: unknown }): Promise<MarketsSubscribeTemplate> {
  if (!marketsPurchasesEnabled()) reject("DEVNET_DISABLED", "Bond purchases are unavailable.");
  if (PLAIN_MARKETS_PROGRAM_ID.toBase58() !== PLAIN_MARKETS_PROGRAM) reject("PROGRAM_UNVERIFIED", "Markets program id does not match the pinned program.");
  const reader = marketsReader();
  if (!reader) reject("DEVNET_DISABLED", "Bond purchases are unavailable.");
  const units = parseUnits(input.units);
  if (typeof input.mint !== "string" || !(await reader.listInstruments()).some((i) => i.mint === input.mint)) reject("INVALID_ACTION", "Unknown bond.");
  const mint = new PublicKey(input.mint);
  const wallet = new PublicKey(input.walletAddress);
  const connection = reader.connection;

  // Fresh reads (never the cached indexer state): program, instrument, offering, wallet accounts.
  const programInfo = await rpcRetry(() => connection.getAccountInfo(PLAIN_MARKETS_PROGRAM_ID, "confirmed"));
  if (!programInfo?.executable) reject("PROGRAM_UNVERIFIED", "Markets program could not be verified on devnet.");
  const instrument = await rpcRetry(() => reader.client.fetchInstrumentByMint(mint));
  if (!instrument) reject("INVALID_ACTION", "Unknown bond.");
  const a = instrument.account;
  if (a.settlementMint.toBase58() !== CIRCLE_DEVNET_USDC_ADDRESS || a.settlementTokenProgram.toBase58() !== SPL_TOKEN_PROGRAM) {
    reject("SETTLEMENT_UNSUPPORTED", "This bond is not sold for USDC.");
  }
  if (enumName(a.status) !== "Active") reject("OFFERING_CLOSED", "This bond is no longer active.");
  const offering = await rpcRetry(() => reader.client.fetchOffering(instrument.address));
  const terms: SubscribeTerms = {
    mint: mint.toBase58(),
    issuePrice: offering ? toBigInt(offering.account.issuePrice).toString() : "1",
    allowlistEnabled: a.allowlistEnabled,
    settlementMint: CIRCLE_DEVNET_USDC_ADDRESS,
    settlementTokenProgram: SPL_TOKEN_PROGRAM,
  };
  const accounts = subscribeAccounts(wallet.toBase58(), terms);
  const keys = [accounts.buyerBond, accounts.buyerSettlement, ...(accounts.allowEntry ? [accounts.allowEntry] : [])].map((k) => new PublicKey(k));
  const [bondInfo, usdcInfo, allowInfo] = await rpcRetry(() => connection.getMultipleAccountsInfo(keys, "confirmed"));
  const heldUnits = bondInfo ? unpackAccount(keys[0], bondInfo, TOKEN_2022_PROGRAM_ID).amount : BigInt(0);
  const usdc = usdcInfo ? unpackAccount(keys[1], usdcInfo).amount : BigInt(0);
  if (a.allowlistEnabled && !allowInfo) reject("NOT_ALLOWLISTED", "This bond is restricted to approved investors.");
  const blocker = purchaseBlocker({ instrument: a, offering: offering?.account ?? null, now: await reader.clusterNow(), units, heldUnits, settlementBalance: usdc });
  if (blocker) reject(blocker.code, blocker.message);
  const cost = units * BigInt(terms.issuePrice);

  const ixs: TransactionInstruction[] = [];
  if (!bondInfo) ixs.push(createAssociatedTokenAccountIdempotentInstruction(wallet, new PublicKey(accounts.buyerBond), wallet, mint, TOKEN_2022_PROGRAM_ID));
  ixs.push(await reader.client.subscribe(instrument, wallet, units, cost));
  const intentInstructions = ixs.map(canonical);
  // The builder (Anchor client) and the validator (independent derivation) must agree exactly.
  validateSubscribeIntent({ action: MARKETS_SUBSCRIBE_ACTION, walletAddress: wallet.toBase58(), units: units.toString(), costAtomic: cost.toString(), instructions: intentInstructions }, terms);

  const latest = await rpcRetry(() => connection.getLatestBlockhash("confirmed"));
  // Crossmint replaces the fee-payer placeholder (the wallet) with its sponsor and wraps the payload.
  const message = new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions: ixs }).compileToV0Message();
  return {
    serializedTransaction: bs58.encode(new VersionedTransaction(message).serialize()),
    intentInstructions,
    action: MARKETS_SUBSCRIBE_ACTION,
    walletAddress: wallet.toBase58(),
    amountAtomic: units.toString(),
    collateralAmountAtomic: null,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    markets: { terms, units: units.toString(), costAtomic: cost.toString(), instrument: instrument.address.toBase58() },
  };
}

/** Post-trade balances shown in the Done state (finalized reads). */
export async function readPurchaseBalances(walletAddress: string, mint: string) {
  const reader = marketsReader();
  if (!reader) return null;
  const accounts = subscribeAccounts(walletAddress, { mint, allowlistEnabled: false });
  const [bond, usdc] = await rpcRetry(() => reader.connection.getMultipleAccountsInfo([new PublicKey(accounts.buyerBond), new PublicKey(accounts.buyerSettlement)], "finalized"));
  return {
    bondUnits: (bond ? unpackAccount(new PublicKey(accounts.buyerBond), bond, TOKEN_2022_PROGRAM_ID).amount : BigInt(0)).toString(),
    usdcAtomic: (usdc ? unpackAccount(new PublicKey(accounts.buyerSettlement), usdc).amount : BigInt(0)).toString(),
  };
}
