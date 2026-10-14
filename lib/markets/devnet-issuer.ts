/**
 * Server-side issuer for Plain Markets on devnet: builds, signs and sends the program's
 * instructions with the issuer key from `MARKETS_ISSUER_SECRET`. Used by the `/api/markets/*`
 * routes and the seed script; never imported by client code.
 *
 * The issuer is also the paying agent and the snapshot indexer. Demo custody wallets (for `claim`
 * and `vote` from the console) are derived deterministically from the issuer secret, so no extra
 * secret is needed and their public keys can be listed in the console's directory.
 */
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SendTransactionError, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";

import { bondAta, enumName, marketsErrorFromCode, pda, toBigInt, type ActionKind, type ActionRef, type ActionStatus, type InstrumentRef } from "./client";
import { issueStateOf, type DevnetLedger, type MarketsExecutor } from "./devnet-service";
import { actionTotals } from "./entitlements";
import { allocationMemo, checkAllocation, type AllocationLimits } from "./investor";
import { actionTitle } from "./lifecycle";
import { actionTerms } from "./math";
import { buildSnapshotTree, snapshotHash } from "./merkle";
import {
  chunkHoldings,
  encodeHoldings,
  memoInstruction,
  snapshotInlineMemo,
  snapshotPartMemo,
  snapshotPartsMemo,
  termsHash,
  termsJson,
  termsMemo,
  type TermsDocument,
} from "./publication";
import { replayRegister } from "./chain-history";
import { readRegister } from "./register";
import { rpcRetry } from "./signature-feed";
import type { ActionDraft, Address, Instrument, TxResult } from "./service";

const MAX_TX = 1232;
const PART_CHUNK = 800;
const DEMO_HOLDER_COUNT = 8;

export class IssuerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "IssuerError";
  }
}

/** Accepts a JSON byte array (Solana CLI format) or base58. Returns null when unset. */
export function parseSecretKey(raw: string | undefined | null): Keypair | null {
  const text = raw?.trim();
  if (!text) return null;
  const bytes = text.startsWith("[") ? Uint8Array.from(JSON.parse(text) as number[]) : bs58.decode(text);
  if (bytes.length !== 64) throw new Error("MARKETS_ISSUER_SECRET must be a 64-byte secret key (JSON array or base58)");
  return Keypair.fromSecretKey(bytes);
}

/** Demo custody wallet #i, derived from the issuer secret (stable across restarts). */
export function demoHolderKeypair(issuer: Keypair, index: number): Keypair {
  const seed = sha256(new Uint8Array([...issuer.secretKey, ...new TextEncoder().encode(`plain-markets/demo-holder/${index}`)]));
  return Keypair.fromSeed(seed);
}

export function demoHolders(issuer: Keypair, count = DEMO_HOLDER_COUNT) {
  return Array.from({ length: count }, (_, i) => demoHolderKeypair(issuer, i));
}

export const DEMO_HOLDER_LABELS = [
  "Pension fund · custody account",
  "Asset manager · custody account",
  "Broker omnibus account",
  "Retail investor · Plain smart wallet",
  "Retail investor · Plain smart wallet",
  "Insurance company · custody account",
  "Bank treasury · custody account",
  "Retail investor · Plain smart wallet",
];

const STATUS_ORDER: Record<ActionStatus, number> = { Announced: 0, RecordLocked: 1, SnapshotPosted: 2, Funded: 3, Settling: 4, Settled: 5, Cancelled: -1 };

/** Human message from a failed simulation / transaction (Anchor error message when available). */
export function programErrorMessage(error: unknown, logs?: string[] | null): string {
  const lines = logs ?? (error instanceof SendTransactionError ? (error.logs ?? []) : []);
  for (const line of lines) {
    const m = line.match(/Error Code: (\w+)\. Error Number: \d+\. Error Message: (.+?)\.?$/);
    if (m) return `${m[2]} (${m[1]})`;
  }
  const text = error instanceof Error ? error.message : String(error);
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex) {
    const e = marketsErrorFromCode(parseInt(hex[1], 16));
    if (e) return `${e.msg} (${e.name})`;
  }
  if (/insufficient (funds|lamports)/i.test(text) || lines.some((l) => /insufficient lamports/.test(l))) return "The issuer wallet is out of devnet SOL for fees.";
  if (/blockhash not found|block height exceeded/i.test(text)) return "The transaction expired before it landed. Try again.";
  return text.replace(/\s+/g, " ").slice(0, 300);
}

