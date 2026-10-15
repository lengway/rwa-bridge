import "server-only";

import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { KaminoActionStore } from "./kamino-action-store";
import { KaminoExecutionClaimStore } from "./kamino-execution-claims";
import { KaminoLendDevnetError, type KaminoLendAction } from "./kamino-lend-devnet-config";
import { prepareKaminoLendDevnetAction } from "./kamino-lend-devnet";
import { marketsPurchasesEnabled, prepareMarketsSubscribeTemplate } from "./markets/purchase-server";
import {
  createCrossmintKaminoTransaction, getCrossmintKaminoTransaction,
  listCrossmintKaminoTransactions, verifyCrossmintKaminoWallet,
  type CrossmintKaminoTransaction,
} from "./crossmint-kamino-provider";
import {
  inspectKaminoSmartWalletEnvelope, verifiedSmartWalletConnection,
  verifyKaminoSmartWalletFinalized, type SmartWalletTemplate,
} from "./kamino-smart-wallet-envelope-policy";

/** Strictly validated intent types the executor runs. Kamino and bond purchases never share validators. */
export type SmartWalletIntentAction = KaminoLendAction | "markets-subscribe";
export type SmartWalletStage = "CREATE_UNKNOWN" | "SETUP_REQUIRED" | "READY" | "PENDING" | "FAILED" | "COMPLETED";
export type SmartWalletExecutionRecord = {
  id: string;
  walletAddress: string;
  action: SmartWalletIntentAction | "initialize";
  amountAtomic: string;
  /** Bond mint of a markets-subscribe operation (part of the request identity). */
  mint?: string | null;
  status: SmartWalletStage;
  stage: SmartWalletStage;
  providerUUID: string;
  providerTransactionId: string | null;
  providerStatus: CrossmintKaminoTransaction["status"] | null;
  template: SmartWalletTemplate | null;
  immutableWire: string;
  envelope: Awaited<ReturnType<typeof inspectKaminoSmartWalletEnvelope>> | null;
  authorityAddress: string;
  settingsAddress: string | null;
  parentActionId: string | null;
  initializationOnly: boolean;
  signature: string | null;
  verification: {
    signature: string;
    actualLiquidityAmountAtomic?: string;
    actualCollateralAmountAtomic?: string;
    feeLamports?: string;
    balances?: { liquidityAmountAtomic: string; collateralAmountAtomic: string; solBalanceLamports: string };
    purchase?: { mint: string; units: string; costAtomic: string; bondUnits?: string; usdcAtomic?: string };
  } | null;
  failure: string | null;
  createdAt: number;
  updatedAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function storageBase() {
  return process.env.KAMINO_ACTION_STORE_PATH || `${process.env.DEMO_LEDGER_PATH || path.join(process.cwd(), ".demo-ledger.json")}.kamino-smart-wallet`;
}
const actionStore = new KaminoActionStore<SmartWalletExecutionRecord>(storageBase());
const claims = new KaminoExecutionClaimStore(storageBase());

function requireEnabled(action: SmartWalletIntentAction | "initialize" | null = null) {
  if (action === "markets-subscribe") {
    if (!marketsPurchasesEnabled()) throw new KaminoLendDevnetError("DEVNET_DISABLED", "Bond purchases are unavailable.");
    return;
  }
  if (process.env.ENABLE_KAMINO_LEND_DEVNET !== "true" || process.env.SOLANA_CLUSTER !== "devnet") {
    throw new KaminoLendDevnetError("DEVNET_DISABLED", "Kamino smart-wallet actions are unavailable.");
  }
}
function anyEnabled() {
  if (process.env.SOLANA_CLUSTER !== "devnet" || (process.env.ENABLE_KAMINO_LEND_DEVNET !== "true" && !marketsPurchasesEnabled())) {
    throw new KaminoLendDevnetError("DEVNET_DISABLED", "Smart-wallet actions are unavailable.");
  }
}
function bad(message: string): never { throw new KaminoLendDevnetError("SMART_WALLET_EXECUTION_REJECTED", message); }
function actionId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) bad("A valid request ID is required.");
  return value.toLowerCase();
}
function createClaimPath(id: string) { return path.join(`${storageBase()}.create-claims`, `${id}.json`); }
async function reserveProviderCreate(record: SmartWalletExecutionRecord) {
  const filePath = createClaimPath(record.id);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(filePath, "wx", 0o600); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as SmartWalletExecutionRecord;
    if (persisted.id !== record.id || persisted.immutableWire !== record.immutableWire) bad("A durable provider-creation claim conflicts with this request.");
    return { first: false, record: persisted };
  }
  try { await handle.writeFile(JSON.stringify(record), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  return { first: true, record };
}
async function readProviderCreateReservation(id: string) {
  try { return JSON.parse(await readFile(createClaimPath(id), "utf8")) as SmartWalletExecutionRecord; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
}
async function reserveParentInitialization(parentId: string, childId: string) {
  const directory = `${storageBase()}.initialization-claims`;
  const filePath = path.join(directory, `${parentId}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const handle = await open(filePath, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify({ parentId, childId }), "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    return;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    const prior = JSON.parse(await readFile(filePath, "utf8")) as { parentId?: string; childId?: string };
    if (prior.parentId !== parentId || prior.childId !== childId) bad("This deposit already has a separate initialization request.");
  }
}
function output(record: SmartWalletExecutionRecord) {
  const simulation = record.envelope?.simulation ?? { ok: false, unitsConsumed: null };
  return {
    actionId: record.id, ...(record.providerTransactionId ? { providerTransactionId: record.providerTransactionId } : {}),
    action: record.action, amountAtomic: record.amountAtomic, walletAddress: record.walletAddress,
    ...(record.mint ? { mint: record.mint } : {}),
    network: "devnet", feeMode: "project", stage: record.stage,
    simulation: { ...simulation, ...(record.initializationOnly ? { initializationOnly: true } : {}) },
    ...(record.initializationOnly ? { initializationOnly: true } : {}),
  };
}

async function save(record: SmartWalletExecutionRecord) {
  record.updatedAt = Date.now();
  await actionStore.put(record);
}
export async function executeDurableProviderCreate<TRecord extends {
  stage: SmartWalletStage; status: SmartWalletStage; immutableWire: string;
  providerTransactionId: string | null; providerStatus: CrossmintKaminoTransaction["status"] | null;
}>(record: TRecord, deps: {
  reserve: () => Promise<{ first: boolean }>;
  persist: (record: TRecord) => Promise<void>;
  create: (wire: string) => Promise<CrossmintKaminoTransaction>;
  inspect: (record: TRecord, provider: CrossmintKaminoTransaction) => Promise<void>;
}): Promise<TRecord> {
  const reservation = await deps.reserve();
  if (!reservation.first) bad("This provider request is already reserved and must be recovered without another submission.");
  record.stage = record.status = "CREATE_UNKNOWN";
  await deps.persist(record);
  try {
    const provider = await deps.create(record.immutableWire);
    if (provider.params.transaction !== record.immutableWire) bad("Provider transaction input differs from the immutable request.");
    record.providerTransactionId = provider.id;
    record.providerStatus = provider.status;
    await deps.inspect(record, provider);
    await deps.persist(record);
    return record;
  } catch (cause) {
    record.stage = record.status = "CREATE_UNKNOWN";
    await deps.persist(record).catch(() => undefined);
    throw cause;
  }
}
async function findProvider(walletAddress: string, wire: string) {
  const matches = (await listCrossmintKaminoTransactions(walletAddress)).filter((tx: CrossmintKaminoTransaction) => tx.params.transaction === wire);
  if (matches.length > 1) bad("Provider submission is ambiguous; it remains blocked for recovery.");
  return matches[0] ?? null;
}
async function materialize(record: SmartWalletExecutionRecord, provider: CrossmintKaminoTransaction, email: string) {
  if (provider.params.transaction !== record.immutableWire) bad("Provider transaction input differs from the stored request.");
  const verified = await verifyCrossmintKaminoWallet(record.walletAddress, email);
  const connection = await verifiedSmartWalletConnection();
  const envelope = await inspectKaminoSmartWalletEnvelope(connection, provider, record.template, verified.authorityAddress, record.walletAddress, record.initializationOnly);
  if (verified.authorityAddress !== record.authorityAddress) bad("Verified wallet authority changed after preparation.");
  record.providerTransactionId = provider.id;
  record.providerStatus = provider.status;
  record.envelope = envelope;
  record.settingsAddress = envelope.settingsAddress;
  if (record.initializationOnly) {
    if (envelope.decodedInstructions.length || !envelope.setupRequired) bad("Initialization must be an empty wrapper for an uninitialized smart wallet.");
    record.stage = "READY";
  } else if (envelope.setupRequired && provider.status === "awaiting-approval") record.stage = "SETUP_REQUIRED";
  else if (envelope.setupRequired) record.stage = "PENDING";
  else if (envelope.simulation.ok) record.stage = provider.status === "awaiting-approval" ? "READY" : "PENDING";
  else bad("The actual Devnet simulation did not pass.");
  record.status = record.stage;
  await save(record);
  return record;
}

export async function prepareSmartWalletAction(input: { email: string; walletAddress: string; action: SmartWalletIntentAction; amountAtomic: unknown; requestId: unknown; mint?: unknown }) {
  requireEnabled(input.action);
  const id = actionId(input.requestId);
  const amount = typeof input.amountAtomic === "string" ? input.amountAtomic : "";
  const mint = input.action === "markets-subscribe" ? (typeof input.mint === "string" ? input.mint : "") : null;
  const sameRequest = (r: SmartWalletExecutionRecord) => r.walletAddress === input.walletAddress && r.action === input.action && r.amountAtomic === amount && (r.mint ?? null) === mint;
  const existing = await actionStore.get(id);
  if (existing) {
    if (!sameRequest(existing)) bad("Request ID is already bound to a different operation.");
    if (existing.providerTransactionId && existing.stage !== "CREATE_UNKNOWN") return output(existing);
    if (existing.stage !== "CREATE_UNKNOWN") bad("Stored operation is incomplete and cannot be resubmitted.");
    const found = await findProvider(input.walletAddress, existing.immutableWire);
    if (!found) bad("Provider submission remains uncertain. Do not retry with a new request until recovery is complete.");
    return output(await materialize(existing, found, input.email));
  }
  const reserved = await readProviderCreateReservation(id);
  if (reserved) {
    if (!sameRequest(reserved) || reserved.initializationOnly) bad("Request ID is already bound to a different operation.");
    await actionStore.put(reserved);
    if (reserved.providerTransactionId) return output(reserved);
    const found = await findProvider(input.walletAddress, reserved.immutableWire);
    if (!found) bad("Provider submission remains uncertain. Do not submit again.");
    return output(await materialize(reserved, found, input.email));
  }
  const verified = await verifyCrossmintKaminoWallet(input.walletAddress, input.email);
  const template: SmartWalletTemplate = input.action === "markets-subscribe"
    ? await prepareMarketsSubscribeTemplate({ walletAddress: input.walletAddress, mint, units: input.amountAtomic })
    : await kaminoTemplate(input.action, input.walletAddress, input.amountAtomic);
  const claim = { walletAddress: input.walletAddress, actionId: id, action: input.action, amountAtomic: template.amountAtomic, providerUUID: id };
  const claimResult = await claims.claimExecution(claim);
  const record: SmartWalletExecutionRecord = {
    id, walletAddress: input.walletAddress, action: input.action, amountAtomic: template.amountAtomic, mint,
    status: "CREATE_UNKNOWN", stage: "CREATE_UNKNOWN", providerUUID: id, providerTransactionId: null,
    providerStatus: null, template, immutableWire: template.serializedTransaction, envelope: null,
    authorityAddress: verified.authorityAddress, settingsAddress: null, parentActionId: null,
    initializationOnly: false, signature: null, verification: null, failure: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (claimResult.replayed) {
    // A prior execution claim without its action record is ambiguous. Never
    // make a new provider transaction under a replayed wallet claim.
    bad("This request has an existing execution claim and requires recovery.");
  }
  return output(await executeDurableProviderCreate(record, {
    reserve: async () => reserveProviderCreate(record),
    persist: save,
    create: wire => createCrossmintKaminoTransaction(input.walletAddress, wire, verified.signerLocator),
    inspect: async (pending, provider) => { await materialize(pending, provider, input.email); },
  }));
}

async function kaminoTemplate(action: KaminoLendAction, walletAddress: string, amountAtomic: unknown): Promise<SmartWalletTemplate> {
  const template = await prepareKaminoLendDevnetAction({ action, walletAddress, amountAtomic, smartWalletTemplate: true });
  return {
    serializedTransaction: template.serializedTransaction,
    intentInstructions: "intentInstructions" in template ? template.intentInstructions : [],
    action, walletAddress, amountAtomic: template.amountAtomic,
    collateralAmountAtomic: template.collateralAmountAtomic ?? null,
    blockhash: template.blockhash, lastValidBlockHeight: template.lastValidBlockHeight,
  };
}

function initializationWire(walletAddress: string, blockhash: string) {
  const payer = new PublicKey(walletAddress);
  // Crossmint replaces this fee-payer placeholder and adds its smart-wallet wrapper.
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })] }).compileToV0Message();
  return bs58.encode(new VersionedTransaction(message).serialize());
}

export async function initializeSmartWallet(input: { email: string; walletAddress: string; requestId: unknown; parentActionId: unknown }) {
  anyEnabled();
  const id = actionId(input.requestId);
  const parentId = actionId(input.parentActionId);
  const parent = await actionStore.get(parentId);
  if (parent && parent.action !== "initialize") requireEnabled(parent.action);
  if (!parent || parent.walletAddress !== input.walletAddress || parent.action === "initialize" || parent.stage !== "SETUP_REQUIRED" || parent.providerStatus !== "awaiting-approval" || parent.signature || !parent.envelope?.setupRequired) bad("Initialization is available only for this wallet's verified setup-required operation.");
  await reserveParentInitialization(parentId, id);
  const existing = await actionStore.get(id);
  if (existing) {
    if (existing.walletAddress !== input.walletAddress || !existing.initializationOnly || existing.parentActionId !== parentId) bad("Request ID is already bound to a different operation.");
    if (existing.providerTransactionId && existing.stage !== "CREATE_UNKNOWN") return output(existing);
    const found = await findProvider(input.walletAddress, existing.immutableWire);
    if (!found) bad("Initialization submission remains uncertain. Do not submit it again.");
    return output(await materialize(existing, found, input.email));
  }
  const priorReservation = await readProviderCreateReservation(id);
  if (priorReservation) {
    if (priorReservation.walletAddress !== input.walletAddress || !priorReservation.initializationOnly || priorReservation.parentActionId !== parentId) bad("Request ID is already bound to a different operation.");
    await actionStore.put(priorReservation);
    if (priorReservation.providerTransactionId) return output(priorReservation);
    const found = await findProvider(input.walletAddress, priorReservation.immutableWire);
    if (!found) bad("Initialization submission remains uncertain. Do not submit it again.");
    return output(await materialize(priorReservation, found, input.email));
  }
  const verified = await verifyCrossmintKaminoWallet(input.walletAddress, input.email);
  if (verified.authorityAddress !== parent.authorityAddress) bad("Verified wallet authority changed after preparation.");
  const connection = await verifiedSmartWalletConnection();
  const latest = await connection.getLatestBlockhash("confirmed");
  const initWire = initializationWire(input.walletAddress, latest.blockhash);
  // Reuse the parent action's indefinite wallet lease; the initializer is not a deposit claim.
  const record: SmartWalletExecutionRecord = {
    id, walletAddress: input.walletAddress, action: "initialize", amountAtomic: "0", status: "CREATE_UNKNOWN", stage: "CREATE_UNKNOWN",
    providerUUID: id, providerTransactionId: null, providerStatus: null, template: null, immutableWire: initWire,
    envelope: null, authorityAddress: verified.authorityAddress, settingsAddress: null, parentActionId: parentId,
    initializationOnly: true, signature: null, verification: null, failure: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  return output(await executeDurableProviderCreate(record, {
    reserve: async () => reserveProviderCreate(record),
    persist: save,
    create: wire => createCrossmintKaminoTransaction(input.walletAddress, wire, verified.signerLocator),
    inspect: async (pending, provider) => { await materialize(pending, provider, input.email); },
  }));
}

export async function getSmartWalletStatus(input: { email: string; walletAddress: string; actionId: unknown }) {
  anyEnabled();
  const id = actionId(input.actionId);
  const record = await actionStore.get(id);
  if (!record || record.walletAddress !== input.walletAddress) throw new KaminoLendDevnetError("ACTION_NOT_FOUND", "Operation was not found for this wallet.");
  const parentAction = record.initializationOnly ? (await actionStore.get(record.parentActionId!))?.action ?? null : record.action;
  requireEnabled(parentAction === "initialize" ? null : parentAction);
  if (record.stage === "COMPLETED" || record.stage === "FAILED") return statusOutput(record);
  if (!record.providerTransactionId) {
    const provider = await findProvider(record.walletAddress, record.immutableWire);
    if (provider) await materialize(record, provider, input.email);
    else return { actionId: record.id, action: record.action, stage: "PENDING", confirmed: false, walletAddress: record.walletAddress, network: "devnet", feeMode: "project" };
  }
  const refreshed = await actionStore.get(id);
  if (!refreshed?.providerTransactionId) bad("Operation is still being recovered.");
  const provider = await getCrossmintKaminoTransaction(refreshed.walletAddress, refreshed.providerTransactionId);
  if (provider.params.transaction !== refreshed.immutableWire) bad("Provider transaction no longer matches the stored request.");
  refreshed.providerStatus = provider.status;
  if (provider.status === "failed" && !provider.onChain.txId && !provider.onChain.proxiedTxId) {
    // Crossmint rejected the transaction before broadcast (e.g. the blockhash expired
    // while awaiting approval). Nothing reached the chain, so the operation is terminal
    // and a fresh request may be prepared; otherwise status polling never ends.
    refreshed.stage = refreshed.status = "FAILED";
    refreshed.failure = "The wallet provider expired the transaction before it was submitted.";
    if (refreshed.initializationOnly) {
      const parent = await actionStore.get(refreshed.parentActionId!);
      if (parent && parent.stage === "SETUP_REQUIRED") {
        parent.stage = parent.status = "FAILED";
        parent.failure = "Wallet initialization expired before submission. Prepare a new action.";
        await save(parent);
      }
    }
    const claimRecord = refreshed.initializationOnly ? await actionStore.get(refreshed.parentActionId!) : refreshed;
    if (claimRecord) {
      await claims.releaseWalletLease({ walletAddress: claimRecord.walletAddress, providerUUID: claimRecord.providerUUID, actionId: claimRecord.id, resolution: "never-submitted" })
        .catch(cause => console.error("[kamino] lease release after provider expiry failed:", cause instanceof Error ? cause.message : cause));
    }
    await save(refreshed);
    return statusOutput(refreshed);
  }
  if (provider.status === "success" || provider.status === "pending" || provider.status === "failed") {
    refreshed.stage = refreshed.status = "PENDING";
    if (provider.onChain.txId || provider.onChain.proxiedTxId) {
      const connection = await verifiedSmartWalletConnection();
      if (!refreshed.envelope) bad("The reviewed transaction envelope is unavailable for receipt verification.");
      const verified = await verifyKaminoSmartWalletFinalized(connection, provider, {
        action: refreshed.action, walletAddress: refreshed.walletAddress,
        authorityAddress: refreshed.authorityAddress, template: refreshed.template,
        envelope: refreshed.envelope,
      });
      if (verified.status === "COMPLETED" && verified.confirmed) {
        const claimRecord = refreshed.initializationOnly ? await actionStore.get(refreshed.parentActionId!) : refreshed;
        if (!claimRecord) bad("Parent execution claim is unavailable for signature recovery.");
        await claims.claimSignature(claimRecord.providerUUID, claimRecord.id, verified.signature);
        refreshed.stage = refreshed.status = "COMPLETED";
        refreshed.signature = verified.signature;
        refreshed.verification = verified;
        if (refreshed.initializationOnly) {
          const parent = await actionStore.get(refreshed.parentActionId!);
          if (parent && parent.stage === "SETUP_REQUIRED" && !parent.signature && parent.providerStatus === "awaiting-approval") {
            parent.stage = parent.status = "FAILED";
            parent.failure = "Smart wallet initialized. Prepare a new deposit request.";
            await save(parent);
          }
        }
        await claims.releaseWalletLease({ walletAddress: claimRecord.walletAddress, providerUUID: claimRecord.providerUUID, actionId: claimRecord.id, resolution: "verified-terminal" });
      } else if (verified.status === "FAILED") {
        const claimRecord = refreshed.initializationOnly ? await actionStore.get(refreshed.parentActionId!) : refreshed;
        if (!claimRecord) bad("Parent execution claim is unavailable for signature recovery.");
        await claims.claimSignature(claimRecord.providerUUID, claimRecord.id, verified.signature);
        refreshed.stage = refreshed.status = "FAILED";
        refreshed.signature = verified.signature;
        refreshed.failure = "The exact reviewed transaction was finalized with an on-chain error.";
        refreshed.verification = { signature: verified.signature };
        if (refreshed.initializationOnly) {
          const parent = await actionStore.get(refreshed.parentActionId!);
          if (parent && parent.stage === "SETUP_REQUIRED") {
            parent.stage = parent.status = "FAILED";
            parent.failure = "Wallet initialization failed. Prepare a new action after reviewing wallet setup.";
            await save(parent);
          }
        }
        await claims.releaseWalletLease({ walletAddress: claimRecord.walletAddress, providerUUID: claimRecord.providerUUID, actionId: claimRecord.id, resolution: "verified-terminal" });
      }
    }
  }
  await save(refreshed);
  return statusOutput(refreshed);
}

function statusOutput(record: SmartWalletExecutionRecord) {
  return {
    actionId: record.id, action: record.action, stage: record.stage === "CREATE_UNKNOWN" ? "PENDING" : record.stage,
    confirmed: record.stage === "COMPLETED", ...(record.signature ? { signature: record.signature } : {}),
    ...(record.verification ? {
      actualLiquidityAmountAtomic: record.verification.actualLiquidityAmountAtomic,
      actualCollateralAmountAtomic: record.verification.actualCollateralAmountAtomic,
      feeLamports: record.verification.feeLamports,
      balances: record.verification.balances,
      ...(record.verification.purchase ? { purchase: record.verification.purchase } : {}),
    } : {}),
    ...(record.mint ? { mint: record.mint } : {}),
    walletAddress: record.walletAddress, network: "devnet", feeMode: "project",
  };
}

export async function getConfirmedSmartWalletHistory(walletAddress: string) {
  const rows = await actionStore.list(walletAddress);
  // Kamino history only; bond purchases are listed by getConfirmedBondPurchases.
  return rows.filter(record => record.stage === "COMPLETED" && record.verification && (record.action === "deposit" || record.action === "withdraw")).map(record => ({
    actionId: record.id, action: record.action, amountAtomic: record.amountAtomic,
    actualLiquidityAmountAtomic: record.verification!.actualLiquidityAmountAtomic,
    actualCollateralAmountAtomic: record.verification!.actualCollateralAmountAtomic,
    signature: record.verification!.signature, feeLamports: record.verification!.feeLamports,
    balances: record.verification!.balances, createdAt: record.createdAt,
  }));
}

export async function getConfirmedBondPurchases(walletAddress: string) {
  const rows = await actionStore.list(walletAddress);
  return rows.filter(record => record.action === "markets-subscribe" && record.stage === "COMPLETED" && record.verification?.purchase).map(record => ({
    actionId: record.id, mint: record.verification!.purchase!.mint, units: record.verification!.purchase!.units,
    costAtomic: record.verification!.purchase!.costAtomic, signature: record.verification!.signature, createdAt: record.createdAt,
  }));
}

export async function getSmartWalletExecution(actionIdValue: string) { return actionStore.get(actionId(actionIdValue)); }
