import { PublicKey } from "@solana/web3.js";

export type SmartWalletActionKind = "deposit" | "withdraw" | "initialize";
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
  walletAddress: string;
  initializationRequestId?: string;
  parentActionId?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<SmartWalletActionKind>(["deposit", "withdraw", "initialize"]);
const STAGES = new Set<SmartWalletOperationStage>(["READY", "PENDING", "SETUP_REQUIRED", "FAILED", "COMPLETED"]);
const STORAGE_PREFIX = "plain:kamino-smart-wallet-operation:v1:";

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
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Сервис кошелька вернул некорректный ответ.");
  return value as Record<string, unknown>;
}

function canonicalWallet(value: unknown): string {
  if (typeof value !== "string") fail("Сервис кошелька вернул некорректный адрес.");
  try {
    const address = new PublicKey(value).toBase58();
    if (address !== value) fail("Сервис кошелька вернул некорректный адрес.");
    return address;
  } catch {
    return fail("Сервис кошелька вернул некорректный адрес.");
  }
}

function actionKind(value: unknown): SmartWalletActionKind {
  if (typeof value !== "string" || !ACTIONS.has(value as SmartWalletActionKind)) {
    fail("Сервис кошелька вернул неизвестный тип операции.");
  }
  return value as SmartWalletActionKind;
}

function atomicAmount(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) fail("Сервис кошелька вернул некорректную сумму.");
  return value;
}

function feeMode(value: unknown): "project" {
  if (value !== "project") fail("Для операции не подтверждена оплата сетевой комиссии со стороны Plain.");
  return "project";
}

function network(value: unknown): "devnet" {
  if (value !== "devnet") fail("Операция не ограничена сетью Solana Devnet.");
  return "devnet";
}

export function parsePreparedSmartWalletOperation(
  value: unknown,
  expected: { walletAddress: string; action: SmartWalletActionKind; amountAtomic: string; requestId: string },
): PreparedSmartWalletOperation {
  const source = object(value);
  const action = actionKind(source.action);
  const amountAtomicValue = atomicAmount(source.amountAtomic);
  const walletAddress = canonicalWallet(source.walletAddress);
  const stage = source.stage;
  if (stage !== "READY" && stage !== "SETUP_REQUIRED") fail("Сервис кошелька вернул неизвестный статус подготовки.");
  if (typeof source.actionId !== "string" || !UUID.test(source.actionId) || source.actionId !== expected.requestId
    || source.providerTransactionId !== undefined && source.providerTransactionId !== null
      && (typeof source.providerTransactionId !== "string" || source.providerTransactionId.length < 1 || source.providerTransactionId.length > 256)) {
    fail("Сервис кошелька вернул некорректный идентификатор операции.");
  }
  if (stage === "READY" && typeof source.providerTransactionId !== "string") {
    fail("Сервис кошелька не вернул подготовленную транзакцию.");
  }
  if (action !== expected.action || amountAtomicValue !== expected.amountAtomic
    || walletAddress !== canonicalWallet(expected.walletAddress)) {
    fail("Подготовленная операция не совпадает с запросом для этого кошелька.");
  }
  if (!source.simulation || typeof source.simulation !== "object") fail("Нет результата предварительной проверки операции.");
  const simulation = source.simulation as Record<string, unknown>;
  if (typeof simulation.ok !== "boolean") fail("Нет результата предварительной проверки операции.");
  const initializationOnly = source.initializationOnly === true || simulation.initializationOnly === true;
  if (source.initializationOnly !== undefined && typeof source.initializationOnly !== "boolean"
    || simulation.initializationOnly !== undefined && typeof simulation.initializationOnly !== "boolean") {
    fail("Сервис кошелька вернул некорректный режим инициализации.");
  }
  if (initializationOnly && (stage !== "READY" || action !== "initialize" || amountAtomicValue !== "0")) {
    fail("Инициализация должна быть отдельной операцией без перевода токенов.");
  }
  if (stage === "READY" && action !== "initialize" && simulation.ok !== true) {
    fail("Предварительная симуляция операции не прошла.");
  }
  if (stage === "READY" && action === "initialize" && simulation.ok !== true && !initializationOnly) {
    fail("Для настройки кошелька не подтверждена отдельная операция без перевода токенов.");
  }
  if (stage === "SETUP_REQUIRED" && action === "initialize") fail("Инициализация кошелька не может требовать собственной настройки.");
  return {
    actionId: source.actionId,
    ...(typeof source.providerTransactionId === "string" ? { providerTransactionId: source.providerTransactionId } : {}),
    action,
    amountAtomic: amountAtomicValue,
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
    fail("Статус операции не совпадает с этим кошельком.");
  }
  if (typeof source.stage !== "string" || !STAGES.has(source.stage as SmartWalletOperationStage)) {
    fail("Сервис кошелька вернул неизвестный статус операции.");
  }
  if (typeof source.confirmed !== "boolean") fail("Сервис кошелька вернул некорректный статус подтверждения.");
  if (source.stage === "COMPLETED" && source.confirmed !== true) {
    fail("Сервис кошелька ещё не подтвердил операцию.");
  }
  if (source.signature !== undefined && (typeof source.signature !== "string" || source.signature.length < 32 || source.signature.length > 100)) {
    fail("Сервис кошелька вернул некорректную подпись транзакции.");
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
    throw new KaminoSmartWalletClientError("Не удалось связаться с сервисом кошелька. Проверьте статус перед повтором.");
  }
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    throw new KaminoSmartWalletClientError(
      typeof source?.error === "string" ? source.error : "Сервис кошелька не смог выполнить запрос.",
    );
  }
  return parse(payload);
}

export function prepareSmartWalletOperation(
  request: { action: "deposit" | "withdraw"; amountAtomic: string; requestId: string },
  walletAddress: string,
) {
  if (!UUID.test(request.requestId)) fail("Нужен корректный идентификатор запроса.");
  return postJson("/api/kamino/smart-wallet/prepare", { ...request, walletAddress, cluster: "devnet" }, (value) =>
    parsePreparedSmartWalletOperation(value, { ...request, walletAddress }));
}

export function initializeSmartWallet(requestId: string, walletAddress: string, parentActionId: string) {
  if (!UUID.test(requestId)) fail("Нужен корректный идентификатор запроса.");
  if (!UUID.test(parentActionId)) fail("Нужен корректный идентификатор исходной операции.");
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

export function smartWalletOperationStorageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}${canonicalWallet(walletAddress)}`;
}

export function readStoredSmartWalletOperation(walletAddress: string): StoredSmartWalletOperation | null {
  if (typeof window === "undefined") return null;
  const key = smartWalletOperationStorageKey(walletAddress);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const source = object(JSON.parse(raw));
    const result = {
      actionId: source.actionId,
      providerTransactionId: source.providerTransactionId,
      action: actionKind(source.action),
      amountAtomic: atomicAmount(source.amountAtomic),
      walletAddress: canonicalWallet(source.walletAddress),
      initializationRequestId: source.initializationRequestId,
      parentActionId: source.parentActionId,
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
    return result as StoredSmartWalletOperation;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function storeSmartWalletOperation(operation: StoredSmartWalletOperation): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(smartWalletOperationStorageKey(operation.walletAddress), JSON.stringify(operation));
}

export function clearStoredSmartWalletOperation(walletAddress: string, actionId?: string): void {
  if (typeof window === "undefined") return;
  const key = smartWalletOperationStorageKey(walletAddress);
  if (actionId) {
    const stored = readStoredSmartWalletOperation(walletAddress);
    if (stored && stored.actionId !== actionId) return;
  }
  window.localStorage.removeItem(key);
}
