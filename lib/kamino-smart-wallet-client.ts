import { PublicKey } from "@solana/web3.js";

export type SmartWalletActionKind = "deposit" | "withdraw" | "markets-subscribe" | "initialize";
/** Operations a user starts (everything except the one-time wallet setup). */
export type SmartWalletIntentKind = Exclude<SmartWalletActionKind, "initialize">;
/** Journals are kept per product so a Kamino screen never resumes a bond purchase and vice versa. */
export type SmartWalletJournal = "kamino" | "markets";
export type SmartWalletOperationStage =
  | "READY"
  | "PENDING"
  | "SETUP_REQUIRED"
  | "FAILED"
  | "COMPLETED";

export type PreparedSmartWalletOperation = {
  actionId: string;
  providerTransactionId?: string;
  action: SmartWalletActionKind;
  amountAtomic: string;
  /** Bond mint (markets-subscribe only). */
  mint?: string;
  network: "devnet";
  stage: "READY" | "SETUP_REQUIRED";
  feeMode: "project";
  walletAddress: string;
  simulation: { ok: boolean; initializationOnly?: true };
  initializationOnly?: true;
};

export type SmartWalletOperationStatus = {
  actionId: string;
  action: SmartWalletActionKind;
  stage: SmartWalletOperationStage;
  confirmed: boolean;
  signature?: string;
  walletAddress: string;
  network: "devnet";
  feeMode: "project";
};

export type StoredSmartWalletOperation = {
  actionId: string;
  providerTransactionId?: string;
  action: SmartWalletActionKind;
  amountAtomic: string;
  /** Bond mint (markets-subscribe only). */
  mint?: string;
  walletAddress: string;
  initializationRequestId?: string;
  parentActionId?: string;
  /** Durable intent from the single review tap; never inferred during recovery. */
  userStarted?: boolean;
  approvalRequested?: boolean;
  continuation?: { actionId: string; action: SmartWalletIntentKind; amountAtomic: string; mint?: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<SmartWalletActionKind>(["deposit", "withdraw", "markets-subscribe", "initialize"]);
const STAGES = new Set<SmartWalletOperationStage>(["READY", "PENDING", "SETUP_REQUIRED", "FAILED", "COMPLETED"]);
const STORAGE_PREFIX = "plain:kamino-smart-wallet-operation:v1:";
const MARKETS_STORAGE_PREFIX = "plain:markets-purchase-operation:v1:";

export class KaminoSmartWalletClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KaminoSmartWalletClientError";
  }
}

function fail(message: string): never {
  throw new KaminoSmartWalletClientError(message);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("The wallet service returned an invalid response.");
  return value as Record<string, unknown>;
}

function canonicalWallet(value: unknown): string {
  if (typeof value !== "string") fail("The wallet service returned an invalid address.");
  try {
    const address = new PublicKey(value).toBase58();
    if (address !== value) fail("The wallet service returned an invalid address.");
    return address;
  } catch {
    return fail("The wallet service returned an invalid address.");
  }
}

function actionKind(value: unknown): SmartWalletActionKind {
  if (typeof value !== "string" || !ACTIONS.has(value as SmartWalletActionKind)) {
    fail("The wallet service returned an unknown operation type.");
  }
  return value as SmartWalletActionKind;
}

function atomicAmount(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) fail("The wallet service returned an invalid amount.");
  return value;
}

function feeMode(value: unknown): "project" {
  if (value !== "project") fail("Plain has not confirmed it will pay the network fee for this operation.");
  return "project";
}

function network(value: unknown): "devnet" {
  if (value !== "devnet") fail("The operation is not restricted to Solana Devnet.");
  return "devnet";
}

function optionalMint(value: unknown, action: SmartWalletActionKind, expected?: string): string | undefined {
  if (action !== "markets-subscribe") {
    if (value !== undefined) fail("The wallet service returned an unexpected bond.");
    return undefined;
  }
  const mint = canonicalWallet(value);
  if (expected !== undefined && mint !== expected) fail("The prepared operation is for a different bond.");
  return mint;
}

