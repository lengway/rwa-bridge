import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMockIdentityProfile, type MockIdentityProfile } from "@/lib/mock-identity";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  assertOrderTransition,
  type RwaDemoFundingStatus,
  type RwaDemoOrderStatus,
  type RwaDemoPayoutStatus,
  type RwaDemoSide,
} from "@/lib/rwa-demo";

export type EarnDepositStatus = "MINT_PENDING" | "COMPLETED" | "NEEDS_REVIEW";
export type EarnWithdrawalStatus = "PAYOUT_PENDING" | "BURN_PENDING" | "COMPLETED" | "NEEDS_REVIEW";
export type LegacyDevnetFaucetActionStatus = "MINT_PENDING" | "COMPLETED" | "NEEDS_REVIEW";

/**
 * A durable action record for the opt-in legacy test-token faucet. This is
 * intentionally separate from Earn deposits: no external payment or Earn
 * position is implied by an issued test token.
 */
export type LegacyDevnetFaucetAction = {
  walletAddress: string;
  /** Client-generated URL-safe request id, scoped to this wallet. */
  requestId: string;
  /** Existing legacy faucet input; it remains display/rate-limit data only. */
  amountUsd: number;
  status: LegacyDevnetFaucetActionStatus;
  mintSignature?: string;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
};

export class LegacyDevnetFaucetActionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyDevnetFaucetActionConflictError";
  }
}

const LEGACY_DEVNET_FAUCET_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Matches client-generated UUIDs and concise URL-safe idempotency keys only. */
export function isLegacyDevnetFaucetRequestId(value: unknown): value is string {
  return typeof value === "string" && LEGACY_DEVNET_FAUCET_REQUEST_ID_PATTERN.test(value);
}

export type LedgerDeposit = {
  productId: string;
  /** Display-only compatibility value. Earn source of truth is amountAtomic. */
  amountUsd: number;
  /** JSON-safe SPL base units for the user-signed inbound test-token transfer. */
  amountAtomic?: string;
  signature: string;
  at: number;
  /** Display-only compatibility value. Earn source of truth is sharesAtomic. */
  shares?: number;
  /** JSON-safe SPL base units for issued demo shares. */
  sharesAtomic?: string;
  priceUsd?: number;
  mintSignature?: string;
  status?: EarnDepositStatus;
  errorCode?: string;
};

export type LedgerWithdrawal = {
  productId: string;
  signature: string;
  at: number;
  /** JSON-safe SPL base units received from the user for redemption. */
  sharesAtomic?: string;
  shares?: number;
  /** JSON-safe SPL base units sent as test-token redemption. */
  amountAtomic?: string;
  amountUsd?: number;
  priceUsd?: number;
  payoutSignature?: string;
  burnSignature?: string;
  status?: EarnWithdrawalStatus;
  errorCode?: string;
  // Kept for migration from the original principal based ledger.
  principalUsd?: number;
  earnedUsd?: number;
};

export type LedgerMigration = {
  productId: string;
  principalUsd: number;
  shares: number;
  priceUsd: number;
  mintSignature: string;
  at: number;
};

export type VaultCheckpoint = { price: number; at: number; apy: number };

export type LedgerPurchase = {
  assetId: string;
  amountUsd: number;
  units: number;
  paymentSignature: string;
  mintSignature: string;
  at: number;
};

export type LedgerKzteOperation = {
  kind: "topup" | "exchange-kzte-usd" | "exchange-usd-kzte" | "redeem";
  sourceSignature?: string;
  targetSignature?: string;
  burnSignature?: string;
  amountKzt: number;
  amountUsd: number;
  at: number;
};

export type WalletLedger = {
  deposits: LedgerDeposit[];
  withdrawals: LedgerWithdrawal[];
  purchases: LedgerPurchase[];
  migrations: LedgerMigration[];
  kzteOperations: LedgerKzteOperation[];
};

export type RwaDemoQuoteRecord = {
  id: string;
  walletAddress: string;
  assetId: "rwa-demo";
  side: RwaDemoSide;
  inputMint: string;
  outputMint: string;
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  minimumOutputAtomic: string;
  feeAmountAtomic: string;
  protocolFeeAtomic: string;
  slippageBps: number;
  priceImpact: string | null;
  poolAddress: string;
  route: "meteora-dlmm-devnet";
  network: "devnet";
  expiresAt: number;
  createdAt: number;
  orderId?: string;
};

