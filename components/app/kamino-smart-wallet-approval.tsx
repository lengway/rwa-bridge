"use client";

import { useCallback, useEffect, useState } from "react";
import type { Chain, Wallet } from "@crossmint/wallets-sdk";
import { Check, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAtomicToDecimal } from "@/lib/earn-gateway";
import {
  clearStoredSmartWalletOperation,
  getSmartWalletOperationStatus,
  initializeSmartWallet,
  KaminoSmartWalletClientError,
  prepareSmartWalletOperation,
  readStoredSmartWalletOperation,
  storeSmartWalletOperation,
  type PreparedSmartWalletOperation,
  type SmartWalletActionKind,
  type SmartWalletOperationStatus,
  type StoredSmartWalletOperation,
} from "@/lib/kamino-smart-wallet-client";

export type KaminoSmartWalletApprovalProps = {
  action: "deposit" | "withdraw";
  amountAtomic: string;
  wallet: Wallet<Chain> | null;
  walletAddress: string | null;
  onCompleted?: (status: SmartWalletOperationStatus) => void;
};

function isCanonicalAmount(value: string) {
  return /^[1-9]\d*$/.test(value);
}

function amountLabel(amountAtomic: string) {
  try {
    return `${formatAtomicToDecimal(BigInt(amountAtomic), 6)} USDC`;
  } catch {
    return "USDC";
  }
}

function actionLabel(action: SmartWalletActionKind) {
  if (action === "initialize") return "Настройка смарт-кошелька";
  return action === "deposit" ? "Депозит в Kamino" : "Вывод из Kamino";
}

function statusLabel(status: SmartWalletOperationStatus["stage"] | null) {
  if (status === "READY") return "Ожидает подтверждения";
  if (status === "PENDING") return "В обработке";
  if (status === "SETUP_REQUIRED") return "Нужна настройка кошелька";
  if (status === "FAILED") return "Не выполнено";
  if (status === "COMPLETED") return "Подтверждено";
  return "Проверяем…";
}

