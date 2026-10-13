import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import bs58 from "bs58";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  AuthorityType,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMint2Instruction,
  createInitializePermanentDelegateInstruction,
  createMintToCheckedInstruction,
  createSetAuthorityInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  tokenMetadataInitializeWithRentTransfer,
  tokenMetadataUpdateFieldWithRentTransfer,
} from "@solana/spl-token";
import {
  DEFAULT_TERMS,
  MICRO,
  SETTLEMENT_DECIMALS,
  buybackEntitlements,
  couponEntitlements,
  couponPerUnitMicro,
  canonicalSnapshotJson,
  redemptionEntitlements,
  snapshotHash,
  sumMicro,
  type Entitlement,
  type Holding,
  type Snapshot,
} from "@/lib/kase/entitlements";

/**
 * Devnet executor for the KASE corporate-actions prototype. Every state change is a real
 * Solana devnet transaction (SPL Token-2022 + Memo); only the fiat leg is simulated by a
 * test settlement token the issuer mints to itself.
 */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const BUYBACK_PERCENT_BPS = 2_000;
const HOLDER_UNITS = [10, 25, 40, 5, 20];
const HOLDER_LABELS = ["Holder A", "Holder B", "Holder C", "Holder D", "Holder E"];
const TREASURY_USD = BigInt(1_000_000);
const STATE_FILE = path.join(process.cwd(), ".data", "kase-state.json");

export type Phase = "none" | "issued" | "recorded" | "coupon_paid" | "bought_back" | "redeemed";
export type ActionKind = "issue" | "record" | "coupon" | "buyback" | "redeem";

type StoredEntitlement = { owner: string; units: string; amountMicro: string };
export type KaseAction = {
  id: string;
  kind: ActionKind;
  at: string;
  memo: string;
  signatures: string[];
  snapshotHash?: string;
  entitlements?: StoredEntitlement[];
  totalMicro?: string;
};
export type KaseSnapshot = {
  recordDate: string;
  slot: number;
  hash: string;
  json: string;
  signature: string;
};
export type KaseState = {
  version: 1;
  issuer: string;
  bondMint: string;
  settlementMint: string;
  issuedAt: string;
  maturityDate: string;
  holders: { label: string; owner: string }[];
  phase: Phase;
  snapshot?: KaseSnapshot;
  actions: KaseAction[];
};

export class KaseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function rpcUrl() {
  const cluster = process.env.SOLANA_CLUSTER;
  if (cluster && cluster !== "devnet") throw new KaseError("KASE prototype runs on Solana devnet only", 503);
  return process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
}

let connection: Connection | null = null;
function conn() {
  connection ??= new Connection(rpcUrl(), "confirmed");
  return connection;
}

function issuerSecret() {
  const secret = process.env.KASE_ISSUER_SECRET?.trim();
  if (!secret) throw new KaseError("KASE_ISSUER_SECRET is not configured", 503);
  return secret.startsWith("[") ? Uint8Array.from(JSON.parse(secret) as number[]) : bs58.decode(secret);
}

export function isKaseConfigured() {
  return Boolean(process.env.KASE_ISSUER_SECRET?.trim());
}

function issuer() {
  return Keypair.fromSecretKey(issuerSecret());
}

/** Holder wallets are derived from the issuer secret so no extra keys need to be stored; they never sign. */
function holderKeypair(index: number) {
  const seed = createHash("sha256").update(issuerSecret()).update(`kase-holder-${index}`).digest();
  return Keypair.fromSeed(seed);
}

function memoIx(text: string, signer: PublicKey) {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });
}

async function send(instructions: TransactionInstruction[], signers: Keypair[]) {
  const tx = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(conn(), tx, signers, { commitment: "confirmed" });
}

function ata(mint: string | PublicKey, owner: string | PublicKey) {
  return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, TOKEN_2022_PROGRAM_ID);
}