export type RwaDemoOrderRecord = Omit<RwaDemoQuoteRecord, "id" | "createdAt" | "orderId"> & {
  id: string;
  quoteId: string;
  status: RwaDemoOrderStatus;
  createdAt: number;
  updatedAt: number;
  transactionSignature?: string;
  // SHA-256 of the exact unsigned message built by the server. A submitted
  // signature is accepted only when its on-chain message matches this digest.
  transactionMessageDigest?: string;
  transactionLastValidBlockHeight?: number;
  actualInputAmountAtomic?: string;
  actualOutputAmountAtomic?: string;
  inputBalanceAfterAtomic?: string;
  outputBalanceAfterAtomic?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type RwaDemoFundingEvent = {
  id: string;
  walletAddress: string;
  ipHash: string;
  idempotencyKey: string | null;
  requestedKztAmount: string;
  demoRateKztPerQuoteToken: string;
  quoteTokenAmountAtomic: string;
  status: RwaDemoFundingStatus;
  mintSignature?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};

export type RwaDemoPayoutEvent = {
  id: string;
  orderId: string;
  walletAddress: string;
  quoteTokenAmountAtomic: string;
  simulatedKztAmount: string;
  status: RwaDemoPayoutStatus;
  disclosure: string;
  createdAt: number;
  updatedAt: number;
};

type RwaDemoLedger = {
  quotes: Record<string, RwaDemoQuoteRecord>;
  orders: Record<string, RwaDemoOrderRecord>;
  fundingEvents: Record<string, RwaDemoFundingEvent>;
  payoutEvents: Record<string, RwaDemoPayoutEvent>;
};

type Ledger = {
  wallets: Record<string, WalletLedger>;
  legacyDevnetFaucetActions: Record<string, LegacyDevnetFaucetAction>;
  vaultCheckpoints: Record<string, VaultCheckpoint>;
  emails: Record<string, EmailLedgerRecord>;
  authChallenges: Record<string, AuthChallengeRecord>;
  authEmailRequests: Record<string, number[]>;
  authIpRequests: Record<string, number[]>;
  rwaDemo: RwaDemoLedger;
};

type AuthChallengeRecord = {
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
};

export type AuthCodeRequestResult =
  | { ok: true }
  | { ok: false; reason: "cooldown" | "email-limit" | "ip-limit"; retryAfterSeconds: number };

export type AuthCodeVerificationResult = "verified" | "invalid" | "expired" | "locked" | "missing";

type EmailLedgerRecord = {
  mockIdentity?: MockIdentityProfile;
  walletAddress?: string;
  receiptsEnabled?: boolean;
  welcomeSent?: boolean;
  receiptDay?: string;
  receiptCount?: number;
  receiptIds?: string[];
};

// Production keeps the ledger outside the release folder (atomic rename would replace a symlink).
const LEDGER_PATH = process.env.DEMO_LEDGER_PATH || path.join(process.cwd(), ".demo-ledger.json");
let mutex: Promise<void> = Promise.resolve();
const keyLocks = new Map<string, Promise<void>>();

export async function withLedgerKeyLock<T>(key: string, operation: () => Promise<T>) {
  const previous = keyLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  keyLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (keyLocks.get(key) === current) keyLocks.delete(key);
  }
}

async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutex;
  let release!: () => void;
  mutex = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function emptyWallet(): WalletLedger {
  return { deposits: [], withdrawals: [], purchases: [], migrations: [], kzteOperations: [] };
}

function emptyRwaDemoLedger(): RwaDemoLedger {
  return { quotes: {}, orders: {}, fundingEvents: {}, payoutEvents: {} };
}

function objectRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, T> : {};
}

async function readLedgerFile(): Promise<Ledger> {
  try {
    // This local, runtime-selected ledger is intentional for the demo. It is
    // not a deploy-time asset and must not make Turbopack trace the workspace.
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ LEDGER_PATH, "utf8")) as Partial<Ledger>;
    const wallets = parsed.wallets && typeof parsed.wallets === "object" ? parsed.wallets : {};
    const legacyDevnetFaucetActions = parsed.legacyDevnetFaucetActions && typeof parsed.legacyDevnetFaucetActions === "object"
      ? parsed.legacyDevnetFaucetActions
      : {};
    const vaultCheckpoints = parsed.vaultCheckpoints && typeof parsed.vaultCheckpoints === "object"
      ? parsed.vaultCheckpoints
      : {};
    const emails = parsed.emails && typeof parsed.emails === "object" ? parsed.emails : {};
    const authChallenges = parsed.authChallenges && typeof parsed.authChallenges === "object" ? parsed.authChallenges : {};
    const authEmailRequests = parsed.authEmailRequests && typeof parsed.authEmailRequests === "object" ? parsed.authEmailRequests : {};
    const authIpRequests = parsed.authIpRequests && typeof parsed.authIpRequests === "object" ? parsed.authIpRequests : {};
    const rwaDemo = parsed.rwaDemo && typeof parsed.rwaDemo === "object" ? parsed.rwaDemo : emptyRwaDemoLedger();
    return {
      vaultCheckpoints,
      legacyDevnetFaucetActions: objectRecord<LegacyDevnetFaucetAction>(legacyDevnetFaucetActions),
      emails,
      authChallenges,
      authEmailRequests,
      authIpRequests,
      rwaDemo: {
        quotes: objectRecord<RwaDemoQuoteRecord>(rwaDemo.quotes),
        orders: objectRecord<RwaDemoOrderRecord>(rwaDemo.orders),
        fundingEvents: objectRecord<RwaDemoFundingEvent>(rwaDemo.fundingEvents),
        payoutEvents: objectRecord<RwaDemoPayoutEvent>(rwaDemo.payoutEvents),
      },
      wallets: Object.fromEntries(Object.entries(wallets).map(([wallet, value]) => {
        const record = value as Partial<WalletLedger>;
        return [wallet, {
          deposits: Array.isArray(record.deposits) ? record.deposits : [],
          withdrawals: Array.isArray(record.withdrawals) ? record.withdrawals : [],
          purchases: Array.isArray(record.purchases) ? record.purchases : [],
          migrations: Array.isArray(record.migrations) ? record.migrations : [],
          kzteOperations: Array.isArray(record.kzteOperations) ? record.kzteOperations : [],
        } satisfies WalletLedger];
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        wallets: {},
        legacyDevnetFaucetActions: {},
        vaultCheckpoints: {},
        emails: {},
        authChallenges: {},
        authEmailRequests: {},
        authIpRequests: {},
        rwaDemo: emptyRwaDemoLedger(),
      };
    }
    throw error;
  }
}

