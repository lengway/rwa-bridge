import "server-only";
import { KaminoLendDevnetError } from "./kamino-lend-devnet-config";

/** Never follow a provider URL or use a production key for this executor. */
const BASE = "https://staging.crossmint.com/api/2025-06-09/wallets";
export type CrossmintKaminoTransaction = {
  id: string;
  chainType: "solana";
  walletType: "smart";
  status: "awaiting-approval" | "pending" | "failed" | "success";
  params: { transaction: string; feeConfig?: { feePayer?: string; amount?: string } };
  onChain: { transaction: string; txId?: string; proxiedTxId?: string; lastValidBlockHeight?: number };
  fees?: { mode?: string };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reject(message: string): never { throw new KaminoLendDevnetError("CROSSMINT_UNAVAILABLE", message); }
async function request(wallet: string, suffix = "", body?: unknown) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) reject("Invalid wallet.");
  const key = process.env.CROSSMINT_SERVER_API_KEY?.trim();
  if (process.env.SOLANA_CLUSTER !== "devnet" || !key || !/^sk_staging_[A-Za-z0-9_-]+$/.test(key)) reject("Crossmint Devnet executor is not configured.");
  const response = await fetch(`${BASE}/${encodeURIComponent(wallet)}${suffix}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25000), cache: "no-store", redirect: "error",
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    // Provider payloads can include signer PII and account identifiers. Do not relay them.
    if (response.status === 422 && value?.code === "TRANSACTION_SIMULATION_FAILED") {
      throw new KaminoLendDevnetError("SIMULATION_FAILED", "Crossmint could not prepare this operation. Check funds and wallet setup.");
    }
    reject("Crossmint could not process the operation. Do not resubmit until its status is checked.");
  }
  return value;
}
export async function verifyCrossmintKaminoWallet(walletAddress: string, sessionEmail: string) {
  const wallet = await request(walletAddress);
  if (wallet?.address !== walletAddress || wallet?.chainType !== "solana" || wallet?.type !== "smart") reject("Wallet is not a Crossmint Solana smart wallet.");
  const signer = wallet.config?.adminSigner;
  const recoveries = wallet.config?.recoveryMethods;
  const bound = signer?.type === "email" && signer.email?.toLowerCase() === sessionEmail.toLowerCase()
    || Array.isArray(recoveries) && recoveries.some((item: { type?: string; email?: string }) => item.type === "email" && item.email?.toLowerCase() === sessionEmail.toLowerCase());
  if (!bound || typeof signer?.locator !== "string") reject("Crossmint wallet ownership could not be verified.");
  if (typeof signer.address !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(signer.address)) reject("This executor currently requires the registered Ed25519 signer.");
  return { signerLocator: signer.locator as string, authorityAddress: signer.address as string };
}
export function validateCrossmintKaminoTransaction(value: unknown, expectedId?: string): CrossmintKaminoTransaction {
  const x = value as CrossmintKaminoTransaction | null;
  if (!x || !UUID.test(x.id) || expectedId !== undefined && x.id !== expectedId
    || x.chainType !== "solana" || x.walletType !== "smart"
    || !["awaiting-approval", "pending", "failed", "success"].includes(x.status)
    || typeof x.params?.transaction !== "string" || typeof x.onChain?.transaction !== "string"
    || x.fees?.mode !== "project") reject("Crossmint returned an unsupported execution or fee policy.");
  return x;
}
export async function createCrossmintKaminoTransaction(wallet: string, wire: string, signerLocator: string) {
  return validateCrossmintKaminoTransaction(await request(wallet, "/transactions", { params: { transaction: wire, signer: signerLocator }, fees: { mode: "project" } }));
}
export async function getCrossmintKaminoTransaction(wallet: string, transactionId: string) {
  if (!UUID.test(transactionId)) reject("Invalid Crossmint operation ID.");
  return validateCrossmintKaminoTransaction(await request(wallet, `/transactions/${transactionId}`), transactionId);
}

/** A bounded discovery read; ambiguity must remain CREATE_UNKNOWN. Never retry POST. */
export async function listCrossmintKaminoTransactions(wallet: string) {
  const value = await request(wallet, "/transactions");
  if (!Array.isArray(value?.transactions) || value.transactions.length > 100) reject("Provider recovery list is unavailable or too large.");
  return value.transactions.map((entry: unknown) => validateCrossmintKaminoTransaction(entry));
}