export function parsePreparedSmartWalletOperation(
  value: unknown,
  expected: { walletAddress: string; action: SmartWalletActionKind; amountAtomic: string; requestId: string; mint?: string },
): PreparedSmartWalletOperation {
  const source = object(value);
  const action = actionKind(source.action);
  const amountAtomicValue = atomicAmount(source.amountAtomic);
  const walletAddress = canonicalWallet(source.walletAddress);
  const stage = source.stage;
  if (stage !== "READY" && stage !== "SETUP_REQUIRED") fail("The wallet service returned an unknown preparation status.");
  if (typeof source.actionId !== "string" || !UUID.test(source.actionId) || source.actionId !== expected.requestId
    || source.providerTransactionId !== undefined && source.providerTransactionId !== null
      && (typeof source.providerTransactionId !== "string" || source.providerTransactionId.length < 1 || source.providerTransactionId.length > 256)) {
    fail("The wallet service returned an invalid operation ID.");
  }
  if (stage === "READY" && typeof source.providerTransactionId !== "string") {
    fail("The wallet service did not return a prepared transaction.");
  }
  if (action !== expected.action || amountAtomicValue !== expected.amountAtomic
    || walletAddress !== canonicalWallet(expected.walletAddress)) {
    fail("The prepared operation does not match the request for this wallet.");
  }
  if (!source.simulation || typeof source.simulation !== "object") fail("No pre-check result for the operation.");
  const simulation = source.simulation as Record<string, unknown>;
  if (typeof simulation.ok !== "boolean") fail("No pre-check result for the operation.");
  const initializationOnly = source.initializationOnly === true || simulation.initializationOnly === true;
  if (source.initializationOnly !== undefined && typeof source.initializationOnly !== "boolean"
    || simulation.initializationOnly !== undefined && typeof simulation.initializationOnly !== "boolean") {
    fail("The wallet service returned an invalid setup mode.");
  }
  if (initializationOnly && (stage !== "READY" || action !== "initialize" || amountAtomicValue !== "0")) {
    fail("Setup must be a separate operation with no token transfer.");
  }
  if (stage === "READY" && action !== "initialize" && simulation.ok !== true) {
    fail("The operation's pre-check simulation failed.");
  }
  if (stage === "READY" && action === "initialize" && simulation.ok !== true && !initializationOnly) {
    fail("A separate setup operation with no token transfer was not confirmed for the wallet.");
  }
  if (stage === "SETUP_REQUIRED" && action === "initialize") fail("Wallet setup cannot require its own setup.");
  if (action === "markets-subscribe" && expected.mint === undefined) fail("The prepared operation is for a different bond.");
  const mint = optionalMint(source.mint, action, expected.mint);
  return {
    actionId: source.actionId,
    ...(typeof source.providerTransactionId === "string" ? { providerTransactionId: source.providerTransactionId } : {}),
    action,
    amountAtomic: amountAtomicValue,
    ...(mint ? { mint } : {}),
    network: network(source.network),
    stage,
    feeMode: feeMode(source.feeMode),
    walletAddress,
    simulation: {
      ok: simulation.ok,
    ...(initializationOnly ? { initializationOnly: true as const } : {}),
    },
    ...(initializationOnly ? { initializationOnly: true as const } : {}),
  };
}