export function reserveAuthCodeRequest(
  emailKey: string,
  ipKey: string,
  challenge: AuthChallengeRecord,
  now = Date.now(),
): Promise<AuthCodeRequestResult> {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    for (const [key, storedChallenge] of Object.entries(ledger.authChallenges)) {
      if (storedChallenge.expiresAt <= now) delete ledger.authChallenges[key];
    }
    ledger.authEmailRequests = Object.fromEntries(Object.entries(ledger.authEmailRequests)
      .filter(([, history]) => history.some((at) => at > now - 24 * 60 * 60 * 1_000)));
    ledger.authIpRequests = Object.fromEntries(Object.entries(ledger.authIpRequests)
      .filter(([, history]) => history.some((at) => at > now - 60 * 60 * 1_000)));
    const emailHistory = (ledger.authEmailRequests[emailKey] ?? []).filter((at) => at > now - 24 * 60 * 60 * 1_000);
    const ipHistory = (ledger.authIpRequests[ipKey] ?? []).filter((at) => at > now - 60 * 60 * 1_000);
    const lastEmailRequest = emailHistory.at(-1);

    if (lastEmailRequest !== undefined && lastEmailRequest > now - 60 * 1_000) {
      return { ok: false, reason: "cooldown", retryAfterSeconds: Math.ceil((lastEmailRequest + 60 * 1_000 - now) / 1_000) };
    }
    if (emailHistory.length >= 10) {
      return { ok: false, reason: "email-limit", retryAfterSeconds: Math.max(1, Math.ceil((emailHistory[0] + 24 * 60 * 60 * 1_000 - now) / 1_000)) };
    }
    if (ipHistory.length >= 30) {
      return { ok: false, reason: "ip-limit", retryAfterSeconds: Math.max(1, Math.ceil((ipHistory[0] + 60 * 60 * 1_000 - now) / 1_000)) };
    }

    ledger.authChallenges[emailKey] = challenge;
    ledger.authEmailRequests[emailKey] = [...emailHistory, now];
    ledger.authIpRequests[ipKey] = [...ipHistory, now];
    await writeLedgerFile(ledger);
    return { ok: true };
  });
}

export function verifyAuthCode(emailKey: string, candidateHash: string, now = Date.now()): Promise<AuthCodeVerificationResult> {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const challenge = ledger.authChallenges[emailKey];
    if (!challenge) return "missing";
    if (challenge.expiresAt <= now) {
      delete ledger.authChallenges[emailKey];
      await writeLedgerFile(ledger);
      return "expired";
    }
    if (challenge.attempts >= 5) return "locked";

    challenge.attempts += 1;
    const expected = Buffer.from(challenge.codeHash, "hex");
    const candidate = Buffer.from(candidateHash, "hex");
    const matches = expected.length === candidate.length && timingSafeEqual(expected, candidate);
    if (matches) {
      delete ledger.authChallenges[emailKey];
      await writeLedgerFile(ledger);
      return "verified";
    }

    await writeLedgerFile(ledger);
    return challenge.attempts >= 5 ? "locked" : "invalid";
  });
}

export function clearAuthCodeChallenge(emailKey: string, createdAt: number) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    if (ledger.authChallenges[emailKey]?.createdAt !== createdAt) return;
    delete ledger.authChallenges[emailKey];
    await writeLedgerFile(ledger);
  });
}

function emailKey(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export function getEmailPreferences(email: string) {
  return exclusive(async () => {
    const record = (await readLedgerFile()).emails[emailKey(email)];
    return { receiptsEnabled: record?.receiptsEnabled ?? true };
  });
}

export function linkEmailWallet(email: string, walletAddress: string) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const key = emailKey(email);
    const record = ledger.emails[key] ?? {};
    if (record.walletAddress && record.walletAddress !== walletAddress) return false;
    ledger.emails[key] = { ...record, walletAddress };
    await writeLedgerFile(ledger);
    return true;
  });
}

export function getEmailWalletAddress(email: string) {
  return exclusive(async () => (await readLedgerFile()).emails[emailKey(email)]?.walletAddress ?? null);
}

export function getMockIdentityProfile(email: string) {
  return exclusive(async () => {
    const profile = (await readLedgerFile()).emails[emailKey(email)]?.mockIdentity;
    return isMockIdentityProfile(profile) ? profile : null;
  });
}

export function saveMockIdentityProfile(email: string, profile: MockIdentityProfile) {
  if (!isMockIdentityProfile(profile)) throw new Error("Invalid mock profile.");
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const key = emailKey(email);
    ledger.emails[key] = { ...ledger.emails[key], mockIdentity: profile };
    await writeLedgerFile(ledger);
    return profile;
  });
}

export function clearMockIdentityProfile(email: string) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const record = ledger.emails[emailKey(email)];
    if (record) delete record.mockIdentity;
    await writeLedgerFile(ledger);
  });
}

export function setEmailPreferences(email: string, receiptsEnabled: boolean) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const key = emailKey(email);
    ledger.emails[key] = { ...ledger.emails[key], receiptsEnabled };
    await writeLedgerFile(ledger);
    return { receiptsEnabled };
  });
}

export function reserveEmailReceipt(email: string, receiptId: string, now = Date.now()) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const key = emailKey(email);
    const record = ledger.emails[key] ?? {};
    const receiptKey = createHash("sha256").update(receiptId).digest("hex");
    if (record.receiptIds?.includes(receiptKey)) return false;
    if (record.receiptsEnabled === false) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    const count = record.receiptDay === day ? (record.receiptCount ?? 0) : 0;
    if (count >= 20) return false;
    ledger.emails[key] = {
      ...record,
      receiptDay: day,
      receiptCount: count + 1,
      receiptIds: [...(record.receiptIds ?? []).slice(-199), receiptKey],
    };
    await writeLedgerFile(ledger);
    return true;
  });
}

export function claimWelcomeEmail(email: string, now = Date.now()) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const key = emailKey(email);
    const record = ledger.emails[key] ?? {};
    if (record.welcomeSent) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    const count = record.receiptDay === day ? (record.receiptCount ?? 0) : 0;
    if (count >= 20) return false;
    ledger.emails[key] = {
      ...record,
      welcomeSent: true,
      receiptDay: day,
      receiptCount: count + 1,
    };
    await writeLedgerFile(ledger);
    return true;
  });
}