export class DevnetIssuer implements MarketsExecutor {
  private readonly holders: Map<string, Keypair>;

  constructor(
    private readonly reader: DevnetLedger,
    readonly issuer: Keypair,
    holders: Keypair[] = demoHolders(issuer),
  ) {
    this.holders = new Map(holders.map((k) => [k.publicKey.toBase58(), k]));
  }

  private get connection() {
    return this.reader.connection;
  }

  private get client() {
    return this.reader.client;
  }

  /** Sign with the issuer (fee payer) and any extra signers, send, confirm by polling. */
  async send(ixs: TransactionInstruction[], extra: Keypair[] = []): Promise<TxResult> {
    const c = this.connection;
    const { blockhash, lastValidBlockHeight } = await rpcRetry(() => c.getLatestBlockhash("confirmed"));
    const tx = new Transaction({ feePayer: this.issuer.publicKey, blockhash, lastValidBlockHeight });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
    tx.sign(this.issuer, ...extra);
    const raw = tx.serialize();
    let signature: string;
    try {
      // Resending the same signed bytes is idempotent, so rate-limit retries are safe.
      signature = await rpcRetry(() => c.sendRawTransaction(raw, { preflightCommitment: "confirmed", maxRetries: 3 }));
    } catch (error) {
      throw new IssuerError(programErrorMessage(error));
    }
    const deadline = Date.now() + 75_000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1_200));
      const { value } = await rpcRetry(() => c.getSignatureStatuses([signature]));
      const st = value[0];
      if (st?.err) {
        const failed = await rpcRetry(() => c.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })).catch(() => null);
        throw new IssuerError(programErrorMessage(new Error(JSON.stringify(st.err)), failed?.meta?.logMessages));
      }
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
        const ts = (await rpcRetry(() => c.getBlockTime(st.slot)).catch(() => null)) ?? Math.floor(Date.now() / 1000);
        this.reader.changed();
        return { signature, slot: st.slot, ts };
      }
      if (Date.now() > deadline) {
        const height = await rpcRetry(() => c.getBlockHeight("confirmed")).catch(() => 0);
        if (height > lastValidBlockHeight) throw new IssuerError("The transaction expired before it landed. Try again.");
        throw new IssuerError(`Not confirmed yet: ${signature}. Check the explorer before retrying.`, 504);
      }
    }
  }

  /** Serialized size of a transaction with these instructions (issuer + extra signers). */
  private size(ixs: TransactionInstruction[], signers = 1) {
    const tx = new Transaction({ feePayer: this.issuer.publicKey, blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 0 });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
    return tx.serializeMessage().length + 1 + 64 * signers;
  }

  private async load(actionId: Address): Promise<{ inst: InstrumentRef; action: ActionRef; status: ActionStatus; kind: ActionKind }> {
    let key: PublicKey;
    try {
      key = new PublicKey(actionId);
    } catch {
      throw new IssuerError("Not a valid action address.");
    }
    const action = await rpcRetry(() => this.client.fetchAction(key));
    if (!action) throw new IssuerError("Corporate action not found.", 404);
    const inst = await rpcRetry(() => this.client.fetchInstrument(action.account.instrument));
    if (!inst) throw new IssuerError("Instrument not found.", 404);
    if (!inst.account.issuer.equals(this.issuer.publicKey)) throw new IssuerError("This server is not the issuer of that instrument.", 403);
    return { inst, action, status: enumName(action.account.status), kind: enumName(action.account.kind) };
  }

  private async instrumentByMint(mint: Address): Promise<InstrumentRef> {
    let key: PublicKey;
    try {
      key = new PublicKey(mint);
    } catch {
      throw new IssuerError("Not a valid mint address.");
    }
    const inst = await rpcRetry(() => this.client.fetchInstrumentByMint(key));
    if (!inst) throw new IssuerError("Instrument not found.", 404);
    if (!inst.account.issuer.equals(this.issuer.publicKey)) throw new IssuerError("This server is not the issuer of that instrument.", 403);
    return inst;
  }

  // ---- lifecycle --------------------------------------------------------------------------------

  async announce(mint: Address, draft: ActionDraft): Promise<TxResult & { actionId: Address }> {
    const inst = await this.instrumentByMint(mint);
    validateDraft(draft);
    const now = await this.reader.clusterNow();
    if (draft.recordTs < now + 15) throw new IssuerError("The record date must be at least 15 seconds in the future.");
    const terms = actionTerms(draft.params);
    const ui = (await this.reader.getInstrument(mint)) as Instrument;
    const title = truncateUtf8(actionTitle(ui, draft), 64);
    const doc: TermsDocument = {
      v: 1,
      kind: draft.kind,
      title,
      recordTs: draft.recordTs,
      paymentTs: draft.paymentTs,
      claimDeadlineTs: draft.claimDeadlineTs,
      rateBps: terms.rateBps,
      redeemBps: terms.redeemBps,
      priceBps: terms.priceBps,
      options: draft.params.kind === "Vote" ? draft.params.options : [],
      question: draft.params.kind === "Vote" ? draft.params.question : null,
    };
    const json = termsJson(doc);
    const { ix, action } = await this.client.announce(inst, {
      kind: draft.kind,
      title,
      termsHash: termsHash(json),
      recordTs: draft.recordTs,
      paymentTs: draft.paymentTs,
      claimDeadline: draft.claimDeadlineTs,
      rateBps: terms.rateBps,
      redeemBps: terms.redeemBps,
      priceBps: terms.priceBps,
      options: doc.options,
    });
    const ixs = [memoInstruction(termsMemo(json)), ix];
    if (this.size(ixs) > MAX_TX) throw new IssuerError("The announcement text is too long for one transaction. Shorten the question.");
    return { ...(await this.send(ixs)), actionId: action.toBase58() };
  }

  async lockRecord(actionId: Address) {
    const { inst, action, status } = await this.load(actionId);
    if (status !== "Announced") throw new IssuerError(`The register is already locked (status ${status}).`);
    return this.send([await this.client.lockRecord(inst, action.address, this.issuer.publicKey)]);
  }

  /** Reads the register, publishes it in a memo and posts root, hash and totals. */
  async postSnapshot(actionId: Address) {
    const { inst, action, status, kind } = await this.load(actionId);
    if (status !== "RecordLocked") throw new IssuerError(`Lock the register first (status ${status}).`);
    const register = await this.readRecordRegister(inst);
    const recordSupply = toBigInt(action.account.recordSupply);
    if (register.supply !== recordSupply) throw new IssuerError(`Supply changed since the record date (${register.supply} vs ${recordSupply}).`);
    const snapshot = {
      version: 1 as const,
      instrument: inst.address.toBase58(),
      mint: inst.account.mint.toBase58(),
      action: actionId,
      recordTs: Number(toBigInt(action.account.recordTs)),
      slot: register.slot,
      holdings: register.holdings,
    };
    const tree = buildSnapshotTree(actionId, snapshot.holdings);
    const a = action.account;
    const totals = actionTotals(
      { faceValue: toBigInt(inst.account.faceValue), couponBps: inst.account.couponBps, frequency: inst.account.couponFrequency },
      { kind, rateBps: a.rateBps, redeemBps: a.redeemBps, priceBps: a.priceBps },
      tree.holdings,
    );
    const post = await this.client.postSnapshot(inst, action.address, {
      merkleRoot: tree.root,
      snapshotHash: snapshotHash(snapshot),
      totalUnits: tree.totalUnits,
      holderCount: tree.holdings.length,
      totalRedeemUnits: kind === "PartialRedemption" ? totals.totalRedeemUnits : BigInt(0),
    });
    const inline = [memoInstruction(snapshotInlineMemo(register.slot, tree.holdings)), post];
    if (this.size(inline) <= MAX_TX) return this.send(inline);
    const chunks = chunkHoldings(encodeHoldings(tree.holdings), PART_CHUNK);
    const parts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      parts.push((await this.send([memoInstruction(snapshotPartMemo(actionId, i, chunks.length, chunks[i]))])).signature);
    }
    return this.send([memoInstruction(snapshotPartsMemo(register.slot, parts)), post]);
  }

  /**
   * The register to commit. Known holders (demo custody wallets, every earlier snapshot) are read
   * directly and must reconcile with the supply; otherwise the full history is replayed to find
   * holders that arrived through secondary transfers.
   */
  private async readRecordRegister(inst: InstrumentRef) {
    const mint = inst.account.mint;
    const candidates = new Set([...this.holders.keys(), ...(await this.reader.plainInvestors(mint.toBase58()))]);
    for (const a of await this.reader.listActions(mint.toBase58())) for (const h of (await this.reader.getSnapshot(a.id))?.holdings ?? []) candidates.add(h.holder);
    try {
      return await rpcRetry(() => readRegister(this.connection, mint, { candidates: [...candidates].map((a) => new PublicKey(a)) }));
    } catch (error) {
      if (!/does not reconcile/.test(error instanceof Error ? error.message : "")) throw error;
      const feed = await this.reader.feed(inst.address);
      await feed.refresh();
      const replay = await replayRegister(this.connection, mint.toBase58(), feed.sigs, Number.MAX_SAFE_INTEGER);
      for (const h of replay.holdings) candidates.add(h.holder);
      return readRegister(this.connection, mint, { candidates: [...candidates].map((a) => new PublicKey(a)) });
    }
  }

  /** Deposits what is still owed. On devnet the issuer mints its own test USD if short. */
  async fund(actionId: Address) {
    const { inst, action, status, kind } = await this.load(actionId);
    if (kind === "Vote") throw new IssuerError("Votes do not need funding.");
    if (status !== "SnapshotPosted") throw new IssuerError(`Funding opens after the snapshot (status ${status}).`);
    const owed = toBigInt(action.account.totalEntitlement) - toBigInt(action.account.fundedAmount);
    if (owed <= BigInt(0)) throw new IssuerError("Already fully funded.");
    const { settlementMint, settlementTokenProgram } = inst.account;
    const ata = getAssociatedTokenAddressSync(settlementMint, this.issuer.publicKey, true, settlementTokenProgram);
    const [ataInfo, mintInfo] = await rpcRetry(() => this.connection.getMultipleAccountsInfo([ata, settlementMint], "confirmed"));
    const balance = ataInfo ? unpackAccount(ata, ataInfo, settlementTokenProgram).amount : BigInt(0);
    const ixs: TransactionInstruction[] = [];
    if (balance < owed) {
      const mint = mintInfo ? unpackMint(settlementMint, mintInfo, settlementTokenProgram) : null;
      if (!mint?.mintAuthority?.equals(this.issuer.publicKey)) throw new IssuerError("The issuer treasury holds too little of the settlement token to fund this action.");
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(this.issuer.publicKey, ata, this.issuer.publicKey, settlementMint, settlementTokenProgram),
        createMintToInstruction(settlementMint, ata, this.issuer.publicKey, owed - balance, [], settlementTokenProgram),
      );
    }
    ixs.push(await this.client.fund(inst, action.address, owed, ata));
    return this.send(ixs);
  }

  /** Snapshot trees are immutable once posted: cache them per action. */
  private readonly trees = new Map<string, ReturnType<typeof buildSnapshotTree>>();

  private async proof(actionId: Address, holder: Address) {
    let tree = this.trees.get(actionId);
    if (!tree) {
      const snapshot = await this.reader.getSnapshot(actionId);
      if (!snapshot) throw new IssuerError("No published snapshot for this action.");
      tree = buildSnapshotTree(actionId, snapshot.holdings);
      this.trees.set(actionId, tree);
    }
    const leaf = tree.holdingOf(holder);
    if (!leaf) throw new IssuerError("This wallet is not in the record-date snapshot.");
    return { units: leaf.units, proof: tree.proof(holder) };
  }

  /** Paying agent pushes one holder's entitlement. */
  async pay(actionId: Address, holder: Address) {
    const { inst, action, status, kind } = await this.load(actionId);
    if (kind === "Vote") throw new IssuerError("Votes have no payment.");
    if (STATUS_ORDER[status] < STATUS_ORDER.Funded || status === "Settled") throw new IssuerError(`Payments run after funding (status ${status}).`);
    const { units, proof } = await this.proof(actionId, holder);
    return this.send([await this.client.pay(inst, action, this.issuer.publicKey, new PublicKey(holder), units, proof)]);
  }

  private holderKey(holder: Address) {
    const key = this.holders.get(holder);
    if (!key) throw new IssuerError("Only the holder can sign this. The console signs for demo custody wallets only.", 403);
    return key;
  }

  /** Demo custody wallet pulls its own entitlement (holder signs, issuer pays the fee). */
  async claim(actionId: Address, holder: Address) {
    const key = this.holderKey(holder);
    const { inst, action, kind } = await this.load(actionId);
    if (kind === "Vote") throw new IssuerError("Votes have no payment.");
    const { units, proof } = await this.proof(actionId, holder);
    return this.send([await this.client.claim(inst, action, key.publicKey, units, proof)], [key]);
  }

  /** Demo custody wallet votes with its snapshot weight. */
  async vote(actionId: Address, holder: Address, choice: number) {
    const key = this.holderKey(holder);
    const { inst, action, kind } = await this.load(actionId);
    if (kind !== "Vote") throw new IssuerError("This action is not a vote.");
    if (!Number.isInteger(choice) || choice < 0 || choice >= action.account.options.length) throw new IssuerError("Unknown option.");
    const { units, proof } = await this.proof(actionId, holder);
    return this.send([await this.client.castVote(inst, action.address, key.publicKey, units, proof, choice)], [key]);
  }

  // ---- primary allocation ------------------------------------------------------------------------

  /**
   * Issues bond units to a Plain investor's smart wallet (a PDA owner: its bond account is the
   * off-curve associated token account the program creates). Re-reads the instrument and the
   * wallet's balance right before signing, so callers must run this inside the issuer's
   * single-flight queue for the cap to hold. Allowlists the wallet first when the allowlist is on.
   * The memo marks the wallet as a Plain investor for the register and the console.
   */
  async allocate(mint: Address, holder: Address, units: unknown, limits: AllocationLimits): Promise<TxResult & { units: string }> {
    const inst = await this.instrumentByMint(mint);
    let wallet: PublicKey;
    try {
      wallet = new PublicKey(holder);
    } catch {
      throw new IssuerError("Not a valid wallet address.");
    }
    const now = await this.reader.clusterNow();
    const ata = bondAta(wallet, inst.account.mint);
    const allow = pda.allow(inst.address, wallet, this.client.programId);
    const [ataInfo, allowInfo] = await rpcRetry(() => this.connection.getMultipleAccountsInfo([ata, allow], "confirmed"));
    const held = ataInfo ? unpackAccount(ata, ataInfo, TOKEN_2022_PROGRAM_ID).amount : BigInt(0);
    const check = checkAllocation({ units, heldUnits: held, state: issueStateOf(inst.account), now, limits });
    if (!check.ok) throw new IssuerError(check.message, check.status);
    const ixs: TransactionInstruction[] = [memoInstruction(allocationMemo(holder, check.units))];
    if (inst.account.allowlistEnabled && !allowInfo) ixs.push(await this.client.allowHolder(inst, wallet));
    ixs.push(await this.client.issue(inst, wallet, check.units));
    return { ...(await this.send(ixs)), units: check.units.toString() };
  }

  async settle(actionId: Address) {
    const { inst, action, status } = await this.load(actionId);
    if (status === "Settled" || status === "Cancelled") throw new IssuerError(`Already ${status.toLowerCase()}.`);
    return this.send([await this.client.settle(inst, action, this.issuer.publicKey)]);
  }
}