export function parseSmartWalletOperationStatus(
  value: unknown,
  expected: { actionId: string; walletAddress: string; action: SmartWalletActionKind },
): SmartWalletOperationStatus {
  const source = object(value);
  const action = actionKind(source.action);
  const walletAddress = canonicalWallet(source.walletAddress);
  if (source.actionId !== expected.actionId || !UUID.test(expected.actionId)
    || action !== expected.action
    || walletAddress !== canonicalWallet(expected.walletAddress)) {
    fail("The operation status does not match this wallet.");
  }
  if (typeof source.stage !== "string" || !STAGES.has(source.stage as SmartWalletOperationStage)) {
    fail("The wallet service returned an unknown operation status.");
  }
  if (typeof source.confirmed !== "boolean") fail("The wallet service returned an invalid confirmation status.");
  if (source.stage === "COMPLETED" && source.confirmed !== true) {
    fail("The wallet service has not confirmed the operation yet.");
  }
  if (source.signature !== undefined && (typeof source.signature !== "string" || source.signature.length < 32 || source.signature.length > 100)) {
    fail("The wallet service returned an invalid transaction signature.");
  }
  return {
    actionId: expected.actionId,
    action,
    stage: source.stage as SmartWalletOperationStage,
    confirmed: source.confirmed,
    ...(typeof source.signature === "string" ? { signature: source.signature } : {}),
    walletAddress,
    network: network(source.network),
    feeMode: feeMode(source.feeMode),
  };
}

async function postJson<T>(path: string, body: unknown, parse: (value: unknown) => T): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new KaminoSmartWalletClientError("Couldn't reach the wallet service. Check the status before retrying.");
  }
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    throw new KaminoSmartWalletClientError(
      typeof source?.error === "string" ? source.error : "The wallet service couldn't complete the request.",
    );
  }
  return parse(payload);
}

export function prepareSmartWalletOperation(
  request: { action: SmartWalletIntentKind; amountAtomic: string; requestId: string; mint?: string },
  walletAddress: string,
) {
  if (!UUID.test(request.requestId)) fail("A valid request ID is required.");
  if (request.action === "markets-subscribe") {
    const mint = canonicalWallet(request.mint);
    return postJson(`/api/bonds/${mint}/purchase`, { amountAtomic: request.amountAtomic, requestId: request.requestId, walletAddress, cluster: "devnet" }, (value) =>
      parsePreparedSmartWalletOperation(value, { ...request, mint, walletAddress }));
  }
  const { mint: _mint, ...kamino } = request;
  void _mint;
  return postJson("/api/kamino/smart-wallet/prepare", { ...kamino, walletAddress, cluster: "devnet" }, (value) =>
    parsePreparedSmartWalletOperation(value, { ...kamino, walletAddress }));
}

export function initializeSmartWallet(requestId: string, walletAddress: string, parentActionId: string) {
  if (!UUID.test(requestId)) fail("A valid request ID is required.");
  if (!UUID.test(parentActionId)) fail("A valid original operation ID is required.");
  return postJson("/api/kamino/smart-wallet/initialize", {
    requestId, parentActionId, walletAddress, cluster: "devnet",
  }, (value) => parsePreparedSmartWalletOperation(value, {
    action: "initialize", amountAtomic: "0", walletAddress, requestId,
  }));
}

export function getSmartWalletOperationStatus(
  actionId: string,
  walletAddress: string,
  action: SmartWalletActionKind,
) {
  return postJson("/api/kamino/smart-wallet/status", { actionId, walletAddress, cluster: "devnet" }, (value) =>
    parseSmartWalletOperationStatus(value, { actionId, walletAddress, action }));
}

export function smartWalletOperationStorageKey(walletAddress: string, journal: SmartWalletJournal = "kamino"): string {
  return `${journal === "markets" ? MARKETS_STORAGE_PREFIX : STORAGE_PREFIX}${canonicalWallet(walletAddress)}`;
}