let cached: KaseState | null | undefined;
export async function loadState(): Promise<KaseState | null> {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(await readFile(STATE_FILE, "utf8")) as KaseState;
  } catch {
    cached = null;
  }
  return cached;
}

async function saveState(state: KaseState) {
  cached = state;
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function storeEntitlements(entitlements: Entitlement[]): StoredEntitlement[] {
  return entitlements.map((e) => ({ owner: e.owner, units: e.units.toString(), amountMicro: e.amountMicro.toString() }));
}

function actionId(kind: ActionKind, state: KaseState) {
  return `${kind.toUpperCase()}-${state.bondMint.slice(0, 6)}-${state.actions.length + 1}`;
}

function addYears(date: Date, years: number) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

/** Live holder registry: every Token-2022 account of the bond mint, read straight from chain. */
export async function readRegistry(bondMint: string, knownOwners: string[]) {
  const decode = (data: Buffer): Holding => ({
    owner: new PublicKey(data.subarray(32, 64)).toBase58(),
    units: data.readBigUInt64LE(64),
  });
  // Discover token accounts of the mint. The public devnet RPC excludes Token-2022 from
  // getProgramAccounts and rate-limits getTokenLargestAccounts, so each discovery method is
  // best-effort; the registered holders' ATAs are always included.
  const addresses = new Map(knownOwners.map((owner) => [ata(bondMint, owner).toBase58(), true]));
  try {
    const largest = await new Connection(rpcUrl(), { commitment: "confirmed", disableRetryOnRateLimit: true })
      .getTokenLargestAccounts(new PublicKey(bondMint), "confirmed");
    for (const a of largest.value) addresses.set(a.address.toBase58(), true);
  } catch {
    // Fall through to the registered holder accounts.
  }
  // One getMultipleAccounts call returns every balance as of the same slot.
  const keys = [...addresses.keys()].map((a) => new PublicKey(a));
  const accounts = await conn().getMultipleAccountsInfoAndContext(keys, "confirmed");
  const holdings = accounts.value.flatMap((account) =>
    account && account.owner.equals(TOKEN_2022_PROGRAM_ID) && account.data.length >= 165 && new PublicKey(account.data.subarray(0, 32)).toBase58() === bondMint
      ? [decode(account.data)]
      : [],
  );
  return { slot: accounts.context.slot, holdings };
}

async function bondSupply(bondMint: string) {
  const supply = await conn().getTokenSupply(new PublicKey(bondMint), "confirmed");
  return BigInt(supply.value.amount);
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function issue(): Promise<KaseState> {
  const payer = issuer();
  const bond = Keypair.generate();
  const settlement = Keypair.generate();
  const now = new Date();
  const maturity = addYears(now, DEFAULT_TERMS.tenorYears).toISOString().slice(0, 10);

  // 1. Bond mint: Token-2022, 0 decimals, permanent delegate = issuer (enables redemption burns), metadata pointer to itself.
  const mintLen = getMintLen([ExtensionType.MetadataPointer, ExtensionType.PermanentDelegate]);
  const mintRent = await conn().getMinimumBalanceForRentExemption(mintLen);
  const createBond = await send(
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: bond.publicKey,
        space: mintLen,
        lamports: mintRent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(bond.publicKey, payer.publicKey, bond.publicKey, TOKEN_2022_PROGRAM_ID),
      createInitializePermanentDelegateInstruction(bond.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
      createInitializeMint2Instruction(bond.publicKey, 0, payer.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    ],
    [payer, bond],
  );
  const metadataSig = await tokenMetadataInitializeWithRentTransfer(
    conn(),
    payer,
    bond.publicKey,
    payer.publicKey,
    payer,
    DEFAULT_TERMS.name,
    DEFAULT_TERMS.symbol,
    "https://plain.lengway.me/kase",
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );
  const terms = `face=${DEFAULT_TERMS.faceValueUsd}USD;coupon=${DEFAULT_TERMS.couponRateBps / 100}%;freq=${DEFAULT_TERMS.couponFrequency}/yr;issue=${now.toISOString().slice(0, 10)};maturity=${maturity};settlement=${settlement.publicKey.toBase58()}`;
  const termsSig = await tokenMetadataUpdateFieldWithRentTransfer(
    conn(),
    payer,
    bond.publicKey,
    payer.publicKey,
    "terms",
    terms,
    [],
    { commitment: "confirmed" },
    TOKEN_2022_PROGRAM_ID,
  );

  // 2. Test settlement token (stands in for USD cash; fiat rails are simulated) + issuer treasury.
  const settlementRent = await conn().getMinimumBalanceForRentExemption(getMintLen([]));
  const treasury = ata(settlement.publicKey, payer.publicKey);
  const createSettlement = await send(
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: settlement.publicKey,
        space: getMintLen([]),
        lamports: settlementRent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(settlement.publicKey, SETTLEMENT_DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, treasury, payer.publicKey, settlement.publicKey, TOKEN_2022_PROGRAM_ID),
      createMintToCheckedInstruction(settlement.publicKey, treasury, payer.publicKey, TREASURY_USD * MICRO, SETTLEMENT_DECIMALS, [], TOKEN_2022_PROGRAM_ID),
      memoIx(`KASE-TREASURY simulated fiat deposit ${TREASURY_USD} USD-test`, payer.publicKey),
    ],
    [payer, settlement],
  );

  // 3. Primary distribution to holders (2 holders per tx to stay under the packet limit).
  const holders = HOLDER_UNITS.map((_, i) => ({ label: HOLDER_LABELS[i], owner: holderKeypair(i).publicKey.toBase58() }));
  const distributeSigs: string[] = [];
  for (let i = 0; i < holders.length; i += 2) {
    const ixs: TransactionInstruction[] = [];
    for (const [offset, holder] of holders.slice(i, i + 2).entries()) {
      const owner = new PublicKey(holder.owner);
      const bondAta = ata(bond.publicKey, owner);
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, bondAta, owner, bond.publicKey, TOKEN_2022_PROGRAM_ID),
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(settlement.publicKey, owner), owner, settlement.publicKey, TOKEN_2022_PROGRAM_ID),
        createMintToCheckedInstruction(bond.publicKey, bondAta, payer.publicKey, BigInt(HOLDER_UNITS[i + offset]), 0, [], TOKEN_2022_PROGRAM_ID),
      );
    }
    ixs.push(memoIx(`KASE-ISSUE ${bond.publicKey.toBase58()} batch=${i / 2 + 1}`, payer.publicKey));
    distributeSigs.push(await send(ixs, [payer]));
  }

  const state: KaseState = {
    version: 1,
    issuer: payer.publicKey.toBase58(),
    bondMint: bond.publicKey.toBase58(),
    settlementMint: settlement.publicKey.toBase58(),
    issuedAt: now.toISOString(),
    maturityDate: maturity,
    holders,
    phase: "issued",
    actions: [],
  };
  state.actions.push({
    id: actionId("issue", state),
    kind: "issue",
    at: now.toISOString(),
    memo: `KASE-ISSUE ${state.bondMint}`,
    signatures: [createBond, metadataSig, termsSig, createSettlement, ...distributeSigs],
    entitlements: holders.map((h, i) => ({ owner: h.owner, units: String(HOLDER_UNITS[i]), amountMicro: "0" })),
  });
  await saveState(state);
  return state;
}

