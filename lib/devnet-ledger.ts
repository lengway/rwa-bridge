import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type LedgerDeposit = {
  productId: string;
  amountUsd: number;
  signature: string;
  at: number;
};

export type LedgerWithdrawal = {
  productId: string;
  principalUsd: number;
  earnedUsd: number;
  signature: string;
  at: number;
};

export type LedgerPurchase = {
  assetId: string;
  amountUsd: number;
  units: number;
  paymentSignature: string;
  mintSignature: string;
  at: number;
};

export type WalletLedger = {
  deposits: LedgerDeposit[];
  withdrawals: LedgerWithdrawal[];
  purchases: LedgerPurchase[];
};

type Ledger = { wallets: Record<string, WalletLedger> };

const LEDGER_PATH = path.join(process.cwd(), ".demo-ledger.json");
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
  return { deposits: [], withdrawals: [], purchases: [] };
}

async function readLedgerFile(): Promise<Ledger> {
  try {
    const parsed = JSON.parse(await readFile(LEDGER_PATH, "utf8")) as Partial<Ledger>;
    const wallets = parsed.wallets && typeof parsed.wallets === "object" ? parsed.wallets : {};
    return {
      wallets: Object.fromEntries(Object.entries(wallets).map(([wallet, value]) => {
        const record = value as Partial<WalletLedger>;
        return [wallet, {
          deposits: Array.isArray(record.deposits) ? record.deposits : [],
          withdrawals: Array.isArray(record.withdrawals) ? record.withdrawals : [],
          purchases: Array.isArray(record.purchases) ? record.purchases : [],
        } satisfies WalletLedger];
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { wallets: {} };
    throw error;
  }
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
    wallet.deposits.some((item) => item.signature === signature)
      || wallet.withdrawals.some((item) => item.signature === signature)
      || wallet.purchases.some((item) => item.paymentSignature === signature || item.mintSignature === signature),
  );
}

export function getLedgerWallet(walletAddress: string) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress));
}

export function hasLedgerSignature(signature: string) {
  return exclusive(async () => signatureIsUsed(await readLedgerFile(), signature));
}

export function findLedgerPurchase(walletAddress: string, paymentSignature: string) {
  return exclusive(async () => walletOf(await readLedgerFile(), walletAddress).purchases
    .find((purchase) => purchase.paymentSignature === paymentSignature) ?? null);
}

export function getAvailablePrincipal(walletAddress: string, productId: string) {
  return exclusive(async () => {
    const wallet = walletOf(await readLedgerFile(), walletAddress);
    const deposited = wallet.deposits
      .filter((item) => item.productId === productId)
      .reduce((total, item) => total + item.amountUsd, 0);
    const withdrawn = wallet.withdrawals
      .filter((item) => item.productId === productId)
      .reduce((total, item) => total + item.principalUsd, 0);
    return Math.max(0, deposited - withdrawn);
  });
}

export async function appendDeposit(walletAddress: string, deposit: LedgerDeposit) {
  return exclusive(async () => {
    const ledger = await readLedgerFile();
    if (signatureIsUsed(ledger, deposit.signature)) throw new Error("Эта транзакция уже была использована.");
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
    const deposited = wallet.deposits
      .filter((item) => item.productId === withdrawal.productId)
      .reduce((total, item) => total + item.amountUsd, 0);
    const withdrawn = wallet.withdrawals
      .filter((item) => item.productId === withdrawal.productId)
      .reduce((total, item) => total + item.principalUsd, 0);
    if (withdrawal.principalUsd > deposited - withdrawn + 0.000001) {
      throw new Error("Сумма основного вклада превышает подтверждённые пополнения.");
    }
    wallet.withdrawals.push(withdrawal);
    ledger.wallets[walletAddress] = wallet;
    await writeLedgerFile(ledger);
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
