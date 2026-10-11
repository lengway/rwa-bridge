"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SolanaWallet } from "@crossmint/wallets-sdk";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import {
  type KaminoLendAction,
  type KaminoLendConfirmation,
  type KaminoLendMarket,
  type PreparedKaminoLendAction,
  decimalToAtomic,
  formatAtomicAmount,
  normalizeKaminoLendConfirmation,
  normalizeKaminoLendMarket,
  normalizePreparedKaminoLendAction,
  preparedActionMatchesMarket,
  readKaminoApiError,
} from "@/components/app/kamino-lend-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  kaminoPendingActionStorageKey,
  validateKaminoPendingAction,
  type KaminoPendingAction,
} from "@/lib/kamino-pending-action";
import { useAuth } from "@/lib/useAuth";
import { useDevnet } from "@/lib/useDevnet";

export type KaminoLendDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAction?: KaminoLendAction;
  /** Called only after the server verifies finalized Devnet completion. */
  onConfirmed?: (confirmation: KaminoLendConfirmation) => void;
};

type BusyState = "loading" | "preparing" | "signing" | "confirming" | null;

/**
 * Self-contained client UI for a server-built Kamino Lend Devnet transaction.
 * It does not build, sign, or submit an instruction itself: the API creates
 * and simulates the serialized transaction, and the wallet owns signature.
 */