async function takeRecordDate(state: KaseState, label: string): Promise<KaseSnapshot> {
  const payer = issuer();
  const { slot, holdings } = await readRegistry(state.bondMint, state.holders.map((h) => h.owner));
  const recordDate = new Date().toISOString();
  const snapshot: Snapshot = { instrument: state.bondMint, recordDate, slot, holdings };
  const hash = snapshotHash(snapshot);
  const memo = `KASE-RECORD ${state.bondMint} ${recordDate.slice(0, 10)} ${label} slot=${slot} sha256=${hash}`;
  const signature = await send([memoIx(memo, payer.publicKey)], [payer]);
  return { recordDate, slot, hash, json: canonicalSnapshotJson(snapshot), signature };
}

function snapshotHoldings(snapshot: KaseSnapshot): Holding[] {
  const parsed = JSON.parse(snapshot.json) as { holdings: [string, string][] };
  return parsed.holdings.map(([owner, units]) => ({ owner, units: BigInt(units) }));
}

async function record(state: KaseState) {
  if (state.phase !== "issued") throw new KaseError("Record date is taken once, right after issuance");
  const snapshot = await takeRecordDate(state, "coupon-1");
  state.snapshot = snapshot;
  state.phase = "recorded";
  state.actions.push({
    id: actionId("record", state),
    kind: "record",
    at: snapshot.recordDate,
    memo: `KASE-RECORD sha256=${snapshot.hash}`,
    signatures: [snapshot.signature],
    snapshotHash: snapshot.hash,
    entitlements: storeEntitlements(snapshotHoldings(snapshot).map((h) => ({ ...h, amountMicro: BigInt(0) }))),
  });
  await saveState(state);
}