function friendlyError(error: unknown) {
  return error instanceof KaminoSmartWalletClientError
    ? error.message
    : "Не удалось проверить операцию. Сначала проверьте её статус.";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

// A saved operation the server no longer knows (e.g. it was rejected before it was stored)
// must not block new actions: drop it locally and start fresh.
function isMissingOperation(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes("Operation was not found");
}

export function KaminoSmartWalletApproval({
  action,
  amountAtomic,
  wallet,
  walletAddress,
  onCompleted,
}: KaminoSmartWalletApprovalProps) {
  const [operation, setOperation] = useState<StoredSmartWalletOperation | null>(null);
  const [operationStatus, setOperationStatus] = useState<SmartWalletOperationStatus | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [completed, setCompleted] = useState<SmartWalletOperationStatus | null>(null);

  const walletMatchesSession = Boolean(wallet && walletAddress && wallet.address === walletAddress);

  const applyStatus = useCallback((
    current: StoredSmartWalletOperation,
    status: SmartWalletOperationStatus,
  ) => {
    setOperationStatus(status);
    if (status.stage === "COMPLETED" && status.confirmed && status.signature) {
      clearStoredSmartWalletOperation(current.walletAddress, current.actionId);
      setOperation(null);
      setCompleted(status);
      setNotice(null);
      onCompleted?.(status);
    } else if (status.stage === "COMPLETED" && !status.signature) {
      setNotice("The service has not returned a confirmed transaction signature yet. Check status again.");
    } else if (status.stage === "PENDING") {
      setNotice("The operation is still processing. You can check again shortly.");
    } else if (status.stage === "FAILED") {
      setNotice("The operation failed. Review its status before starting another one.");
    } else {
      setNotice(null);
    }
  }, [onCompleted]);

  const refreshStatus = useCallback(async (current = operation) => {
    if (!current || !walletAddress || !walletMatchesSession) return null;
    setCheckingStatus(true);
    setError(null);
    try {
      const status = await getSmartWalletOperationStatus(current.actionId, walletAddress, current.action);
      applyStatus(current, status);
      return status;
    } catch (statusError) {
      if (isMissingOperation(statusError)) {
        clearStoredSmartWalletOperation(current.walletAddress, current.actionId);
        setOperation(null);
        return null;
      }
      setError(friendlyError(statusError));
      return null;
    } finally {
      setCheckingStatus(false);
    }
  }, [applyStatus, operation, walletAddress, walletMatchesSession]);

  useEffect(() => {
    if (!walletMatchesSession || !walletAddress) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setError(null);
      setNotice(null);
      setCompleted(null);
      setOperationStatus(null);
      setSetupRequired(false);
      let stored: StoredSmartWalletOperation | null = null;
      try {
        stored = readStoredSmartWalletOperation(walletAddress);
      } catch {
      setError("Не удалось прочитать сохранённую операцию. Подтверждение не запрашивалось.");
      }
      setOperation(stored);
      if (!stored) return;
      void getSmartWalletOperationStatus(stored.actionId, walletAddress, stored.action)
        .then((status) => {
          if (!cancelled) applyStatus(stored!, status);
        })
        .catch((statusError: unknown) => {
          if (cancelled) return;
          if (isMissingOperation(statusError)) {
            clearStoredSmartWalletOperation(walletAddress, stored!.actionId);
            setOperation(null);
            return;
          }
          setError(friendlyError(statusError));
        });
    });
    return () => { cancelled = true; };
  }, [applyStatus, walletAddress, walletMatchesSession]);

  const savePreparedOperation = (prepared: PreparedSmartWalletOperation, parentActionId?: string) => {
    if (!prepared.providerTransactionId) throw new Error("Сервис не вернул подготовленную транзакцию для подтверждения.");
    const stored: StoredSmartWalletOperation = {
      actionId: prepared.actionId,
      providerTransactionId: prepared.providerTransactionId,
      action: prepared.action,
      amountAtomic: prepared.amountAtomic,
      walletAddress: prepared.walletAddress,
      ...(parentActionId ? { parentActionId } : {}),
    };
    // Persist before rendering the approval control or invoking the wallet.
    storeSmartWalletOperation(stored);
    setOperation(stored);
    setOperationStatus({
      actionId: stored.actionId,
      action: stored.action,
      stage: "READY",
      confirmed: false,
      walletAddress: stored.walletAddress,
      network: "devnet",
      feeMode: "project",
    });
    setCompleted(null);
    setNotice(null);
    return stored;
  };

  const prepare = async () => {
    if (!walletMatchesSession || !walletAddress || !isCanonicalAmount(amountAtomic) || operation || preparing) return;
    setPreparing(true);
    setError(null);
    setNotice(null);
    setCompleted(null);
    try {
      const requestId = crypto.randomUUID();
      const pending: StoredSmartWalletOperation = { actionId: requestId, action, amountAtomic, walletAddress };
      storeSmartWalletOperation(pending);
      setOperation(pending);
      setOperationStatus({
        actionId: requestId, action, stage: "PENDING", confirmed: false,
        walletAddress, network: "devnet", feeMode: "project",
      });
      const prepared = await prepareSmartWalletOperation({
        action,
        amountAtomic,
        requestId,
      }, walletAddress);
      if (prepared.stage === "SETUP_REQUIRED") {
        const setupOperation: StoredSmartWalletOperation = {
          actionId: prepared.actionId,
          ...(prepared.providerTransactionId ? { providerTransactionId: prepared.providerTransactionId } : {}),
          action: prepared.action,
          amountAtomic: prepared.amountAtomic,
          walletAddress: prepared.walletAddress,
        };
        storeSmartWalletOperation(setupOperation);
        setOperation(setupOperation);
        setOperationStatus({
          actionId: setupOperation.actionId,
          action: setupOperation.action,
          stage: "SETUP_REQUIRED",
          confirmed: false,
          walletAddress: setupOperation.walletAddress,
          network: "devnet",
          feeMode: "project",
        });
        setSetupRequired(true);
      setNotice("Перед работой с Kamino нужно отдельно настроить смарт-кошелёк.");
        return;
      }
      setSetupRequired(false);
      if (!prepared.providerTransactionId) throw new Error("Сервис не вернул подготовленную транзакцию.");
      savePreparedOperation(prepared);
    } catch (prepareError) {
      setError(friendlyError(prepareError));
    } finally {
      setPreparing(false);
    }
  };

  const prepareInitialization = async () => {
    if (!walletMatchesSession || !walletAddress || !operation || operation.action === "initialize"
      || operationStatus?.stage !== "SETUP_REQUIRED" || preparing) return;
    setPreparing(true);
    setError(null);
    setNotice(null);
    try {
      const requestId = operation.initializationRequestId ?? crypto.randomUUID();
      const parentActionId = operation.actionId;
      const withRequestId: StoredSmartWalletOperation = {
        actionId: requestId,
        action: "initialize",
        amountAtomic: "0",
        walletAddress,
        parentActionId,
      };
      // Reuse the same idempotency key if the network times out and the user retries.
      storeSmartWalletOperation(withRequestId);
      setOperation(withRequestId);
      setOperationStatus({
        actionId: requestId, action: "initialize", stage: "PENDING", confirmed: false,
        walletAddress, network: "devnet", feeMode: "project",
      });
      const prepared = await initializeSmartWallet(requestId, walletAddress, parentActionId);
      if (!prepared.providerTransactionId) throw new Error("Сервис не вернул подготовленную транзакцию настройки.");
      savePreparedOperation(prepared, parentActionId);
      setSetupRequired(false);
    } catch (prepareError) {
      setError(friendlyError(prepareError));
    } finally {
      setPreparing(false);
    }
  };

  const recoverPreparation = async () => {
    if (!operation || !walletMatchesSession || !walletAddress || operation.providerTransactionId || preparing) return;
    setPreparing(true);
    setError(null);
    setNotice("Проверяем сохранённый запрос подготовки…");
    try {
      const prepared = operation.action === "initialize"
        ? operation.parentActionId
          ? await initializeSmartWallet(operation.actionId, walletAddress, operation.parentActionId)
          : null
        : await prepareSmartWalletOperation({
          action: operation.action,
          amountAtomic: operation.amountAtomic,
          requestId: operation.actionId,
        }, walletAddress);
      if (!prepared) throw new Error("Не удалось восстановить параметры настройки кошелька.");
      if (prepared.stage === "SETUP_REQUIRED") {
        const setupOperation: StoredSmartWalletOperation = {
          actionId: prepared.actionId,
          ...(prepared.providerTransactionId ? { providerTransactionId: prepared.providerTransactionId } : {}),
          action: prepared.action,
          amountAtomic: prepared.amountAtomic,
          walletAddress: prepared.walletAddress,
        };
        storeSmartWalletOperation(setupOperation);
        setOperation(setupOperation);
        setOperationStatus({
          actionId: setupOperation.actionId, action: setupOperation.action, stage: "SETUP_REQUIRED",
          confirmed: false, walletAddress: setupOperation.walletAddress, network: "devnet", feeMode: "project",
        });
        setNotice("Перед работой с Kamino нужно отдельно настроить смарт-кошелёк.");
      } else {
        if (!prepared.providerTransactionId) throw new Error("Сервис не вернул подготовленную транзакцию.");
        savePreparedOperation(prepared, operation.parentActionId);
      }
    } catch (recoveryError) {
      setError(friendlyError(recoveryError));
      setNotice("Используйте эту же операцию для восстановления. Новый запрос не создан.");
    } finally {
      setPreparing(false);
    }
  };

  const approve = async () => {
    if (!operation || !walletMatchesSession || !wallet || !operationStatus
      || operationStatus.stage !== "READY" || !operation.providerTransactionId || approving || checkingStatus) return;
    setApproving(true);
    setError(null);
    setNotice("Ожидаем ответ кошелька и проверяем статус операции…");
    try {
      // The user must click this control after reviewing the operation summary.
      // The returned wallet result is deliberately ignored; server status is authoritative.
      await wallet.approve({ transactionId: operation.providerTransactionId });
    } catch {
      setNotice("Ответ кошелька прервался. Сначала проверяем статус операции…");
    }

    try {
      let status: SmartWalletOperationStatus | null = null;
      for (let attempt = 0; attempt < 7; attempt += 1) {
        status = await getSmartWalletOperationStatus(operation.actionId, walletAddress!, operation.action);
        applyStatus(operation, status);
        if (status.stage !== "PENDING") break;
        await wait(1_500);
      }
      if (status?.stage === "READY") {
        setNotice("Операция ожидает подтверждения кошельком. Проверьте её перед повторным подтверждением.");
      } else if (status?.stage === "PENDING") {
        setNotice("Операция ещё обрабатывается. Проверьте статус перед запуском новой операции.");
      }
    } catch (statusError) {
      setError(friendlyError(statusError));
      setNotice("Подтверждение могло поступить в сервис кошелька. Проверьте операцию перед повтором.");
    } finally {
      setApproving(false);
      setCheckingStatus(false);
    }
  };

  const dismissFailed = () => {
    if (!operation || operationStatus?.stage !== "FAILED") return;
    clearStoredSmartWalletOperation(operation.walletAddress, operation.actionId);
    setOperation(null);
    setOperationStatus(null);
    setNotice(null);
    setError(null);
  };

  const clearCompleted = () => setCompleted(null);
  const activeOperation = operation;
  const activeAction = activeOperation?.action ?? action;
  const activeAmount = activeOperation?.amountAtomic ?? amountAtomic;
  const canPrepare = walletMatchesSession && isCanonicalAmount(amountAtomic) && !activeOperation && !preparing;
  const canApprove = Boolean(activeOperation && walletMatchesSession && wallet
    && activeOperation.providerTransactionId && operationStatus?.stage === "READY" && !approving && !checkingStatus);

  if (!walletMatchesSession) {
    return (
      <Card className="gap-3 rounded-2xl p-4">
        <p className="font-medium">Подключите кошелёк этого аккаунта</p>
        <p className="text-sm leading-6 text-muted-foreground">Операция доступна, когда подключённый кошелёк совпадает с аккаунтом.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {completed ? (
        <Card className="gap-3 rounded-2xl p-4">
          <div className="flex items-center gap-2 font-medium"><Check className="size-4" />Подтверждено в Solana Devnet</div>
          <p className="text-sm leading-6 text-muted-foreground">
            {actionLabel(completed.action)} завершён. Статус проверен в сети.
          </p>
          <Button variant="outline" onClick={clearCompleted}>Продолжить</Button>
        </Card>
      ) : activeOperation ? (
        <Card className="gap-4 rounded-2xl p-4">
          <div>
            <p className="font-medium">Проверьте операцию</p>
            <p className="mt-1 text-sm text-muted-foreground">{actionLabel(activeAction)}</p>
          </div>
          <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
            <Row label="Сумма" value={activeAction === "initialize" ? "Без перевода токенов" : amountLabel(activeAmount)} />
            <Row label="Маршрут" value={activeAction === "initialize" ? "Настройка кошелька" : "Kamino · Solana Devnet"} />
            <Row label="Комиссия сети" value="Оплачивает Plain" />
            <Row label="Статус" value={statusLabel(operationStatus?.stage ?? null)} />
          </div>
          {activeAction === "initialize" ? (
            <p className="text-xs leading-5 text-muted-foreground">
              Настройка кошелька — отдельная операция. Она не переводит USDC в Kamino и не выводит его.
            </p>
          ) : null}
          {operationStatus?.stage === "PENDING" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" />Ждём подтверждения…</p>
          ) : null}
          {operationStatus?.stage === "SETUP_REQUIRED" && activeAction !== "initialize" ? (
            <div className="space-y-3 rounded-xl border p-3">
              <p className="text-sm leading-5">Сначала настройте смарт-кошелёк. Депозит не будет отправлен автоматически.</p>
              <Button className="w-full" onClick={prepareInitialization} disabled={preparing}>
                {preparing ? "Готовим настройку…" : "Проверить настройку кошелька"}
              </Button>
            </div>
          ) : null}
          {notice ? <p className="text-sm leading-5 text-muted-foreground">{notice}</p> : null}
          {error ? <p className="text-sm leading-5 text-destructive">{error}</p> : null}
          <div className="flex flex-col gap-2">
            {!activeOperation.providerTransactionId && operationStatus?.stage !== "SETUP_REQUIRED" ? (
              <Button variant="outline" className="w-full" onClick={recoverPreparation} disabled={preparing || approving}>
                <RefreshCw />{preparing ? "Проверяем…" : "Восстановить подготовку"}
              </Button>
            ) : null}
            {operationStatus?.stage === "READY" ? (
              <Button className="w-full" onClick={approve} disabled={!canApprove}>
                <ShieldCheck />{approving ? "Ожидаем кошелёк…" : activeAction === "initialize" ? "Подтвердить настройку" : "Подтвердить кошельком"}
              </Button>
            ) : null}
            {operationStatus?.stage === "PENDING" || operationStatus === null || Boolean(error) ? (
              <Button variant="outline" className="w-full" onClick={() => void refreshStatus()} disabled={checkingStatus || approving}>
                <RefreshCw />{checkingStatus ? "Проверяем…" : "Проверить статус"}
              </Button>
            ) : null}
            {operationStatus?.stage === "FAILED" ? (
              <Button variant="outline" className="w-full" onClick={dismissFailed}>Закрыть неудачную операцию</Button>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card className="gap-4 rounded-2xl p-4">
          <div>
            <p className="font-medium">Kamino · Solana Devnet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {action === "deposit" ? "Депозит" : "Вывод"} {amountLabel(amountAtomic)}. Комиссию сети оплачивает Plain.
            </p>
          </div>
          {setupRequired ? (
            <div className="space-y-3 rounded-xl border p-3">
              <p className="text-sm leading-5">Перед работой с Kamino нужно настроить кошелёк. Эта отдельная операция не переводит USDC.</p>
              <Button className="w-full" onClick={prepareInitialization} disabled={preparing}>
                {preparing ? "Готовим настройку…" : "Проверить настройку кошелька"}
              </Button>
            </div>
          ) : (
            <Button className="w-full" onClick={prepare} disabled={!canPrepare}>
              {preparing ? "Готовим операцию…" : action === "deposit" ? "Проверить депозит" : "Проверить вывод"}
            </Button>
          )}
          {notice ? <p className="text-sm leading-5 text-muted-foreground">{notice}</p> : null}
          {error ? <p className="text-sm leading-5 text-destructive">{error}</p> : null}
          <p className="text-xs leading-5 text-muted-foreground">
            Перед запросом подтверждения кошельку вы увидите детали операции.
          </p>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
