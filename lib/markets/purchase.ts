/**
 * Strict intent validation for a Plain Markets bond purchase (`markets-subscribe`) executed by a
 * Crossmint smart wallet. The counterpart of `lib/kamino-instruction-intent.ts`: the server builds
 * the instructions, and this module re-derives every account, flag and byte from pinned constants
 * plus the trusted on-chain terms (instrument, issue price) instead of trusting the builder.
 *
 * Accepted payload, in order, nothing else:
 *   [ATA create-idempotent for the wallet's USDC account]   (optional, at most once)
 *   [ATA create-idempotent for the wallet's bond account]   (optional, at most once)
 *   plain_markets.subscribe(units, max_payment = units × issue_price)   (exactly once, last)
 *
 * Pure: no RPC, no server-only imports, so the browser bundle and the tests can use it.
 */
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { normalizeIntentInstruction, type CanonicalInstruction, type CanonicalInstructionAccount } from "../kamino-instruction-intent";

export const MARKETS_SUBSCRIBE_ACTION = "markets-subscribe" as const;
/** Pinned plain_markets program (devnet). Also checked against the synced IDL in tests. */
export const PLAIN_MARKETS_PROGRAM = "H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm";
/** Circle's devnet USDC: the only settlement mint a smart-wallet purchase may pay with. */
export const CIRCLE_DEVNET_USDC_ADDRESS = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const CIRCLE_DEVNET_USDC = new PublicKey(CIRCLE_DEVNET_USDC_ADDRESS);
export const USDC_DECIMALS = 6;
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Anchor discriminator of `subscribe` (sha256("global:subscribe")[..8]). */
export const SUBSCRIBE_DISCRIMINATOR = Uint8Array.from([254, 28, 191, 138, 156, 179, 183, 53]);
/** Most units one smart-wallet request may buy (the program's per-holder cap still applies). */
export const MAX_UNITS_PER_PURCHASE = BigInt(1_000);
const MAX_U64 = (BigInt(1) << BigInt(64)) - BigInt(1);

/** Trusted, server-derived terms (from the pinned program's accounts), never from the client. */
export type SubscribeTerms = {
  mint: string;
  /** Settlement base units per bond unit, read from the offering account. */
  issuePrice: string;
  allowlistEnabled: boolean;
  settlementMint: string;
  settlementTokenProgram: string;
};

export type SubscribeIntentInput = {
  action: typeof MARKETS_SUBSCRIBE_ACTION;
  walletAddress: string;
  units: string;
  /** units × issue price in settlement base units. */
  costAtomic: string;
  instructions: CanonicalInstruction[];
};

export type ValidatedSubscribeIntent = {
  action: typeof MARKETS_SUBSCRIBE_ACTION;
  walletAddress: string;
  mint: string;
  units: string;
  costAtomic: string;
  accounts: SubscribeAccounts;
  createdAccounts: string[];
};

export type SubscribeAccounts = {
  instrument: string;
  offering: string;
  proceedsVault: string;
  buyerBond: string;
  buyerSettlement: string;
  allowEntry: string | null;
};

function invalid(message: string): never {
  throw new Error(`INVALID_SUBSCRIBE_INTENT: ${message}`);
}