export function readStoredSmartWalletOperation(walletAddress: string, journal: SmartWalletJournal = "kamino"): StoredSmartWalletOperation | null {
  if (typeof window === "undefined") return null;
  const key = smartWalletOperationStorageKey(walletAddress, journal);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const source = object(JSON.parse(raw));
    const result = {
      actionId: source.actionId,
      providerTransactionId: source.providerTransactionId,
      action: actionKind(source.action),
      amountAtomic: atomicAmount(source.amountAtomic),
      mint: source.mint,
      walletAddress: canonicalWallet(source.walletAddress),
      initializationRequestId: source.initializationRequestId,
      parentActionId: source.parentActionId,
      userStarted: source.userStarted,
      approvalRequested: source.approvalRequested,
      continuation: source.continuation,
    };
    if (typeof result.actionId !== "string" || !UUID.test(result.actionId)
      || result.providerTransactionId !== undefined
        && (typeof result.providerTransactionId !== "string" || result.providerTransactionId.length < 1 || result.providerTransactionId.length > 256)
      || result.initializationRequestId !== undefined
        && (typeof result.initializationRequestId !== "string" || !UUID.test(result.initializationRequestId))
      || result.parentActionId !== undefined
        && (typeof result.parentActionId !== "string" || !UUID.test(result.parentActionId))
      || result.action === "initialize" && typeof result.providerTransactionId !== "string"
        && typeof result.parentActionId !== "string"
      || result.walletAddress !== canonicalWallet(walletAddress)) {
      throw new Error("Invalid saved operation.");
    }
    // Each journal holds only its own product's operations.
    const intentAction = result.action === "initialize" ? (source.continuation as { action?: unknown } | undefined)?.action : result.action;
    if (intentAction !== undefined && (intentAction === "markets-subscribe") !== (journal === "markets")) throw new Error("Saved operation belongs to another journal.");
    if (result.mint !== undefined && (typeof result.mint !== "string" || result.action !== "markets-subscribe" || canonicalWallet(result.mint) !== result.mint)) {
      throw new Error("Invalid saved bond.");
    }
    if (result.action === "markets-subscribe" && result.mint === undefined) throw new Error("Invalid saved bond.");
    // New journal metadata is checked independently of the existing operation checks.
    if (result.userStarted !== undefined && typeof result.userStarted !== "boolean"
      || result.approvalRequested !== undefined && typeof result.approvalRequested !== "boolean") {
      throw new Error("Invalid saved approval intent.");
    }
    if (result.continuation !== undefined) {
      const continuation = object(result.continuation);
      if (typeof continuation.actionId !== "string" || !UUID.test(continuation.actionId)
        || (continuation.action !== "deposit" && continuation.action !== "withdraw" && continuation.action !== "markets-subscribe")
        || typeof continuation.amountAtomic !== "string" || !/^[1-9]\d*$/.test(continuation.amountAtomic)
        || (continuation.action === "markets-subscribe") !== (typeof continuation.mint === "string")
        || continuation.mint !== undefined && canonicalWallet(continuation.mint) !== continuation.mint) {
        throw new Error("Invalid saved continuation.");
      }
    }
    return result as StoredSmartWalletOperation;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function storeSmartWalletOperation(operation: StoredSmartWalletOperation, journal: SmartWalletJournal = "kamino"): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(smartWalletOperationStorageKey(operation.walletAddress, journal), JSON.stringify(operation));
}

export function clearStoredSmartWalletOperation(walletAddress: string, actionId?: string, journal: SmartWalletJournal = "kamino"): void {
  if (typeof window === "undefined") return;
  const key = smartWalletOperationStorageKey(walletAddress, journal);
  if (actionId) {
    const stored = readStoredSmartWalletOperation(walletAddress, journal);
    if (stored && stored.actionId !== actionId) return;
  }
  window.localStorage.removeItem(key);
}

export type SmartWalletChainDependencies = {
  prepare: typeof prepareSmartWalletOperation;
  initialize: typeof initializeSmartWallet;
  status: typeof getSmartWalletOperationStatus;
  store: (operation: StoredSmartWalletOperation) => void;
  clear: (walletAddress: string, actionId?: string) => void;
  newId: () => string;
  wait: (signal: AbortSignal) => Promise<void>;
};