function truncateUtf8(text: string, maxBytes: number) {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return text;
  let out = text;
  while (enc.encode(`${out}…`).length > maxBytes) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Shape validation of an untrusted draft (the program re-validates every rule). */
export function validateDraft(d: ActionDraft): void {
  const p = d?.params;
  if (!d || !p || d.kind !== p.kind) throw new IssuerError("Action kind and parameters disagree.");
  for (const t of [d.recordTs, d.paymentTs, d.claimDeadlineTs]) if (!isInt(t, 1_600_000_000, 4_102_444_800)) throw new IssuerError("Dates must be unix seconds.");
  if (!(d.recordTs < d.paymentTs && d.paymentTs <= d.claimDeadlineTs)) throw new IssuerError("Record date < payment date ≤ claim deadline.");
  switch (p.kind) {
    case "Coupon":
      if (!isInt(p.couponBps, 1, 5_000) || !isInt(p.period, 1, 1_000)) throw new IssuerError("Coupon rate must be between 0.01% and 50%.");
      break;
    case "PartialRedemption":
      if (!isInt(p.redeemBps, 1, 9_999) || !isInt(p.priceBps, 1, 20_000)) throw new IssuerError("Invalid redemption share or price.");
      break;
    case "FinalRedemption":
      if (!isInt(p.priceBps, 1, 20_000) || typeof p.includeCoupon !== "boolean" || !isInt(p.couponBps, 0, 5_000)) throw new IssuerError("Invalid redemption price or coupon.");
      break;
    case "Vote":
      if (typeof p.question !== "string" || !p.question.trim() || p.question.length > 280) throw new IssuerError("The vote needs a question of at most 280 characters.");
      if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 4 || p.options.some((o) => typeof o !== "string" || !o.trim() || new TextEncoder().encode(o).length > 32)) {
        throw new IssuerError("Two to four options of at most 32 bytes.");
      }
      break;
    default:
      throw new IssuerError("Unknown action kind.");
  }
}
