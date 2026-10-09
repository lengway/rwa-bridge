import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";

export type LedgerDeposit = {
  productId: string;
  amountUsd: number;
  signature: string;
  at: number;
  shares?: number;
  priceUsd?: number;
  mintSignature?: string;
};

export type LedgerWithdrawal = {
  productId: string;
  signature: string;
  at: number;
  shares?: number;
  amountUsd?: number;
  priceUsd?: number;
  payoutSignature?: string;
  burnSignature?: string;
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

type Ledger = {
  wallets: Record<string, WalletLedger>;
  vaultCheckpoints: Record<string, VaultCheckpoint>;
  emails: Record<string, EmailLedgerRecord>;
  authChallenges: Record<string, AuthChallengeRecord>;
  authEmailRequests: Record<string, number[]>;
  authIpRequests: Record<string, number[]>;
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

async function readLedgerFile(): Promise<Ledger> {
  try {
    const parsed = JSON.parse(await readFile(LEDGER_PATH, "utf8")) as Partial<Ledger>;
    const wallets = parsed.wallets && typeof parsed.wallets === "object" ? parsed.wallets : {};
    const vaultCheckpoints = parsed.vaultCheckpoints && typeof parsed.vaultCheckpoints === "object"
      ? parsed.vaultCheckpoints
      : {};
    const emails = parsed.emails && typeof parsed.emails === "object" ? parsed.emails : {};
    const authChallenges = parsed.authChallenges && typeof parsed.authChallenges === "object" ? parsed.authChallenges : {};
    const authEmailRequests = parsed.authEmailRequests && typeof parsed.authEmailRequests === "object" ? parsed.authEmailRequests : {};
    const authIpRequests = parsed.authIpRequests && typeof parsed.authIpRequests === "object" ? parsed.authIpRequests : {};
    return {
      vaultCheckpoints,
      emails,
      authChallenges,
      authEmailRequests,
      authIpRequests,
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
      return { wallets: {}, vaultCheckpoints: {}, emails: {}, authChallenges: {}, authEmailRequests: {}, authIpRequests: {} };
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
      .filter((item) => item.productId === productId && !item.mintSignature)
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