function paymentIxs(state: KaseState, payer: PublicKey, entitlements: Entitlement[], burn: boolean) {
  const treasury = ata(state.settlementMint, payer);
  const ixs: TransactionInstruction[] = [];
  for (const e of entitlements) {
    if (e.amountMicro > BigInt(0)) {
      ixs.push(
        createTransferCheckedInstruction(treasury, new PublicKey(state.settlementMint), ata(state.settlementMint, e.owner), payer, e.amountMicro, SETTLEMENT_DECIMALS, [], TOKEN_2022_PROGRAM_ID),
      );
    }
    if (burn && e.units > BigInt(0)) {
      // Issuer signs as the mint's permanent delegate: no holder signature needed to retire the bonds.
      ixs.push(createBurnCheckedInstruction(ata(state.bondMint, e.owner), new PublicKey(state.bondMint), payer, e.units, 0, [], TOKEN_2022_PROGRAM_ID));
    }
  }
  return ixs;
}

async function payCoupon(state: KaseState) {
  if (state.phase !== "recorded" || !state.snapshot) throw new KaseError("Take the record date before paying the coupon");
  const payer = issuer();
  const id = actionId("coupon", state);
  const entitlements = couponEntitlements(DEFAULT_TERMS, snapshotHoldings(state.snapshot));
  const memo = `KASE-COUPON ${id} period=1/4 perBond=${couponPerUnitMicro(DEFAULT_TERMS) / MICRO}USD snap=${state.snapshot.hash}`;
  const signature = await send([memoIx(memo, payer.publicKey), ...paymentIxs(state, payer.publicKey, entitlements, false)], [payer]);
  state.phase = "coupon_paid";
  state.actions.push({
    id,
    kind: "coupon",
    at: new Date().toISOString(),
    memo,
    signatures: [signature],
    snapshotHash: state.snapshot.hash,
    entitlements: storeEntitlements(entitlements),
    totalMicro: sumMicro(entitlements).toString(),
  });
  await saveState(state);
}

async function buyback(state: KaseState) {
  if (state.phase !== "coupon_paid") throw new KaseError("Partial buyback runs after the first coupon");
  const payer = issuer();
  const id = actionId("buyback", state);
  const snapshot = await takeRecordDate(state, "buyback");
  const entitlements = buybackEntitlements(DEFAULT_TERMS, snapshotHoldings(snapshot), BUYBACK_PERCENT_BPS);
  const memo = `KASE-BUYBACK ${id} ${BUYBACK_PERCENT_BPS / 100}% pro-rata at par snap=${snapshot.hash}`;
  const signature = await send([memoIx(memo, payer.publicKey), ...paymentIxs(state, payer.publicKey, entitlements, true)], [payer]);
  state.phase = "bought_back";
  state.snapshot = snapshot;
  state.actions.push({
    id,
    kind: "buyback",
    at: new Date().toISOString(),
    memo,
    signatures: [snapshot.signature, signature],
    snapshotHash: snapshot.hash,
    entitlements: storeEntitlements(entitlements),
    totalMicro: sumMicro(entitlements).toString(),
  });
  await saveState(state);
}