export function KaminoLendDrawer({
  open,
  onOpenChange,
  initialAction = "deposit",
  onConfirmed,
}: KaminoLendDrawerProps) {
  const { wallet, walletAddress } = useAuth();
  const devnet = useDevnet();
  const [market, setMarket] = useState<KaminoLendMarket | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [action, setAction] = useState<KaminoLendAction>(initialAction);
  const [amount, setAmount] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [prepared, setPrepared] = useState<PreparedKaminoLendAction | null>(null);
  const [pendingAction, setPendingAction] = useState<KaminoPendingAction | null>(null);
  const [recoveryWallet, setRecoveryWallet] = useState<string | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<"loading" | "ready" | "blocked" | "unavailable">("loading");
  const [recoveryIssue, setRecoveryIssue] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<KaminoLendConfirmation | null>(null);
  const [confirmedAmountAtomic, setConfirmedAmountAtomic] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeWalletAddress = walletAddress ?? devnet.walletAddress;
  const reserve = market?.ready ? market.reserve : null;
  const amountAtomic = useMemo(
    () => reserve ? decimalToAtomic(amount, reserve.decimals) : null,
    [amount, reserve],
  );
  const exceedsMaximum = Boolean(amountAtomic && reserve?.maximumAmountAtomic
    && BigInt(amountAtomic) > BigInt(reserve.maximumAmountAtomic));
  const marketReady = market?.ready === true && market.market !== null && reserve !== null;
  const recoveryReady = recoveryWallet === activeWalletAddress && recoveryStatus === "ready";
  const recoveryBlocked = recoveryWallet === activeWalletAddress && recoveryStatus === "blocked";
  const currentPendingAction = pendingAction?.walletAddress === activeWalletAddress ? pendingAction : null;
  const actionLabel = action === "deposit" ? "Пополнить резерв" : "Вывести из резерва";
  const inputLabel = action === "deposit" ? "Сумма для пополнения" : "Сумма для вывода";
  const canPrepare = marketReady
    && Boolean(wallet)
    && Boolean(activeWalletAddress)
    && Boolean(amountAtomic)
    && !exceedsMaximum
    && accepted
    && !prepared
    && recoveryReady
    && !currentPendingAction
    && !busy;

  const resetPreparedAction = useCallback(() => {
    setPrepared(null);
    setConfirmation(null);
    setConfirmedAmountAtomic(null);
    setNotice(null);
    setError(null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRecoveryWallet(null);
      setRecoveryStatus("loading");
      setRecoveryIssue(null);
      setPendingAction(null);
      setPrepared(null);
      setConfirmation(null);
      setConfirmedAmountAtomic(null);

      if (!activeWalletAddress) {
        setRecoveryWallet(null);
        setRecoveryStatus("ready");
        return;
      }

      try {
        const stored = window.localStorage.getItem(kaminoPendingActionStorageKey(activeWalletAddress));
        if (stored === null) {
          setRecoveryWallet(activeWalletAddress);
          setRecoveryStatus("ready");
          return;
        }

        let value: unknown;
        try {
          value = JSON.parse(stored);
        } catch {
          setRecoveryIssue("Сохранённые данные восстановления повреждены. Перед новой операцией подтвердите очистку с предупреждением.");
          setRecoveryWallet(activeWalletAddress);
          setRecoveryStatus("blocked");
          return;
        }

        const result = validateKaminoPendingAction(value, activeWalletAddress);
        if (result.kind === "valid") {
          setPendingAction(result.pending);
          setAction(result.pending.action);
          setAmount("");
          setAccepted(true);
          setRecoveryWallet(activeWalletAddress);
          setRecoveryStatus("ready");
        } else if (result.kind === "empty") {
          setRecoveryWallet(activeWalletAddress);
          setRecoveryStatus("ready");
        } else {
          setRecoveryIssue(result.kind === "wallet-mismatch"
            ? "Сохранённое действие принадлежит другому кошельку и не будет восстановлено. Подтвердите очистку перед новой операцией."
            : "Сохранённые данные восстановления некорректны. Подтвердите очистку перед новой операцией.");
          setRecoveryWallet(activeWalletAddress);
          setRecoveryStatus("blocked");
        }
      } catch {
        setRecoveryIssue("Не удалось прочитать localStorage. Восстановление недоступно; операции подписи заблокированы.");
        setRecoveryWallet(activeWalletAddress);
        setRecoveryStatus("unavailable");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeWalletAddress]);

  const loadMarket = useCallback(async (signal?: AbortSignal) => {
    setBusy("loading");
    setError(null);
    try {
      // Route readiness is public and must not depend on an optional balance
      // lookup for the connected wallet. In particular, the Crossmint-wallet
      // link can still be settling immediately after sign-in; coupling it to
      // this read made a healthy Kamino route appear unavailable. Wallet-bound
      // authorization remains enforced by the prepare/confirm endpoints.
      const response = await fetch("/api/kamino/market", { cache: "no-store", signal });
      const payload = await response.json().catch(() => null);
      const nextMarket = normalizeKaminoLendMarket(payload);
      if (signal?.aborted) return;
      if (!nextMarket) throw new KaminoDrawerError("Маршрут Kamino Lend вернул неполные технические данные.", response.status);
      if (!response.ok && nextMarket.ready) throw new KaminoDrawerError(readKaminoApiError(payload, "Не удалось проверить маршрут Kamino Lend."), response.status);
      setMarket(nextMarket);
      if (!nextMarket.ready) setNotice(nextMarket.reason ?? "Маршрут Kamino Lend временно недоступен.");
    } catch (requestError) {
      if (isAbortError(requestError)) return;
      setMarket(null);
      setError(userFacingError(requestError, "Не удалось загрузить состояние Kamino Lend."));
    } finally {
      if (!signal?.aborted) setBusy((current) => current === "loading" ? null : current);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadMarket(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadMarket, open]);

  const confirmSubmittedAction = useCallback(async (
    actionToConfirm: Pick<KaminoPendingAction, "action" | "actionId" | "amountAtomic"> & { signature: string },
    actionWalletAddress: string,
  ) => {
    setBusy("confirming");
    setError(null);
    try {
      const response = await fetch(`/api/kamino/${actionToConfirm.action}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: actionToConfirm.actionId,
          walletAddress: actionWalletAddress,
          signature: actionToConfirm.signature,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (response.status === 202) {
        setNotice("Транзакция отправлена в Solana Devnet. Подтверждение ещё обрабатывается — повторите проверку через несколько секунд.");
        return;
      }
      if (!response.ok) {
        if (isVerifiedTransactionFailure(payload)) {
          try {
            window.localStorage.removeItem(kaminoPendingActionStorageKey(actionWalletAddress));
            if (activeWalletAddress === actionWalletAddress) {
              setPendingAction(null);
              setRecoveryStatus("ready");
              setRecoveryIssue(null);
              setPrepared(null);
            }
            setNotice(null);
            setError("Сервер подтвердил, что транзакция завершилась ошибкой в Devnet. Можно подготовить новую операцию.");
          } catch {
            setRecoveryIssue("Транзакция завершилась ошибкой, но localStorage не удалось очистить. Повторите проверку или перезагрузите страницу перед новой операцией.");
            setError("Транзакция завершилась ошибкой; не удалось очистить локальные данные восстановления.");
          }
          return;
        }
        throw new KaminoDrawerError(readKaminoApiError(payload, "Не удалось подтвердить транзакцию в Kamino Lend."), response.status);
      }

      const nextConfirmation = normalizeKaminoLendConfirmation(
        payload,
        actionToConfirm.action,
        actionToConfirm.actionId,
        actionToConfirm.signature,
      );
      if (!nextConfirmation) {
        throw new KaminoDrawerError("Сервер ещё не подтвердил завершение транзакции. Повторите проверку, не создавая новую операцию.", 502);
      }

      let recoveryCleared = true;
      try {
        window.localStorage.removeItem(kaminoPendingActionStorageKey(actionWalletAddress));
      } catch {
        recoveryCleared = false;
        if (activeWalletAddress === actionWalletAddress) {
          setRecoveryIssue("Операция подтверждена, но localStorage не удалось очистить. Не отправляйте новую операцию до проверки восстановления.");
        }
      }
      if (activeWalletAddress === actionWalletAddress) {
        setConfirmation(nextConfirmation);
        setConfirmedAmountAtomic(actionToConfirm.amountAtomic);
        setNotice(null);
        if (recoveryCleared) {
          setPendingAction(null);
          setRecoveryStatus("ready");
          setRecoveryIssue(null);
        }
      }
      void devnet.refreshPortfolio();
      void loadMarket();
      onConfirmed?.(nextConfirmation);
      toast.success(actionToConfirm.action === "deposit"
        ? "Пополнение Kamino Lend подтверждено в Solana Devnet"
        : "Вывод из Kamino Lend подтверждён в Solana Devnet");
    } catch (requestError) {
      setError(userFacingError(requestError, "Не удалось подтвердить транзакцию. Повторите только проверку подтверждения."));
    } finally {
      setBusy(null);
    }
  }, [activeWalletAddress, devnet, loadMarket, onConfirmed]);

  const prepareAction = async () => {
    if (!marketReady || !amountAtomic || !activeWalletAddress || !wallet || !accepted || exceedsMaximum || busy
      || !recoveryReady || currentPendingAction || recoveryBlocked) return;
    setBusy("preparing");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/kamino/${action}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: activeWalletAddress, amountAtomic, cluster: "devnet" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new KaminoDrawerError(readKaminoApiError(payload, "Не удалось подготовить транзакцию Kamino Lend."), response.status);
      const nextPrepared = normalizePreparedKaminoLendAction(payload, action);
      if (!nextPrepared || !preparedActionMatchesMarket(nextPrepared, market, amountAtomic)) {
        throw new KaminoDrawerError("Сервер вернул транзакцию, которая не совпадает с выбранным Devnet-маршрутом.", 502);
      }
      setPrepared(nextPrepared);
      setNotice("Серверная симуляция пройдена. Проверьте детали операции перед подписью в кошельке.");
    } catch (requestError) {
      setError(userFacingError(requestError, "Не удалось подготовить операцию Kamino Lend."));
    } finally {
      setBusy(null);
    }
  };

  const signAndSendPreparedAction = async () => {
    if (!prepared || !wallet || !activeWalletAddress || busy || !recoveryReady || currentPendingAction) return;
    if (prepared.expiresAt <= Date.now()) {
      setPrepared(null);
      setNotice(null);
      setError("Срок подготовки истёк. Подготовьте свежую транзакцию; эта транзакция не отправлялась.");
      return;
    }
    const actionWalletAddress = activeWalletAddress;
    const awaitingSignature: KaminoPendingAction = {
      stage: "awaiting-signature",
      actionId: prepared.actionId,
      action: prepared.action,
      walletAddress: actionWalletAddress,
      amountAtomic: prepared.amountAtomic,
    };
    try {
      // Re-read before signing: another tab may have started an operation
      // after this drawer's initial recovery check. Never overwrite its record.
      const stored = window.localStorage.getItem(kaminoPendingActionStorageKey(actionWalletAddress));
      if (stored !== null) {
        const recovered = validateKaminoPendingAction(JSON.parse(stored), actionWalletAddress);
        if (recovered.kind === "valid") setPendingAction(recovered.pending);
        else setRecoveryStatus("blocked");
        setRecoveryIssue("Другая вкладка сохранила операцию. Проверьте её статус перед новой отправкой.");
        setPrepared(null);
        return;
      }
      window.localStorage.setItem(
        kaminoPendingActionStorageKey(actionWalletAddress),
        JSON.stringify(awaitingSignature),
      );
    } catch {
      setRecoveryIssue("Не удалось сохранить данные восстановления в localStorage. Подпись и отправка заблокированы.");
      setRecoveryStatus("unavailable");
      setError("Сначала включите доступ к локальному хранилищу; транзакция не отправлялась.");
      return;
    }
    setPendingAction(awaitingSignature);
    setRecoveryIssue(null);
    setBusy("signing");
    setError(null);
    setNotice(null);
    try {
      const result = await SolanaWallet.from(wallet).sendTransaction({
        serializedTransaction: prepared.serializedTransaction,
      });
      if (!result.hash) throw new KaminoDrawerError("Кошелёк не вернул подпись транзакции.", 502);
      const signedPending: KaminoPendingAction = { ...awaitingSignature, stage: "signature", signature: result.hash };
      if (validateKaminoPendingAction(signedPending, actionWalletAddress).kind !== "valid") {
        setNotice("Кошелёк вернул подпись неизвестного формата. Проверьте кошелёк и Solana Explorer вручную; отправка заблокирована.");
        setError("Не удалось сохранить пригодную для проверки подпись. Не создавайте новую операцию до ручной проверки.");
        return;
      }
      try {
        window.localStorage.setItem(
          kaminoPendingActionStorageKey(actionWalletAddress),
          JSON.stringify(signedPending),
        );
      } catch {
        setRecoveryIssue("Получена подпись, но localStorage не удалось обновить. Не отправляйте операцию повторно; проверка выполняется по этой подписи.");
      }
      if (activeWalletAddress === actionWalletAddress) setPendingAction(signedPending);
      setNotice("Транзакция отправлена. Проверяем подтверждение в Solana Devnet.");
      await confirmSubmittedAction(signedPending, actionWalletAddress);
    } catch (requestError) {
      const rejection = isLikelyUserRejection(requestError);
      setNotice("Статус отправки неизвестен. Проверьте кошелёк и Solana Explorer вручную; новая отправка заблокирована до явного подтверждения очистки.");
      setError(rejection
        ? "Кошелёк сообщил об отмене, но отправку нельзя подтвердить. Проверьте кошелёк/Explorer перед сбросом."
        : "Не удалось получить подпись. Транзакция могла быть отправлена; проверьте кошелёк/Explorer перед сбросом.");
    } finally {
      setBusy(null);
    }
  };

  const verifyPendingConfirmation = async () => {
    if (!currentPendingAction || currentPendingAction.stage !== "signature" || !activeWalletAddress || busy) return;
    if (!currentPendingAction.signature) return;
    await confirmSubmittedAction({ ...currentPendingAction, signature: currentPendingAction.signature }, activeWalletAddress);
  };

  const acknowledgeUnknownSend = () => {
    if (!activeWalletAddress || busy || (!currentPendingAction && !recoveryBlocked)) return;
    const confirmed = window.confirm(
      "Статус транзакции неизвестен. Сначала проверьте кошелёк и Solana Explorer. Очистка удалит данные восстановления и позволит создать новую операцию, что может привести к дублированию, если транзакция всё же отправилась. Продолжить?",
    );
    if (!confirmed) return;
    try {
      window.localStorage.removeItem(kaminoPendingActionStorageKey(activeWalletAddress));
      setPendingAction(null);
      setPrepared(null);
      setConfirmation(null);
      setConfirmedAmountAtomic(null);
      setRecoveryWallet(activeWalletAddress);
      setRecoveryStatus("ready");
      setRecoveryIssue(null);
      setNotice(null);
      setError(null);
      setAccepted(false);
      setAmount("");
    } catch {
      setRecoveryIssue("Не удалось очистить localStorage. Новые операции остаются заблокированы.");
      setRecoveryStatus("unavailable");
    }
  };

  const changeAction = (nextAction: KaminoLendAction) => {
    if (nextAction === action || busy || prepared || currentPendingAction || !recoveryReady) return;
    setAction(nextAction);
    setAmount("");
    setAccepted(false);
    resetPreparedAction();
  };

  const changeAmount = (value: string) => {
    if (busy || prepared || currentPendingAction || !recoveryReady) return;
    setAmount(value);
    setError(null);
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && !currentPendingAction && !busy) resetPreparedAction();
    onOpenChange(nextOpen);
  };

  if (confirmation && reserve) {
    const completedActionLabel = confirmation.action === "deposit" ? "Пополнено" : "Выведено";
    return (
      <DrawerFrame
        open={open}
        onOpenChange={changeOpen}
        title="Kamino Lend · Solana Devnet"
        description="Операция подтверждена в Devnet."
      >
        <DrawerSuccess
          amount={0}
          amountLabel={`${completedActionLabel} ${formatAtomicAmount(confirmedAmountAtomic ?? prepared?.amountAtomic ?? amountAtomic ?? "0", reserve.decimals)}`}
          sentence={confirmation.action === "deposit"
            ? "Ликвидность внесена в выбранный резерв Kamino Lend."
            : "Ликвидность выведена из выбранного резерва Kamino Lend."}
          note={recoveryIssue ?? "SOLANA DEVNET · Тестовые токены и позиции не имеют денежной стоимости."}
          explorerUrl={confirmation.explorerUrl}
          onDone={() => {
            resetPreparedAction();
            onOpenChange(false);
          }}
          secondaryHref="/portfolio"
          secondaryLabel="Открыть портфель"
        />
      </DrawerFrame>
    );
  }

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="Kamino Lend · Solana Devnet"
      description="On-chain supply и вывод через проверенный Devnet-маршрут."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-1.5" aria-label="Сведения о сети и протоколе">
          <Badge variant="secondary">SOLANA DEVNET</Badge>
          <Badge variant="outline">KAMINO LEND</Badge>
          <Badge variant="outline">USER-SIGNED</Badge>
        </div>

        {activeWalletAddress && recoveryStatus === "loading" ? <LoadingLine label="Проверяем локальное восстановление…" /> : null}
        {recoveryIssue ? (
          <Card className="gap-2 rounded-xl border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-sm font-medium">Восстановление операции требует внимания</p>
            <p className="text-xs leading-5 text-muted-foreground">{recoveryIssue}</p>
          </Card>
        ) : null}

        {currentPendingAction ? (
          <Card className="gap-3 rounded-xl border-amber-500/30 bg-amber-500/5 p-3">
            <div>
              <p className="text-sm font-medium">
                {currentPendingAction.stage === "signature" ? "Операция ожидает подтверждения" : "Статус отправки неизвестен"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {currentPendingAction.action === "deposit" ? "Пополнение" : "Вывод"} · {currentPendingAction.amountAtomic} atomic units
                {currentPendingAction.stage === "signature"
                  ? " · повторная отправка отключена; можно только проверить подтверждение"
                  : " · проверьте кошелёк и Solana Explorer вручную; повторная отправка отключена"}
              </p>
            </div>
            {currentPendingAction.stage === "signature" ? <a className="break-all text-xs underline" target="_blank" rel="noopener noreferrer"
              href={`https://explorer.solana.com/tx/${currentPendingAction.signature}?cluster=devnet`}>Открыть отправленную транзакцию в Explorer</a> : null}
            {currentPendingAction.stage === "signature" ? (
              <Button className="w-full" onClick={() => void verifyPendingConfirmation()} disabled={Boolean(busy || !recoveryReady)}>
                {busy === "confirming" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {busy === "confirming" ? "Проверяем подтверждение…" : "Повторить только проверку"}
              </Button>
            ) : (
              <Button variant="outline" className="w-full" onClick={acknowledgeUnknownSend} disabled={Boolean(busy)}>
                Я проверил кошелёк/Explorer — очистить и сбросить
              </Button>
            )}
          </Card>
        ) : null}

        {recoveryBlocked ? (
          <Button variant="outline" className="w-full" onClick={acknowledgeUnknownSend} disabled={Boolean(busy)}>
            Подтвердить очистку повреждённых данных
          </Button>
        ) : null}
        {notice ? <Notice>{notice}</Notice> : null}
        {error ? <p className="text-xs leading-5 text-destructive">{error}</p> : null}

        {busy === "loading" && !market ? <LoadingLine label="Проверяем маршрут Kamino Lend…" /> : null}

        {!market && busy !== "loading" ? (
          <UnavailableRoute error={error} onRetry={() => void loadMarket()} />
        ) : null}

        {market && !market.ready ? (
          <UnavailableRoute error={market.reason} onRetry={() => void loadMarket()} />
        ) : null}

        {marketReady && reserve ? (
          <>
            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Действие Kamino Lend">
              <ActionTab
                active={action === "deposit"}
                disabled={Boolean(busy || prepared || currentPendingAction || !recoveryReady)}
                icon={<ArrowDownToLine />}
                label="Пополнить"
                onClick={() => changeAction("deposit")}
              />
              <ActionTab
                active={action === "withdraw"}
                disabled={Boolean(busy || prepared || currentPendingAction || !recoveryReady)}
                icon={<ArrowUpFromLine />}
                label="Вывести"
                onClick={() => changeAction("withdraw")}
              />
            </div>

            <RouteSummary market={market} action={action} />

            {market.wallet ? (
              <Card className="gap-2 rounded-xl border-muted-foreground/15 bg-muted/30 p-3 text-xs leading-5">
                <p>
                  Доступно в кошельке: <span className="font-medium text-foreground">{formatAtomicAmount(market.wallet.liquidityBalanceAtomic, reserve.decimals)} Devnet USDC</span>
                </p>
                <p className="text-muted-foreground">
                  Collateral в Kamino: {formatAtomicAmount(market.wallet.collateralBalanceAtomic, reserve.decimals)} cToken. Точная доступная сумма для вывода будет проверена перед подписью.
                </p>
              </Card>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="kamino-lend-amount" className="text-sm font-medium">{inputLabel}</label>
                {reserve.maximumAmountAtomic ? (
                  <span className="text-xs text-muted-foreground">
                    Лимит {formatAtomicAmount(reserve.maximumAmountAtomic, reserve.decimals)}
                  </span>
                ) : null}
              </div>
              <Input
                id="kamino-lend-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(event) => changeAmount(event.target.value)}
                disabled={Boolean(busy || prepared || currentPendingAction || !recoveryReady)}
                className="h-12 text-xl font-semibold tabular-nums"
              />
              {exceedsMaximum ? (
                <p className="text-xs text-destructive">Сумма превышает текущий лимит маршрута.</p>
              ) : null}
              {amount && !amountAtomic ? (
                <p className="text-xs text-destructive">Укажите положительную сумму с точностью до {reserve.decimals} знаков после запятой.</p>
              ) : null}
              {reserve.availableLiquidityAtomic ? (
                <p className="text-xs text-muted-foreground">
                  Ликвидность резерва: {formatAtomicAmount(reserve.availableLiquidityAtomic, reserve.decimals)}. Доступность вывода проверяется сервером перед подписью.
                </p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5">
              <Checkbox
                checked={accepted}
                onCheckedChange={(checked) => setAccepted(checked === true)}
                disabled={Boolean(busy || prepared || currentPendingAction || !recoveryReady)}
                className="mt-0.5"
              />
              <span>
                Понимаю, что операция выполняется в Solana Devnet: использую тестовые токены, а позиция не имеет денежной стоимости. Перед подписью я увижу сумму, маршрут и результат серверной симуляции.
              </span>
            </label>

            {prepared ? (
              <PreparedActionReview prepared={prepared} reserve={reserve} walletAddress={activeWalletAddress} />
            ) : null}

            {!activeWalletAddress || !wallet ? (
              <Card className="gap-2 rounded-xl border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm font-medium">Подключите Solana-кошелёк</p>
                <p className="text-xs leading-5 text-muted-foreground">Кошелёк требуется только для подписи уже подготовленной Devnet-транзакции.</p>
              </Card>
            ) : null}

            {prepared && !currentPendingAction ? (
              <Button className="w-full" onClick={() => void signAndSendPreparedAction()} disabled={Boolean(busy || !wallet || !recoveryReady)}>
                {busy === "signing" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
                {busy === "signing" ? "Ожидаем подпись…" : `${actionLabel} и подписать`}
              </Button>
            ) : !prepared && !currentPendingAction ? (
              <Button className="w-full" onClick={() => void prepareAction()} disabled={!canPrepare}>
                {busy === "preparing" ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
                {busy === "preparing" ? "Симулируем операцию…" : "Подготовить транзакцию"}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
    </DrawerFrame>
  );
}

function RouteSummary({ market, action }: { market: KaminoLendMarket; action: KaminoLendAction }) {
  const reserve = market.reserve;
  if (!market.market || !reserve) return null;
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{action === "deposit" ? "Supply в Kamino Lend" : "Redeem из Kamino Lend"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {action === "deposit"
              ? "Токен резерва будет направлен в выбранный lending reserve."
              : "Сервер проверит доступность ликвидности и подготовит вывод из выбранного lending reserve."}
          </p>
        </div>
        <Badge variant="secondary">DEVNET</Badge>
      </div>
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Технические детали маршрута</summary>
        <div className="space-y-2 pt-3">
          <RouteRow label="Рынок" value={market.market.name ?? shortenAddress(market.market.address)} />
          <RouteRow label="Reserve" value={shortenAddress(reserve.address)} />
          <RouteRow label="Mint" value={shortenAddress(reserve.mint)} />
          <RouteRow label="Collateral mint" value={shortenAddress(reserve.collateralMint)} />
        </div>
      </details>
    </Card>
  );
}

function PreparedActionReview({
  prepared,
  reserve,
  walletAddress,
}: {
  prepared: PreparedKaminoLendAction;
  reserve: NonNullable<KaminoLendMarket["reserve"]>;
  walletAddress: string | null;
}) {
  return (
    <Card className="gap-3 border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        <div>
          <p className="font-medium">Транзакция готова к подписи</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Серверная симуляция завершилась без ошибки. Подпись и отправка выполняются только после вашего следующего действия.</p>
        </div>
      </div>
      <div className="space-y-2 rounded-xl bg-background/70 p-3 text-xs">
        <RouteRow label="Действие" value={prepared.action === "deposit" ? "Пополнение резерва" : "Вывод из резерва"} />
        <RouteRow label="Сумма" value={formatAtomicAmount(prepared.amountAtomic, reserve.decimals)} />
        <RouteRow label="Сеть" value="Solana Devnet" />
        <RouteRow label="Комиссию оплачивает" value={walletAddress ? shortenAddress(walletAddress) : "Подключённый кошелёк"} />
        <RouteRow label="Reserve" value={shortenAddress(prepared.reserve)} />
        {prepared.simulation.unitsConsumed !== null ? <RouteRow label="Compute units" value={prepared.simulation.unitsConsumed.toLocaleString("ru-RU")} /> : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Перед подтверждением внимательно проверьте сумму, сеть и кошелёк-оплатчик комиссии.</p>
    </Card>
  );
}

function ActionTab({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-foreground bg-muted" : "hover:bg-muted/40"}`}
    >
      {icon}{label}
    </button>
  );
}

function UnavailableRoute({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <Card className="items-center gap-3 rounded-2xl p-5 text-center">
      <ShieldCheck className="size-5 text-muted-foreground" />
      <div>
        <p className="font-medium">Kamino Lend временно недоступен</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{error ?? "Маршрут Devnet пока не готов к новым операциям."}</p>
      </div>
      <Button variant="outline" onClick={onRetry}><RefreshCw />Обновить</Button>
    </Card>
  );
}

function LoadingLine({ label }: { label: string }) {
  return <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{label}</p>;
}

function RouteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">{children}</p>;
}

class KaminoDrawerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KaminoDrawerError";
    this.status = status;
  }
}

function userFacingError(error: unknown, fallback: string) {
  if (isLikelyUserRejection(error)) return "Подтверждение в кошельке отменено. Транзакция не была отправлена.";
  const message = error instanceof Error ? error.message : "";
  if (/insufficient|balance|liquidity/i.test(message)) return "Недостаточно доступного баланса или ликвидности для этой операции.";
  if (/blockhash|expired/i.test(message)) return "Подготовленная транзакция устарела. Подготовьте её заново перед подписью.";
  if (/wallet|session/i.test(message)) return "Не удалось подтвердить подключённый Solana-кошелёк. Перезайдите в аккаунт и повторите попытку.";
  return error instanceof KaminoDrawerError && error.message ? error.message : fallback;
}

function isLikelyUserRejection(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /reject|declin|cancel|denied|abort/i.test(message);
}

function isVerifiedTransactionFailure(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).code === "TRANSACTION_FAILED";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function shortenAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