function canonical(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a base58 address.`);
  try {
    const key = new PublicKey(value).toBase58();
    if (key !== value) invalid(`${label} must be canonical base58.`);
    return key;
  } catch {
    return invalid(`${label} must be a valid Solana address.`);
  }
}

function positive(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) invalid(`${label} must be a positive integer string.`);
  const n = BigInt(value);
  if (n > MAX_U64) invalid(`${label} exceeds u64.`);
  return n;
}

const seed = (s: string) => new TextEncoder().encode(s);
const pdaOf = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, new PublicKey(PLAIN_MARKETS_PROGRAM))[0].toBase58();

/** Every account `subscribe` touches, derived from the pinned program id and the bond mint. */
export function subscribeAccounts(walletAddress: string, terms: Pick<SubscribeTerms, "mint" | "allowlistEnabled">): SubscribeAccounts {
  const wallet = new PublicKey(walletAddress);
  const mint = new PublicKey(terms.mint);
  const instrument = pdaOf([seed("instrument"), mint.toBytes()]);
  const instrumentKey = new PublicKey(instrument).toBytes();
  return {
    instrument,
    offering: pdaOf([seed("offering"), instrumentKey]),
    proceedsVault: pdaOf([seed("proceeds"), instrumentKey]),
    buyerBond: getAssociatedTokenAddressSync(mint, wallet, true, new PublicKey(TOKEN_2022_PROGRAM)).toBase58(),
    buyerSettlement: getAssociatedTokenAddressSync(CIRCLE_DEVNET_USDC, wallet, true, new PublicKey(SPL_TOKEN_PROGRAM)).toBase58(),
    allowEntry: terms.allowlistEnabled ? pdaOf([seed("allow"), instrumentKey, wallet.toBytes()]) : null,
  };
}

function u64le(n: bigint) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

export function subscribeData(units: bigint, maxPayment: bigint) {
  const data = new Uint8Array(24);
  data.set(SUBSCRIBE_DISCRIMINATOR, 0);
  data.set(u64le(units), 8);
  data.set(u64le(maxPayment), 16);
  return data;
}

export function expectedSubscribeMetas(walletAddress: string, terms: SubscribeTerms): CanonicalInstructionAccount[] {
  const a = subscribeAccounts(walletAddress, terms);
  const m = (address: string, isSigner: boolean, isWritable: boolean) => ({ address, isSigner, isWritable });
  return [
    m(walletAddress, true, false),
    m(a.instrument, false, true),
    m(a.offering, false, true),
    m(terms.mint, false, true),
    m(a.buyerBond, false, true),
    m(a.buyerSettlement, false, true),
    m(a.proceedsVault, false, true),
    m(CIRCLE_DEVNET_USDC_ADDRESS, false, false),
    // Anchor encodes an absent optional account as the program id.
    m(a.allowEntry ?? PLAIN_MARKETS_PROGRAM, false, false),
    m(TOKEN_2022_PROGRAM, false, false),
    m(SPL_TOKEN_PROGRAM, false, false),
  ];
}

function assertSubscribeAccounts(actual: CanonicalInstructionAccount[], expected: CanonicalInstructionAccount[]) {
  if (actual.length !== expected.length) invalid(`subscribe must have exactly ${expected.length} accounts.`);
  expected.forEach((e, i) => {
    const a = actual[i];
    // The buyer is the transaction's fee-payer placeholder before Crossmint wraps it, so a compiled
    // template marks it writable; only its signer role is fixed. Every other flag is exact.
    const buyerSlot = i === 0;
    if (a.address !== e.address || a.isSigner !== e.isSigner || (!buyerSlot && a.isWritable !== e.isWritable)) {
      invalid(`subscribe account ${i} does not match the canonical ${e.address} role.`);
    }
  });
}

function assertIdempotentAta(ix: CanonicalInstruction, walletAddress: string, targets: Map<string, { mint: string; tokenProgram: string }>) {
  const data = bs58.decode(ix.dataBase58);
  if (data.length !== 1 || data[0] !== 1) invalid("only idempotent associated-token-account creation is allowed.");
  if (ix.accounts.length !== 6) invalid("associated-token-account instruction must have exactly 6 accounts.");
  const [payer, target, owner, mint, system, tokenProgram] = ix.accounts;
  const expected = targets.get(target.address);
  if (!expected) invalid("ATA target must be the wallet's canonical USDC or bond account.");
  // The smart wallet pays rent itself (Crossmint may pre-fund it); it is the only allowed payer.
  if (payer.address !== walletAddress || !payer.isWritable || !payer.isSigner) invalid("ATA payer must be the wallet as a writable signer.");
  // A raw instruction marks the owner readonly; once compiled, its flags merge with the payer's.
  const ownerFlagsOk = (!owner.isSigner && !owner.isWritable) || (owner.isSigner === payer.isSigner && owner.isWritable === payer.isWritable);
  if (owner.address !== walletAddress || !ownerFlagsOk) invalid("ATA owner must be the wallet.");
  if (mint.address !== expected.mint || mint.isSigner || mint.isWritable) invalid("ATA mint is not the canonical readonly mint.");
  if (target.isSigner || !target.isWritable) invalid("ATA target must be writable and not a signer.");
  if (system.address !== SYSTEM_PROGRAM || system.isSigner || system.isWritable) invalid("ATA system program is not canonical.");
  if (tokenProgram.address !== expected.tokenProgram || tokenProgram.isSigner || tokenProgram.isWritable) invalid("ATA token program is not canonical.");
  return target.address;
}

export function validateSubscribeTerms(terms: SubscribeTerms) {
  canonical(terms.mint, "mint");
  if (terms.settlementMint !== CIRCLE_DEVNET_USDC_ADDRESS) invalid("settlement mint must be Circle devnet USDC.");
  if (terms.settlementTokenProgram !== SPL_TOKEN_PROGRAM) invalid("settlement token program must be SPL Token.");
  if (typeof terms.allowlistEnabled !== "boolean") invalid("allowlist flag is required.");
  return positive(terms.issuePrice, "issuePrice");
}

/** Validates the exact wallet payload of a purchase against trusted terms. Throws on any deviation. */
export function validateSubscribeIntent(input: SubscribeIntentInput, terms: SubscribeTerms): ValidatedSubscribeIntent {
  if (!input || input.action !== MARKETS_SUBSCRIBE_ACTION) invalid("action is unsupported.");
  const walletAddress = canonical(input.walletAddress, "walletAddress");
  const price = validateSubscribeTerms(terms);
  const units = positive(input.units, "units");
  if (units > MAX_UNITS_PER_PURCHASE) invalid(`units exceed the ${MAX_UNITS_PER_PURCHASE} per-purchase limit.`);
  const cost = positive(input.costAtomic, "costAtomic");
  if (cost !== units * price) invalid("cost must equal units × issue price.");
  if (!Array.isArray(input.instructions) || input.instructions.length < 1 || input.instructions.length > 3) {
    invalid("instructions must be one subscribe plus at most two ATA creations.");
  }
  const instructions = input.instructions.map(normalizeIntentInstruction);
  const accounts = subscribeAccounts(walletAddress, terms);
  const targets = new Map([
    [accounts.buyerSettlement, { mint: CIRCLE_DEVNET_USDC_ADDRESS, tokenProgram: SPL_TOKEN_PROGRAM }],
    [accounts.buyerBond, { mint: terms.mint, tokenProgram: TOKEN_2022_PROGRAM }],
  ]);
  const created = new Set<string>();
  instructions.forEach((ix, index) => {
    const last = index === instructions.length - 1;
    if (ix.programId === ASSOCIATED_TOKEN_PROGRAM && !last) {
      const target = assertIdempotentAta(ix, walletAddress, targets);
      if (created.has(target)) invalid("duplicate ATA creation.");
      created.add(target);
      return;
    }
    if (ix.programId === PLAIN_MARKETS_PROGRAM && last) {
      const data = bs58.decode(ix.dataBase58);
      const expected = subscribeData(units, cost);
      if (data.length !== expected.length || !expected.every((b, i) => data[i] === b)) {
        invalid("subscribe discriminator, units or max payment do not match the intent.");
      }
      assertSubscribeAccounts(ix.accounts, expectedSubscribeMetas(walletAddress, terms));
      return;
    }
    invalid(`instruction ${index} (${ix.programId}) is not allowed here; subscribe must be last.`);
  });
  return {
    action: MARKETS_SUBSCRIBE_ACTION,
    walletAddress,
    mint: terms.mint,
    units: units.toString(),
    costAtomic: cost.toString(),
    accounts,
    createdAccounts: [...created],
  };
}