async function redeem(state: KaseState) {
  if (state.phase !== "bought_back") throw new KaseError("Redemption at maturity is the final step");
  const payer = issuer();
  const id = actionId("redeem", state);
  const snapshot = await takeRecordDate(state, "maturity");
  const entitlements = redemptionEntitlements(DEFAULT_TERMS, snapshotHoldings(snapshot));
  const memo = `KASE-REDEEM ${id} principal+final-coupon snap=${snapshot.hash}`;
  const signature = await send(
    [
      memoIx(memo, payer.publicKey),
      ...paymentIxs(state, payer.publicKey, entitlements, true),
      // Mark the instrument redeemed: no further bonds can ever be minted.
      createSetAuthorityInstruction(new PublicKey(state.bondMint), payer.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID),
    ],
    [payer],
  );
  if ((await bondSupply(state.bondMint)) !== BigInt(0)) throw new KaseError("Bond supply is not zero after redemption", 500);
  state.phase = "redeemed";
  state.snapshot = snapshot;
  state.actions.push({
    id,
    kind: "redeem",
    at: new Date().toISOString(),
    memo,
    signatures: [snapshot.signature, signature],
    snapshotHash: snapshot.hash,
    entitlements: storeEntitlements(entitlements),
    totalMicro: sumMicro(entitlements).toString(),
  });
  await saveState(state);
}

// One action at a time: serialising execution makes double-clicks and concurrent visitors unable to double-pay.
let queue: Promise<unknown> = Promise.resolve();
let lastResetAt = 0;

export type KaseCommand = "issue" | "record" | "coupon" | "buyback" | "redeem";

export function runCommand(command: KaseCommand): Promise<KaseState> {
  const job = queue.then(async () => {
    const state = await loadState();
    if (command === "issue") {
      if (state && state.phase !== "redeemed" && Date.now() - lastResetAt < 60_000) {
        throw new KaseError("A fresh instrument was issued less than a minute ago", 429);
      }
      lastResetAt = Date.now();
      return issue();
    }
    if (!state) throw new KaseError("Issue the bond first");
    if (command === "record") await record(state);
    else if (command === "coupon") await payCoupon(state);
    else if (command === "buyback") await buyback(state);
    else if (command === "redeem") await redeem(state);
    return state;
  });
  queue = job.catch(() => undefined);
  return job;
}

export async function readView() {
  const state = await loadState();
  if (!state) return { configured: isKaseConfigured(), state: null, registry: null };
  // One getMultipleAccounts call: bond mint (supply), each holder's bond ATA and cash ATA, all at one slot.
  const keys = [
    new PublicKey(state.bondMint),
    ...state.holders.flatMap((h) => [ata(state.bondMint, h.owner), ata(state.settlementMint, h.owner)]),
  ];
  const { context, value } = await conn().getMultipleAccountsInfoAndContext(keys, "confirmed");
  const amount = (index: number) => {
    const data = value[index]?.data;
    return data && data.length >= 72 ? data.readBigUInt64LE(64).toString() : "0";
  };
  const supply = value[0]?.data ? value[0].data.readBigUInt64LE(36).toString() : "0";
  return {
    configured: true,
    state,
    registry: {
      slot: context.slot,
      supply,
      holders: state.holders.map((h, i) => ({ ...h, units: amount(1 + i * 2), cashMicro: amount(2 + i * 2) })),
    },
  };
}