/** One durable journal, with server status as the only authority for signing/retrying. */
export async function continueSmartWalletChain(options: {
  operation: StoredSmartWalletOperation | null;
  action: SmartWalletIntentKind;
  amountAtomic: string;
  /** Bond mint; required for markets-subscribe. */
  mint?: string;
  walletAddress: string;
  userTap: boolean;
  signal: AbortSignal;
  approve: (transactionId: string) => Promise<unknown>;
  onOperation: (operation: StoredSmartWalletOperation | null) => void;
  onProgress: (message: string) => void;
  dependencies?: SmartWalletChainDependencies;
}): Promise<SmartWalletOperationStatus | null> {
  const dependencies = options.dependencies ?? {
    prepare: prepareSmartWalletOperation,
    initialize: initializeSmartWallet,
    status: getSmartWalletOperationStatus,
    store: storeSmartWalletOperation,
    clear: clearStoredSmartWalletOperation,
    newId: () => crypto.randomUUID(),
    wait: (signal: AbortSignal) => new Promise<void>((resolve) => {
      const finish = () => { window.clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
      const timer = window.setTimeout(finish, 5_000);
      signal.addEventListener("abort", finish, { once: true });
    }),
  };
  const checkActive = () => options.signal.throwIfAborted();
  const save = (operation: StoredSmartWalletOperation) => {
    checkActive();
    dependencies.store(operation); // Always persist before a provider request or approval.
    options.onOperation(operation);
    return operation;
  };
  const fresh = (action: SmartWalletIntentKind = options.action, amountAtomic = options.amountAtomic, mint = options.mint) => save({
    actionId: dependencies.newId(), action, amountAtomic, ...(action === "markets-subscribe" && mint ? { mint } : {}),
    walletAddress: options.walletAddress, userStarted: options.userTap,
  });
  let current = options.operation;
  if (!current) {
    if (!options.userTap || !/^[1-9]\d*$/.test(options.amountAtomic)) return null;
    current = fresh();
  }
  let needsPreparation = !options.operation;
  // A retry may approve the SAME provider transaction only after a fresh READY status.
  let retryApproval = options.userTap;
  let approvalError: unknown;
  let allowFailedRetry = options.userTap && Boolean(options.operation);
  while (true) {
    checkActive();
    if (needsPreparation) options.onProgress(current.action === "initialize"
      ? "Preparing your wallet (one time)…" : "Preparing…");
    let status: SmartWalletOperationStatus | null = null;
    if (!needsPreparation) {
      try {
        status = await dependencies.status(current.actionId, current.walletAddress, current.action);
        checkActive();
      } catch (cause) {
        checkActive();
        if (cause instanceof Error && cause.message.includes("Operation was not found")) {
          dependencies.clear(current.walletAddress, current.actionId);
          options.onOperation(null);
          return null; // An unknown operation is never signed or resubmitted.
        }
        if (cause instanceof KaminoSmartWalletClientError
          && cause.message === "Couldn't reach the wallet service. Check the status before retrying.") {
          // Transport interruptions cannot justify another transaction. Keep the
          // same journal and let the single progress line report a long wait.
          await dependencies.wait(options.signal);
          continue;
        }
        throw cause;
      }
    }
    if (status?.stage === "FAILED") {
      if (!allowFailedRetry) throw new Error("FAILED: the operation did not complete.");
      allowFailedRetry = false;
      const saved = current.continuation ?? (current.action !== "initialize" ? current : null);
      // A legacy setup-only journal has no original action; fall back to what the user just tapped.
      const intent: { action: SmartWalletIntentKind; amountAtomic: string; mint?: string } | null = saved && saved.action !== "initialize" ? { action: saved.action, amountAtomic: saved.amountAtomic, mint: saved.mint }
        : options.userTap && /^[1-9]\d*$/.test(options.amountAtomic) ? { action: options.action, amountAtomic: options.amountAtomic, mint: options.mint } : null;
      if (!intent) throw new Error("Couldn't restore the original operation.");
      dependencies.clear(current.walletAddress, current.actionId);
      current = fresh(intent.action, intent.amountAtomic, intent.mint);
      needsPreparation = true;
      retryApproval = false;
      continue;
    }
    if (status?.stage === "COMPLETED" && status.confirmed && status.signature) {
      if (current.action !== "initialize") {
        dependencies.clear(current.walletAddress, current.actionId);
        options.onOperation(null);
        return status;
      }
      // Initialization retires its setup-required parent on the server. The saved
      // continuation allocates the next request once, before any network call.
      if (!current.continuation) {
        if (!options.userTap || !/^[1-9]\d*$/.test(options.amountAtomic)) return null;
        current = save({ ...current, continuation: {
          actionId: dependencies.newId(), action: options.action, amountAtomic: options.amountAtomic,
          ...(options.action === "markets-subscribe" && options.mint ? { mint: options.mint } : {}),
        } });
      }
      current = save({ ...current.continuation!, walletAddress: current.walletAddress,
        userStarted: current.userStarted || options.userTap });
      needsPreparation = true;
      retryApproval = false;
      continue;
    }
    if (status?.stage === "PENDING" && current.providerTransactionId
      || status?.stage === "COMPLETED") {
      options.onProgress(current.action === "initialize"
        ? "Preparing your wallet (one time)…" : "Confirming on-chain…");
      await dependencies.wait(options.signal);
      continue;
    }
    if (status?.stage === "SETUP_REQUIRED") {
      current = save({
        actionId: current.initializationRequestId ?? dependencies.newId(),
        action: "initialize", amountAtomic: "0", walletAddress: current.walletAddress,
        parentActionId: current.actionId, userStarted: current.userStarted || options.userTap,
        continuation: { actionId: dependencies.newId(), action: current.action as SmartWalletIntentKind,
          amountAtomic: current.amountAtomic, ...(current.mint ? { mint: current.mint } : {}) },
      });
      needsPreparation = true;
      retryApproval = false;
      continue;
    }
    if (needsPreparation || !current.providerTransactionId) {
      const prepared = current.action === "initialize"
        ? current.parentActionId
          ? await dependencies.initialize(current.actionId, current.walletAddress, current.parentActionId)
          : null
        : await dependencies.prepare({ action: current.action, amountAtomic: current.amountAtomic,
          requestId: current.actionId, ...(current.mint ? { mint: current.mint } : {}) }, current.walletAddress);
      checkActive();
      if (!prepared) throw new Error("Couldn't restore the wallet setup parameters.");
      current = save({ ...current, ...(prepared.providerTransactionId
        ? { providerTransactionId: prepared.providerTransactionId } : {}) });
      needsPreparation = false;
      if (prepared.stage === "SETUP_REQUIRED") continue;
      // The prepare response has passed all existing wallet, simulation and fee checks.
      status = { ...prepared, stage: "READY", confirmed: false };
    }
    if (status?.stage === "READY") {
      if (!current.userStarted && !options.userTap) return null;
      if (current.approvalRequested && !retryApproval) {
        throw approvalError ?? new Error("The wallet has not confirmed the operation yet.");
      }
      if (!current.providerTransactionId) throw new Error("No prepared transaction.");
      allowFailedRetry = false;
      const transactionId = current.providerTransactionId;
      current = save({ ...current, userStarted: true, approvalRequested: true });
      retryApproval = false;
      options.onProgress(current.action === "initialize"
        ? "Preparing your wallet (one time)…" : "Confirming on-chain…");
      // Never trust the wallet result as completion. Even an interrupted approval
      // is reconciled against the same persisted ID before any possible retry.
      try { await options.approve(transactionId); } catch (cause) { approvalError = cause; }
      checkActive();
      await dependencies.wait(options.signal);
    }
  }
}