async function writeLedgerFile(ledger: Ledger) {
  await mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  const temporaryPath = `${LEDGER_PATH}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(ledger, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, LEDGER_PATH);
  } catch (error) {
    const { unlink } = await import("node:fs/promises");
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Keep the public client request id out of the JSON-object key space while
 * making its scope explicit: the same id may safely be used by another wallet.
 */
export function legacyDevnetFaucetActionKey(walletAddress: string, requestId: string) {
  return createHash("sha256").update(`${walletAddress}\u0000${requestId}`).digest("hex");
}

function assertMatchingLegacyDevnetFaucetAction(
  existing: LegacyDevnetFaucetAction,
  candidate: Pick<LegacyDevnetFaucetAction, "walletAddress" | "requestId" | "amountUsd">,
) {
  if (
    existing.walletAddress !== candidate.walletAddress
    || existing.requestId !== candidate.requestId
    || existing.amountUsd !== candidate.amountUsd
  ) {
    throw new LegacyDevnetFaucetActionConflictError(
      "Faucet request id is already associated with a different action.",
    );
  }
}

export function getLegacyDevnetFaucetAction(walletAddress: string, requestId: string) {
  return exclusive(async () => {
    const action = (await readLedgerFile()).legacyDevnetFaucetActions[
      legacyDevnetFaucetActionKey(walletAddress, requestId)
    ];
    if (!action) return null;
    if (action.walletAddress !== walletAddress || action.requestId !== requestId) {
      throw new LegacyDevnetFaucetActionConflictError("Faucet action key is inconsistent with its stored action.");
    }
    return action;
  });
}

/**
 * A new faucet id must not bypass an uncertain earlier signer result for the
 * same wallet. Completed actions remain replayable and do not block later,
 * intentional faucet requests.
 */
export function findUnresolvedLegacyDevnetFaucetAction(walletAddress: string) {
  return exclusive(async () => Object.values((await readLedgerFile()).legacyDevnetFaucetActions)
    .find((action) => (
      action.walletAddress === walletAddress
      && (action.status !== "COMPLETED" || !action.mintSignature)
    )) ?? null);
}

/**
 * Persist an action before any server signer is invoked. A repeated client
 * request can only reuse an identical wallet/requestId/amount tuple.
 */
export async function reserveLegacyDevnetFaucetAction(action: LegacyDevnetFaucetAction) {
  return exclusive(async () => {
    if (
      !isLegacyDevnetFaucetRequestId(action.requestId)
      || !Number.isFinite(action.amountUsd)
      || action.amountUsd < 1
      || action.amountUsd > 1_000
      || action.status !== "MINT_PENDING"
      || action.mintSignature !== undefined
      || action.errorCode !== undefined
      || !Number.isFinite(action.createdAt)
      || !Number.isFinite(action.updatedAt)
    ) {
      throw new LegacyDevnetFaucetActionConflictError("Invalid legacy Devnet faucet action reservation.");
    }
    const ledger = await readLedgerFile();
    const key = legacyDevnetFaucetActionKey(action.walletAddress, action.requestId);
    const existing = ledger.legacyDevnetFaucetActions[key];
    if (existing) {
      assertMatchingLegacyDevnetFaucetAction(existing, action);
      return { action: existing, reused: true };
    }
    ledger.legacyDevnetFaucetActions[key] = action;
    await writeLedgerFile(ledger);
    return { action, reused: false };
  });
}

/**
 * Never reopen a faucet action. An unconfirmed signer result stays terminally
 * review-only so a retry cannot issue a second test-token mint.
 */
export async function updateLegacyDevnetFaucetAction({
  walletAddress,
  requestId,
  status,
  mintSignature,
  errorCode,
  now = Date.now(),
}: {
  walletAddress: string;
  requestId: string;
  status: LegacyDevnetFaucetActionStatus;
  mintSignature?: string;
  errorCode?: string;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const key = legacyDevnetFaucetActionKey(walletAddress, requestId);
    const action = ledger.legacyDevnetFaucetActions[key];
    if (!action || action.walletAddress !== walletAddress || action.requestId !== requestId) {
      throw new LegacyDevnetFaucetActionConflictError("Legacy Devnet faucet action was not found for this wallet.");
    }
    if (action.status !== "MINT_PENDING" || (status !== "COMPLETED" && status !== "NEEDS_REVIEW")) {
      throw new LegacyDevnetFaucetActionConflictError(
        `Invalid legacy Devnet faucet action transition: ${action.status} -> ${status}.`,
      );
    }
    if (status === "COMPLETED" && !mintSignature && !action.mintSignature) {
      throw new LegacyDevnetFaucetActionConflictError("A completed legacy Devnet faucet action requires its mint signature.");
    }

    action.status = status;
    if (mintSignature) action.mintSignature = mintSignature;
    if (errorCode) action.errorCode = errorCode;
    action.updatedAt = now;
    await writeLedgerFile(ledger);
    return action;
  });
}

function walletOf(ledger: Ledger, walletAddress: string) {
  return ledger.wallets[walletAddress] ?? emptyWallet();
}

function signatureIsUsed(ledger: Ledger, signature: string) {
  return Object.values(ledger.wallets).some((wallet) =>
    wallet.deposits.some((item) => item.signature === signature || item.mintSignature === signature)
      || wallet.withdrawals.some((item) => item.signature === signature || item.payoutSignature === signature || item.burnSignature === signature)
      || wallet.migrations.some((item) => item.mintSignature === signature)
      || wallet.purchases.some((item) => item.paymentSignature === signature || item.mintSignature === signature)
      || wallet.kzteOperations.some((item) => item.sourceSignature === signature
        || item.targetSignature === signature
        || item.burnSignature === signature),
  );
}

export function getLedgerWallet(walletAddress: string) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress));
}

export function hasLedgerSignature(signature: string) {
  return exclusive(async () => signatureIsUsed(await readLedgerFile(), signature));
}

export function findLedgerDeposit(walletAddress: string, signature: string) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress).deposits
    .find((deposit) => deposit.signature === signature) ?? null);
}

export function findLedgerWithdrawal(walletAddress: string, signature: string) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress).withdrawals
    .find((withdrawal) => withdrawal.signature === signature) ?? null);
}

export function findLedgerPurchase(walletAddress: string, paymentSignature: string) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress).purchases
    .find((purchase) => purchase.paymentSignature === paymentSignature) ?? null);
}

export function findKzteOperation(walletAddress: string, signature: string) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress).kzteOperations
    .find((item) => item.sourceSignature === signature || item.targetSignature === signature || item.burnSignature === signature) ?? null);
}

export function getKzteTopupsSince(walletAddress: string, since: number) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress).kzteOperations
    .filter((item) => item.kind === "topup" && item.at >= since)
    .reduce((total, item) => total + item.amountKzt, 0));
}

export async function appendKzteOperation(walletAddress: string, operation: LedgerKzteOperation) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    if (operation.sourceSignature && signatureIsUsed(ledger, operation.sourceSignature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    if (operation.targetSignature && signatureIsUsed(ledger, operation.targetSignature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    if (operation.burnSignature && signatureIsUsed(ledger, operation.burnSignature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    const wallet = walletOf(ledger, walletAddress);
    wallet.kzteOperations.push(operation);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
    return operation;
  });
}

export async function updateKzteOperation(
  walletAddress: string,
  sourceSignature: string,
  update: Partial<LedgerKzteOperation>,
) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const wallet = walletOf(ledger, walletAddress);
    const operation = wallet.kzteOperations.find((item) => item.sourceSignature === sourceSignature);
    if (!operation) throw new Error("Операция KZTE не найдена.");
    if (update.targetSignature && update.targetSignature !== operation.targetSignature
      && signatureIsUsed(ledger, update.targetSignature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    if (update.burnSignature && update.burnSignature !== operation.burnSignature
      && signatureIsUsed(ledger, update.burnSignature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    Object.assign(operation, update);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
    return operation;
  });
}

export function getVaultCheckpoint(productId: string) {
  return exclusive(async () => (await readLedgerFile()).vaultCheckpoints[productId] ?? null);
}

export async function setVaultCheckpoint(productId: string, checkpoint: VaultCheckpoint) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    ledger.vaultCheckpoints[productId] = checkpoint;
    await writeLedgerFile(ledger);
    return checkpoint;
  });
}

export function getUnmigratedPrincipal(walletAddress: string, productId: string) {
  return exclusive(async () => {
    const wallet = walletOf(await readLedgerFile(), walletAddress);
    if (wallet.migrations.some((item) => item.productId === productId)) return 0;
    const legacyDeposits = wallet.deposits
      // Only records created before the action-state ledger are eligible for
      // an explicit legacy migration. A current MINT_PENDING action must
      // never be picked up by a portfolio read and minted a second time.
      .filter((item) => item.productId === productId && !item.mintSignature && !item.status)
      .reduce((total, item) => total + item.amountUsd, 0);
    const legacyWithdrawals = wallet.withdrawals
      .filter((item) => item.productId === productId && !item.payoutSignature)
      .reduce((total, item) => total + (item.principalUsd ?? 0), 0);
    return Math.max(0, legacyDeposits - legacyWithdrawals);
  });
}

export async function appendDeposit(walletAddress: string, deposit: LedgerDeposit) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    if (signatureIsUsed(ledger, deposit.signature) || (deposit.mintSignature && signatureIsUsed(ledger, deposit.mintSignature))) {
      throw new Error("Эта транзакция уже была использована.");
    }
    const wallet = walletOf(ledger, walletAddress);
    wallet.deposits.push(deposit);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
  });
}

/**
 * A pre-write action record is deliberately updated after a signer operation.
 * If a process dies after submitting a transaction, the record remains
 * non-complete and retries fail closed instead of minting a second time.
 */
export async function updateDeposit(
  walletAddress: string,
  signature: string,
  update: Partial<LedgerDeposit>,
) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const wallet = walletOf(ledger, walletAddress);
    const deposit = wallet.deposits.find((item) => item.signature === signature);
    if (!deposit) throw new Error("Операция вклада не найдена.");
    if (update.mintSignature && update.mintSignature !== deposit.mintSignature && signatureIsUsed(ledger, update.mintSignature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    Object.assign(deposit, update);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
    return deposit;
  });
}

export async function appendWithdrawal(walletAddress: string, withdrawal: LedgerWithdrawal) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    if (signatureIsUsed(ledger, withdrawal.signature)) throw new Error("Эта транзакция уже была использована.");
    const wallet = walletOf(ledger, walletAddress);
    wallet.withdrawals.push(withdrawal);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
  });
}

export async function updateWithdrawal(
  walletAddress: string,
  signature: string,
  update: Partial<LedgerWithdrawal>,
) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const wallet = walletOf(ledger, walletAddress);
    const withdrawal = wallet.withdrawals.find((item) => item.signature === signature);
    if (!withdrawal) throw new Error("Операция вывода не найдена.");
    for (const candidate of [update.payoutSignature, update.burnSignature]) {
      if (
        candidate
        && candidate !== withdrawal.payoutSignature
        && candidate !== withdrawal.burnSignature
        && signatureIsUsed(ledger, candidate)
      ) {
        throw new Error("Эта транзакция уже была использована.");
      }
    }
    Object.assign(withdrawal, update);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
    return withdrawal;
  });
}

export async function appendMigration(walletAddress: string, migration: LedgerMigration) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const wallet = walletOf(ledger, walletAddress);
    const existing = wallet.migrations.find((item) => item.productId === migration.productId);
    if (existing) return existing;
    if (signatureIsUsed(ledger, migration.mintSignature)) throw new Error("Эта транзакция уже была использована.");
    wallet.migrations.push(migration);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
    return migration;
  });
}

export async function appendPurchase(walletAddress: string, purchase: LedgerPurchase) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const existing = walletOf(ledger, walletAddress).purchases
      .find((item) => item.paymentSignature === purchase.paymentSignature);
    if (existing) return existing;
    if (signatureIsUsed(ledger, purchase.paymentSignature) || signatureIsUsed(ledger, purchase.mintSignature)) {
      throw new Error("Эта транзакция уже была использована.");
    }
    const wallet = walletOf(ledger, walletAddress);
    wallet.purchases.push(purchase);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
    return purchase;
  });
}

export async function appendDeposits(walletAddress: string, deposits: LedgerDeposit[]) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const wallet = walletOf(ledger, walletAddress);
    for (const deposit of deposits) {
      if (signatureIsUsed(ledger, deposit.signature)) continue;
      wallet.deposits.push(deposit);
    }
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
    return wallet;
  });
}

export class RwaDemoLedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RwaDemoLedgerConflictError";
  }
}

export class RwaDemoLedgerRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RwaDemoLedgerRateLimitError";
  }
}

function rwaDemoOf(ledger: Ledger) {
  return ledger.rwaDemo;
}

export function getRwaDemoQuote(quoteId: string) {
  return exclusive(async () => rwaDemoOf(await readLedgerFile()).quotes[quoteId] ?? null);
}

export function getRwaDemoQuoteForWallet(quoteId: string, walletAddress: string) {
  return exclusive(async () => {
    const quote = rwaDemoOf(await readLedgerFile()).quotes[quoteId] ?? null;
    return quote?.walletAddress === walletAddress ? quote : null;
  });
}

export async function createRwaDemoQuote(quote: RwaDemoQuoteRecord) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const demo = rwaDemoOf(ledger);
    if (demo.quotes[quote.id]) throw new RwaDemoLedgerConflictError("RWA demo quote ID already exists.");
    demo.quotes[quote.id] = quote;
    await writeLedgerFile(ledger);
    return quote;
  });
}

export function getRwaDemoOrder(orderId: string) {
  return exclusive(async () => rwaDemoOf(await readLedgerFile()).orders[orderId] ?? null);
}

export function getRwaDemoOrderForWallet(orderId: string, walletAddress: string) {
  return exclusive(async () => {
    const order = rwaDemoOf(await readLedgerFile()).orders[orderId] ?? null;
    return order?.walletAddress === walletAddress ? order : null;
  });
}

export async function createRwaDemoOrderFromQuote({
  orderId,
  quoteId,
  walletAddress,
  now = Date.now(),
}: {
  orderId: string;
  quoteId: string;
  walletAddress: string;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const demo = rwaDemoOf(ledger);
    const quote = demo.quotes[quoteId];
    if (!quote || quote.walletAddress !== walletAddress) {
      throw new RwaDemoLedgerConflictError("RWA demo quote was not found for this wallet.");
    }
    if (quote.orderId) {
      const existing = demo.orders[quote.orderId];
      if (existing) return { order: existing, reused: true };
      throw new RwaDemoLedgerConflictError("RWA demo quote is already attached to an invalid order.");
    }
    if (quote.expiresAt <= now) {
      throw new RwaDemoLedgerConflictError("RWA demo quote has expired. Request a fresh quote.");
    }
    if (demo.orders[orderId]) throw new RwaDemoLedgerConflictError("RWA demo order ID already exists.");
    const order: RwaDemoOrderRecord = {
      id: orderId,
      quoteId,
      walletAddress: quote.walletAddress,
      assetId: quote.assetId,
      side: quote.side,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inputAmountAtomic: quote.inputAmountAtomic,
      expectedOutputAtomic: quote.expectedOutputAtomic,
      minimumOutputAtomic: quote.minimumOutputAtomic,
      feeAmountAtomic: quote.feeAmountAtomic,
      protocolFeeAtomic: quote.protocolFeeAtomic,
      slippageBps: quote.slippageBps,
      priceImpact: quote.priceImpact,
      poolAddress: quote.poolAddress,
      route: quote.route,
      network: quote.network,
      expiresAt: quote.expiresAt,
      status: "ORDER_CREATED",
      createdAt: now,
      updatedAt: now,
    };
    quote.orderId = order.id;
    demo.orders[order.id] = order;
    await writeLedgerFile(ledger);
    return { order, reused: false };
  });
}

export async function refreshRwaDemoOrderQuote({
  orderId,
  walletAddress,
  quote,
  transactionMessageDigest,
  transactionLastValidBlockHeight,
  now = Date.now(),
}: {
  orderId: string;
  walletAddress: string;
  quote: RwaDemoQuoteRecord;
  transactionMessageDigest: string;
  transactionLastValidBlockHeight: number;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const demo = rwaDemoOf(ledger);
    const order = demo.orders[orderId];
    if (!order || order.walletAddress !== walletAddress) {
      throw new RwaDemoLedgerConflictError("RWA demo order was not found for this wallet.");
    }
    if (!["ORDER_CREATED", "WALLET_APPROVAL_PENDING", "QUOTE_EXPIRED", "USER_REJECTED", "CONFIRMATION_TIMEOUT"].includes(order.status)) {
      throw new RwaDemoLedgerConflictError("RWA demo order can no longer be rebuilt.");
    }
    if (quote.walletAddress !== walletAddress || quote.side !== order.side || quote.inputAmountAtomic !== order.inputAmountAtomic) {
      throw new RwaDemoLedgerConflictError("Fresh RWA demo quote does not match the original order intent.");
    }
    if (!/^[a-f0-9]{64}$/.test(transactionMessageDigest)) {
      throw new RwaDemoLedgerConflictError("RWA demo transaction message digest is invalid.");
    }
    if (!Number.isSafeInteger(transactionLastValidBlockHeight) || transactionLastValidBlockHeight < 0) {
      throw new RwaDemoLedgerConflictError("RWA demo transaction validity height is invalid.");
    }
    if (demo.quotes[quote.id]) throw new RwaDemoLedgerConflictError("Fresh RWA demo quote ID already exists.");
    if (quote.expiresAt <= now) throw new RwaDemoLedgerConflictError("Fresh RWA demo quote has already expired.");
    assertOrderTransition(order.status, "WALLET_APPROVAL_PENDING");
    quote.orderId = order.id;
    demo.quotes[quote.id] = quote;
    Object.assign(order, {
      quoteId: quote.id,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      expectedOutputAtomic: quote.expectedOutputAtomic,
      minimumOutputAtomic: quote.minimumOutputAtomic,
      feeAmountAtomic: quote.feeAmountAtomic,
      protocolFeeAtomic: quote.protocolFeeAtomic,
      slippageBps: quote.slippageBps,
      priceImpact: quote.priceImpact,
      poolAddress: quote.poolAddress,
      expiresAt: quote.expiresAt,
      transactionMessageDigest,
      transactionLastValidBlockHeight,
      transactionSignature: undefined,
      status: "WALLET_APPROVAL_PENDING" satisfies RwaDemoOrderStatus,
      updatedAt: now,
      errorCode: undefined,
      errorMessage: undefined,
    });
    await writeLedgerFile(ledger);
    return order;
  });
}

export async function recordRwaDemoOrderSubmission({
  orderId,
  walletAddress,
  signature,
  now = Date.now(),
}: {
  orderId: string;
  walletAddress: string;
  signature: string;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const demo = rwaDemoOf(ledger);
    const order = demo.orders[orderId];
    if (!order || order.walletAddress !== walletAddress) {
      throw new RwaDemoLedgerConflictError("RWA demo order was not found for this wallet.");
    }
    const otherOrder = Object.values(demo.orders).find((item) => item.transactionSignature === signature && item.id !== order.id);
    if (otherOrder) throw new RwaDemoLedgerConflictError("This Solana signature is already linked to another RWA demo order.");
    if (order.transactionSignature && order.transactionSignature !== signature) {
      throw new RwaDemoLedgerConflictError("RWA demo order is already linked to a different transaction signature.");
    }
    if (!order.transactionMessageDigest) {
      throw new RwaDemoLedgerConflictError("RWA demo order has no prepared transaction message.");
    }
    if (order.transactionLastValidBlockHeight === undefined) {
      throw new RwaDemoLedgerConflictError("RWA demo order has no prepared transaction validity height.");
    }
    if (!order.transactionSignature) {
      assertOrderTransition(order.status, "TRANSACTION_SUBMITTED");
      order.transactionSignature = signature;
      order.status = "TRANSACTION_SUBMITTED";
      order.updatedAt = now;
      await writeLedgerFile(ledger);
    }
    return order;
  });
}

export async function markRwaDemoOrderConfirmationTimeout({
  orderId,
  walletAddress,
  errorCode,
  now = Date.now(),
}: {
  orderId: string;
  walletAddress: string;
  errorCode: string;
  now?: number;
}) {
  return updateRwaDemoOrderStatus({ orderId, walletAddress, status: "CONFIRMATION_TIMEOUT", errorCode, now });
}

export async function markRwaDemoOrderFailed({
  orderId,
  walletAddress,
  status,
  errorCode,
  now = Date.now(),
}: {
  orderId: string;
  walletAddress: string;
  status: "TRANSACTION_FAILED" | "NEEDS_REVIEW";
  errorCode: string;
  now?: number;
}) {
  return updateRwaDemoOrderStatus({ orderId, walletAddress, status, errorCode, now });
}

export async function markRwaDemoOrderConfirmed({
  orderId,
  walletAddress,
  actualInputAmountAtomic,
  actualOutputAmountAtomic,
  inputBalanceAfterAtomic,
  outputBalanceAfterAtomic,
  now = Date.now(),
}: {
  orderId: string;
  walletAddress: string;
  actualInputAmountAtomic: string;
  actualOutputAmountAtomic: string;
  inputBalanceAfterAtomic: string;
  outputBalanceAfterAtomic: string;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const demo = rwaDemoOf(ledger);
    const order = demo.orders[orderId];
    if (!order || order.walletAddress !== walletAddress) {
      throw new RwaDemoLedgerConflictError("RWA demo order was not found for this wallet.");
    }
    if (order.status === "COMPLETED") return order;
    assertOrderTransition(order.status, "ONCHAIN_CONFIRMED");
    Object.assign(order, {
      status: "ONCHAIN_CONFIRMED" satisfies RwaDemoOrderStatus,
      actualInputAmountAtomic,
      actualOutputAmountAtomic,
      inputBalanceAfterAtomic,
      outputBalanceAfterAtomic,
      errorCode: undefined,
      errorMessage: undefined,
      updatedAt: now,
    });
    await writeLedgerFile(ledger);
    return order;
  });
}

export async function completeRwaDemoOrder({
  orderId,
  walletAddress,
  now = Date.now(),
}: {
  orderId: string;
  walletAddress: string;
  now?: number;
}) {
  return updateRwaDemoOrderStatus({ orderId, walletAddress, status: "COMPLETED", now });
}

async function updateRwaDemoOrderStatus({
  orderId,
  walletAddress,
  status,
  errorCode,
  errorMessage,
  now,
}: {
  orderId: string;
  walletAddress: string;
  status: RwaDemoOrderStatus;
  errorCode?: string;
  errorMessage?: string;
  now: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const order = rwaDemoOf(ledger).orders[orderId];
    if (!order || order.walletAddress !== walletAddress) {
      throw new RwaDemoLedgerConflictError("RWA demo order was not found for this wallet.");
    }
    if (order.status !== status) assertOrderTransition(order.status, status);
    order.status = status;
    order.errorCode = errorCode;
    order.errorMessage = errorMessage;
    order.updatedAt = now;
    await writeLedgerFile(ledger);
    return order;
  });
}

function countsTowardFaucetCap(status: RwaDemoFundingStatus) {
  return status !== "FAILED";
}

export function getRwaDemoFundingEvent(eventId: string) {
  return exclusive(async () => rwaDemoOf(await readLedgerFile()).fundingEvents[eventId] ?? null);
}

export async function reserveRwaDemoFunding({
  event,
  dailyMaxQuoteAtomic,
  hourlyWalletLimit = 3,
  hourlyIpLimit = 8,
  now = Date.now(),
}: {
  event: RwaDemoFundingEvent;
  dailyMaxQuoteAtomic: string;
  hourlyWalletLimit?: number;
  hourlyIpLimit?: number;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const demo = rwaDemoOf(ledger);
    if (event.idempotencyKey) {
      const existing = Object.values(demo.fundingEvents).find((item) => item.idempotencyKey === event.idempotencyKey);
      if (existing) {
        if (existing.walletAddress !== event.walletAddress
          || existing.requestedKztAmount !== event.requestedKztAmount
          || existing.quoteTokenAmountAtomic !== event.quoteTokenAmountAtomic) {
          throw new RwaDemoLedgerConflictError("Idempotency key is already associated with another funding request.");
        }
        return { event: existing, reused: true };
      }
    }
    if (demo.fundingEvents[event.id]) throw new RwaDemoLedgerConflictError("RWA demo funding event ID already exists.");
    const active = Object.values(demo.fundingEvents).filter((item) => countsTowardFaucetCap(item.status));
    const hourAgo = now - 60 * 60 * 1_000;
    if (active.filter((item) => item.walletAddress === event.walletAddress && item.createdAt >= hourAgo).length >= hourlyWalletLimit) {
      throw new RwaDemoLedgerRateLimitError("Devnet faucet wallet rate limit reached. Try again later.");
    }
    if (active.filter((item) => item.ipHash === event.ipHash && item.createdAt >= hourAgo).length >= hourlyIpLimit) {
      throw new RwaDemoLedgerRateLimitError("Devnet faucet IP rate limit reached. Try again later.");
    }
    const dayStart = Math.floor(now / (24 * 60 * 60 * 1_000)) * 24 * 60 * 60 * 1_000;
    const issuedToday = active
      .filter((item) => item.createdAt >= dayStart)
      .reduce((total, item) => total + BigInt(item.quoteTokenAmountAtomic), BigInt(0));
    const requested = BigInt(event.quoteTokenAmountAtomic);
    if (issuedToday + requested > BigInt(dailyMaxQuoteAtomic)) {
      throw new RwaDemoLedgerRateLimitError("Devnet faucet daily aggregate cap reached. Try again tomorrow.");
    }
    demo.fundingEvents[event.id] = event;
    await writeLedgerFile(ledger);
    return { event, reused: false };
  });
}

export async function updateRwaDemoFundingEvent({
  eventId,
  walletAddress,
  status,
  mintSignature,
  errorCode,
  errorMessage,
  now = Date.now(),
}: {
  eventId: string;
  walletAddress: string;
  status: RwaDemoFundingStatus;
  mintSignature?: string;
  errorCode?: string;
  errorMessage?: string;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const event = rwaDemoOf(ledger).fundingEvents[eventId];
    if (!event || event.walletAddress !== walletAddress) {
      throw new RwaDemoLedgerConflictError("RWA demo funding event was not found for this wallet.");
    }
    const allowed: Record<RwaDemoFundingStatus, ReadonlySet<RwaDemoFundingStatus>> = {
      SIMULATED_CREATED: new Set(["SIMULATED_CONFIRMED", "FAILED", "NEEDS_REVIEW"]),
      SIMULATED_CONFIRMED: new Set(["TEST_TOKEN_ISSUED", "FAILED", "NEEDS_REVIEW"]),
      TEST_TOKEN_ISSUED: new Set(),
      FAILED: new Set(),
      NEEDS_REVIEW: new Set(),
    };
    if (event.status !== status && !allowed[event.status].has(status)) {
      throw new RwaDemoLedgerConflictError(`Invalid RWA demo funding state transition: ${event.status} -> ${status}.`);
    }
    event.status = status;
    if (mintSignature) event.mintSignature = mintSignature;
    event.errorCode = errorCode;
    event.errorMessage = errorMessage;
    event.updatedAt = now;
    await writeLedgerFile(ledger);
    return event;
  });
}

export function getRwaDemoPayoutForOrder(orderId: string, walletAddress: string) {
  return exclusive(async () => Object.values(rwaDemoOf(await readLedgerFile()).payoutEvents)
    .find((event) => event.orderId === orderId && event.walletAddress === walletAddress) ?? null);
}

export async function createRwaDemoPayout(event: RwaDemoPayoutEvent) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const demo = rwaDemoOf(ledger);
    const existing = Object.values(demo.payoutEvents)
      .find((item) => item.orderId === event.orderId && item.walletAddress === event.walletAddress);
    if (existing) return { event: existing, reused: true };
    if (demo.payoutEvents[event.id]) throw new RwaDemoLedgerConflictError("RWA demo payout event ID already exists.");
    demo.payoutEvents[event.id] = event;
    await writeLedgerFile(ledger);
    return { event, reused: false };
  });
}

export async function confirmRwaDemoPayout({
  eventId,
  walletAddress,
  now = Date.now(),
}: {
  eventId: string;
  walletAddress: string;
  now?: number;
}) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    const event = rwaDemoOf(ledger).payoutEvents[eventId];
    if (!event || event.walletAddress !== walletAddress) {
      throw new RwaDemoLedgerConflictError("RWA demo payout event was not found for this wallet.");
    }
    if (event.status === "SIMULATED_CREATED") {
      event.status = "SIMULATED_CONFIRMED";
      event.updatedAt = now;
      await writeLedgerFile(ledger);
    }
    return event;
  });
}
