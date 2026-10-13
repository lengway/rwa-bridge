"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { KaminoSmartWalletApproval } from "@/components/app/kamino-smart-wallet-approval";
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
import { normalizeKaminoWalletSnapshot, kaminoActionMaximum, type KaminoWalletSnapshot } from "@/lib/kamino-wallet-snapshot";
import { pollKaminoConfirmation, type KaminoConfirmationCheck } from "@/lib/kamino-confirmation-poll";
import { formatAtomicToDecimal } from "@/lib/earn-gateway";

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
  const [walletSnapshotState, setWalletSnapshotState] = useState<{ walletAddress: string; snapshot: KaminoWalletSnapshot } | null>(null);
  const [walletSnapshotError, setWalletSnapshotError] = useState<{ walletAddress: string; message: string } | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [smartFlowActive, setSmartFlowActive] = useState(false);

  const activeWalletAddress = walletAddress ?? devnet.walletAddress;
  const activeWalletRef = useRef(activeWalletAddress);
  const confirmationInFlight = useRef(false);
  useEffect(() => { activeWalletRef.current = activeWalletAddress; }, [activeWalletAddress]);
  const walletSnapshot = walletSnapshotState?.walletAddress === activeWalletAddress ? walletSnapshotState.snapshot : null;
  const balanceError = walletSnapshotError?.walletAddress === activeWalletAddress ? walletSnapshotError.message : null;
  const reserve = market?.ready ? market.reserve : null;
  const amountAtomic = useMemo(
    () => reserve ? decimalToAtomic(amount, reserve.decimals) : null,
    [amount, reserve],
  );
  const exceedsMaximum = Boolean(amountAtomic && reserve?.maximumAmountAtomic
    && BigInt(amountAtomic) > BigInt(reserve.maximumAmountAtomic));
  const availableMaximum = kaminoActionMaximum({ action, cap: reserve?.maximumAmountAtomic ?? null,
    reserveLiquidity: reserve?.availableLiquidityAtomic ?? null, wallet: walletSnapshot });
  const exceedsWalletMaximum = Boolean(amountAtomic && availableMaximum !== null && BigInt(amountAtomic) > BigInt(availableMaximum));
  const marketReady = market?.ready === true && market.market !== null && reserve !== null;
  const recoveryReady = recoveryWallet === activeWalletAddress && recoveryStatus === "ready";
  const recoveryBlocked = recoveryWallet === activeWalletAddress && recoveryStatus === "blocked";
  const currentPendingAction = pendingAction?.walletAddress === activeWalletAddress ? pendingAction : null;
  const actionLabel = action === "deposit" ? "Invest" : "Withdraw";
  const inputLabel = "Amount · USDC";
  const canPrepare = marketReady
    && Boolean(wallet)
    && Boolean(activeWalletAddress)
    && Boolean(amountAtomic)
    && !exceedsMaximum
    && !exceedsWalletMaximum
    && walletSnapshot !== null
    && walletSnapshot?.solBalanceLamports !== "0"
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
          setRecoveryIssue("Saved recovery data is corrupted. Confirm the warning before clearing it and starting a new transaction.");
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
            ? "The saved action belongs to another wallet and will not be recovered. Confirm clearing it before starting a new transaction."
            : "Saved recovery data is invalid. Confirm clearing it before starting a new transaction.");
          setRecoveryWallet(activeWalletAddress);
          setRecoveryStatus("blocked");
        }
      } catch {
        setRecoveryIssue("Could not read local storage. Recovery is unavailable; signing is blocked.");
        setRecoveryWallet(activeWalletAddress);
        setRecoveryStatus("unavailable");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeWalletAddress]);

  const loadWalletSnapshot = useCallback(async (signal?: AbortSignal) => {
    if (!activeWalletAddress) return;
    const checkedWallet = activeWalletAddress;
    setWalletLoading(true);
    try {
      const response = await fetch(`/api/kamino/position?walletAddress=${encodeURIComponent(checkedWallet)}`, {
        cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => null);
      if (signal?.aborted || activeWalletRef.current !== checkedWallet) return;
      const snapshot = response.ok ? normalizeKaminoWalletSnapshot(payload, checkedWallet) : null;
      if (!snapshot) throw new Error("Wallet balances are unavailable. Refresh before relying on the displayed amounts.");
      setWalletSnapshotState({ walletAddress: checkedWallet, snapshot });
      setWalletSnapshotError(null);
    } catch {
      if (signal?.aborted || activeWalletRef.current !== checkedWallet) return;
      setWalletSnapshotState(null);
      setWalletSnapshotError({ walletAddress: checkedWallet,
        message: "Could not verify wallet balances. They are unknown, not zero. Refresh to try again." });
    } finally {
      if (activeWalletRef.current === checkedWallet) setWalletLoading(false);
    }
  }, [activeWalletAddress]);

  useEffect(() => {
    if (!open || !activeWalletAddress) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadWalletSnapshot(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, activeWalletAddress, loadWalletSnapshot]);

  const loadMarket = useCallback(async (signal?: AbortSignal) => {
    setBusy("loading");
    setError(null);
    try {
      // Route readiness is public and must not depend on an optional balance
      // lookup for the connected wallet. In particular, the Crossmint-wallet
      // link can still be settling immediately after sign-in; coupling it to
      // this read made a healthy Kamino route appear unavailable. Wallet-bound
      // authorization remains enforced by the prepare/confirm endpoints.
      const response = await fetch("/api/kamino/market", { cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => null);
      const nextMarket = normalizeKaminoLendMarket(payload);
      if (signal?.aborted) return;
      if (!nextMarket) throw new KaminoDrawerError("The Kamino Lend route returned incomplete technical data.", response.status);
      if (!response.ok && nextMarket.ready) throw new KaminoDrawerError(readKaminoApiError(payload, "Could not verify the Kamino Lend route."), response.status);
      setMarket(nextMarket);
      if (!nextMarket.ready) setNotice(nextMarket.reason ?? "The Kamino Lend route is temporarily unavailable.");
    } catch (requestError) {
      if (isAbortError(requestError)) return;
      setMarket(null);
      setError(userFacingError(requestError, "Could not load Kamino Lend status."));
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
    signal?: AbortSignal,
  ): Promise<KaminoConfirmationCheck> => {
    if (confirmationInFlight.current) return "pending";
    confirmationInFlight.current = true;
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
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => null);
      if (signal?.aborted || activeWalletRef.current !== actionWalletAddress) return "unknown";

      if (response.status === 202) {
        setNotice("Transaction submitted. Confirmation pending.");
        return "pending";
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
            setError("Transaction failed. Please try again.");
          } catch {
            setRecoveryIssue("The transaction failed, but local storage could not be cleared. Check again or reload the page before starting a new transaction.");
            setError("The transaction failed, but local recovery data could not be cleared.");
          }
          return "failed";
        }
        throw new KaminoDrawerError(readKaminoApiError(payload, "Could not confirm the Kamino Lend transaction."), response.status);
      }

      const nextConfirmation = normalizeKaminoLendConfirmation(
        payload,
        actionToConfirm.action,
        actionToConfirm.actionId,
        actionToConfirm.signature,
      );
      if (!nextConfirmation) {
        throw new KaminoDrawerError("The server has not confirmed transaction completion yet. Check again without creating a new transaction.", 502);
      }

      let recoveryCleared = true;
      try {
        window.localStorage.removeItem(kaminoPendingActionStorageKey(actionWalletAddress));
      } catch {
        recoveryCleared = false;
        if (activeWalletAddress === actionWalletAddress) {
          setRecoveryIssue("The transaction is confirmed, but local recovery data could not be cleared. Do not submit another transaction until recovery is checked.");
        }
      }
      if (activeWalletAddress === actionWalletAddress) {
        setConfirmation(nextConfirmation);
        setConfirmedAmountAtomic(nextConfirmation.actualLiquidityAmountAtomic ?? actionToConfirm.amountAtomic);
        setNotice(null);
        if (recoveryCleared) {
          setPendingAction(null);
          setRecoveryStatus("ready");
          setRecoveryIssue(null);
        }
      }
      void devnet.refreshPortfolio();
      void loadMarket();
      void loadWalletSnapshot();
      onConfirmed?.(nextConfirmation);
      toast.success(actionToConfirm.action === "deposit"
        ? "Deposit confirmed"
        : "Withdrawal confirmed");
      return "confirmed";
    } catch (requestError) {
      if (signal?.aborted || activeWalletRef.current !== actionWalletAddress) return "unknown";
      setError(userFacingError(requestError, "Could not confirm the transaction. Retry the confirmation check only."));
      return "unknown";
    } finally {
      confirmationInFlight.current = false;
      setBusy(null);
    }
  }, [activeWalletAddress, devnet, loadMarket, loadWalletSnapshot, onConfirmed]);

  const confirmRef = useRef(confirmSubmittedAction);
  const pollingRun = useRef(0);
  useEffect(() => { confirmRef.current = confirmSubmittedAction; }, [confirmSubmittedAction]);
  const pendingSignature = currentPendingAction?.stage === "signature" ? currentPendingAction.signature : null;
  const pendingId = currentPendingAction?.actionId;
  const pendingKind = currentPendingAction?.action;
  const pendingAmount = currentPendingAction?.amountAtomic;
  useEffect(() => {
    if (!open || !activeWalletAddress || !pendingSignature || !pendingId || !pendingKind || !pendingAmount) return;
    const controller = new AbortController();
    const run = ++pollingRun.current;
    const confirmedWallet = activeWalletAddress;
    const identity = { action: pendingKind, actionId: pendingId, amountAtomic: pendingAmount, signature: pendingSignature };
    const timer = window.setTimeout(() => {
      setPolling(true);
      void pollKaminoConfirmation({ signal: controller.signal,
        check: (signal) => confirmRef.current(identity, confirmedWallet, signal),
      }).then((result) => {
        if (!controller.signal.aborted && result === "pending") {
          setNotice("Still waiting for finalization. Your action is saved. You can close this window or check again; do not send it twice.");
        }
      }).finally(() => {
        if (pollingRun.current === run && activeWalletRef.current === confirmedWallet) setPolling(false);
      });
    }, 1_000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (pollingRun.current === run) {
        pollingRun.current += 1;
        setPolling(false);
      }
    };
  }, [open, activeWalletAddress, pendingSignature, pendingId, pendingKind, pendingAmount]);

  const prepareAction = async () => {
    if (!marketReady || !amountAtomic || !activeWalletAddress || !wallet || !walletSnapshot || !accepted || exceedsMaximum || busy
      || !recoveryReady || currentPendingAction || recoveryBlocked || exceedsWalletMaximum || walletSnapshot?.solBalanceLamports === "0") return;
    setBusy("preparing");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/kamino/${action}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: activeWalletAddress, amountAtomic, cluster: "devnet" }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new KaminoDrawerError(readKaminoApiError(payload, "Could not prepare a Kamino Lend transaction."), response.status);
      const nextPrepared = normalizePreparedKaminoLendAction(payload, action);
      if (!nextPrepared || !preparedActionMatchesMarket(nextPrepared, market, amountAtomic)) {
        throw new KaminoDrawerError("The server returned a transaction that does not match the selected Devnet route.", 502);
      }
      setPrepared(nextPrepared);
      setNotice("Review and confirm.");
    } catch (requestError) {
      setError(userFacingError(requestError, "Could not prepare the Kamino Lend transaction."));
    } finally {
      setBusy(null);
    }
  };

  const signAndSendPreparedAction = async () => {
    if (!prepared || !wallet || !activeWalletAddress || busy || !recoveryReady || currentPendingAction) return;
    if (prepared.expiresAt <= Date.now()) {
      setPrepared(null);
      setNotice(null);
      setError("The prepared transaction expired. Prepare a new one; this transaction was not submitted.");
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
        setRecoveryIssue("Another tab saved an action. Check its status before submitting another transaction.");
        setPrepared(null);
        return;
      }
      window.localStorage.setItem(
        kaminoPendingActionStorageKey(actionWalletAddress),
        JSON.stringify(awaitingSignature),
      );
    } catch {
      setRecoveryIssue("Could not save recovery data to local storage. Signing and submission are blocked.");
      setRecoveryStatus("unavailable");
      setError("Enable local storage access first; the transaction was not submitted.");
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
      if (!result.hash) throw new KaminoDrawerError("The wallet did not return a transaction signature.", 502);
      const signedPending: KaminoPendingAction = { ...awaitingSignature, stage: "signature", signature: result.hash };
      if (validateKaminoPendingAction(signedPending, actionWalletAddress).kind !== "valid") {
        setNotice("The wallet returned a signature in an unknown format. Check your wallet and Solana Explorer manually; submission is blocked.");
        setError("Could not save a verifiable signature. Do not create a new transaction before checking manually.");
        return;
      }
      try {
        window.localStorage.setItem(
          kaminoPendingActionStorageKey(actionWalletAddress),
          JSON.stringify(signedPending),
        );
      } catch {
        setRecoveryIssue("A signature was received, but local recovery data could not be updated. Do not resubmit; confirmation will be checked using this signature.");
      }
      if (activeWalletAddress === actionWalletAddress) setPendingAction(signedPending);
      setNotice("Transaction submitted. Confirming…");
      // The recovery effect owns confirmation checks, including the first
      // check. Do not race a second confirmation request with that poller.
    } catch (requestError) {
      const rejection = isLikelyUserRejection(requestError);
      setNotice("Submission status is unknown. Check your wallet and Solana Explorer manually; another submission is blocked until you explicitly confirm clearing recovery data.");
      setError(rejection
        ? "The wallet reported cancellation, but submission status cannot be verified. Check your wallet and Explorer before resetting."
        : "Could not obtain a signature. The transaction may have been submitted; check your wallet and Explorer before resetting.");
    } finally {
      setBusy(null);
    }
  };

  const verifyPendingConfirmation = async () => {
    if (!currentPendingAction || currentPendingAction.stage !== "signature" || !activeWalletAddress || busy || polling) return;
    if (!currentPendingAction.signature) return;
    await confirmSubmittedAction({ ...currentPendingAction, signature: currentPendingAction.signature }, activeWalletAddress);
  };

  const acknowledgeUnknownSend = () => {
    if (!activeWalletAddress || busy || (!currentPendingAction && !recoveryBlocked)) return;
    const confirmed = window.confirm(
      "Transaction status is unknown. Check your wallet and Solana Explorer first. Clearing recovery data lets you create a new transaction, which could duplicate the action if the first transaction was submitted. Continue?",
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
      setRecoveryIssue("Could not clear local recovery data. New transactions remain blocked.");
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

  if (market?.execution === "crossmint-smart-wallet" && !currentPendingAction && !recoveryBlocked) {
    return (
      <DrawerFrame open={open} onOpenChange={changeOpen} title={action === "deposit" ? "Вложить в Kamino" : "Вывести из Kamino"}
        description={smartFlowActive ? "" : "Укажите сумму в USDC."}>
        <div className="space-y-4">
          {!smartFlowActive ? <><div className="flex gap-2">
            <Button variant={action === "deposit" ? "default" : "outline"} onClick={() => changeAction("deposit")}>Вложить</Button>
            <Button variant={action === "withdraw" ? "default" : "outline"} onClick={() => changeAction("withdraw")}>Вывести</Button>
          </div>
          <div className="space-y-2">
            <label htmlFor="kamino-smart-amount" className="text-sm font-medium">Сумма · USDC</label>
            <Input id="kamino-smart-amount" inputMode="decimal" placeholder="0.10" value={amount} onChange={event => changeAmount(event.target.value)} />
            <p className="text-xs text-muted-foreground">Доступно: {availableMaximum === null ? "—" : formatAtomicAmount(availableMaximum, 6)} USDC</p>
            {exceedsMaximum || exceedsWalletMaximum ? <p className="text-sm text-destructive">Укажите сумму в пределах доступного баланса.</p> : null}
            {balanceError ? <div className="space-y-2">
              <p className="text-sm text-destructive">Не получилось загрузить баланс.</p>
              <Button variant="outline" size="sm" disabled={walletLoading} onClick={() => void loadWalletSnapshot()}>Повторить</Button>
              <details className="text-xs text-muted-foreground"><summary>Подробнее</summary><p>{balanceError}</p></details>
            </div> : null}
          </div></> : null}
          {open ? <KaminoSmartWalletApproval action={action} amountAtomic={amountAtomic && !exceedsMaximum && !exceedsWalletMaximum && walletSnapshot ? amountAtomic : "0"}
            wallet={wallet} walletAddress={activeWalletAddress}
            onActiveChange={setSmartFlowActive}
            onDone={() => { setSmartFlowActive(false); onOpenChange(false); }}
            onCompleted={status => {
              void loadWalletSnapshot();
              void loadMarket();
              void devnet.refresh();
              if (status.action !== "initialize" && status.signature) onConfirmed?.({
                action: status.action, actionId: status.actionId, confirmed: true, signature: status.signature,
                explorerUrl: `https://explorer.solana.com/tx/${status.signature}?cluster=devnet`, status: "COMPLETED", actualLiquidityAmountAtomic: null,
              });
            }} /> : null}
        </div>
      </DrawerFrame>
    );
  }

  if (confirmation) {
    const completedActionLabel = confirmation.action === "deposit" ? "Invested" : "Withdrawn";
    return (
      <DrawerFrame
        open={open}
        onOpenChange={changeOpen}
        title={confirmation.action === "deposit" ? "Investment confirmed" : "Withdrawal confirmed"}
        description="Transaction confirmed."
      >
        <DrawerSuccess
          amount={0}
          amountLabel={`${completedActionLabel} ${formatAtomicAmount(confirmedAmountAtomic ?? prepared?.amountAtomic ?? amountAtomic ?? "0", reserve?.decimals ?? 6)} USDC`}
          sentence={confirmation.action === "deposit"
            ? "Your investment is now shown in your invested balance."
            : "Your USDC has returned to your wallet."}
          note={recoveryIssue ?? ""}
          explorerUrl={confirmation.explorerUrl}
          onDone={() => {
            resetPreparedAction();
            onOpenChange(false);
          }}
          secondaryHref="/home"
          secondaryLabel="Back to balances"
        />
      </DrawerFrame>
    );
  }

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title={prepared ? `Confirm ${action === "deposit" ? "investment" : "withdrawal"}` : actionLabel}
      description={action === "deposit" ? "Choose an amount to invest." : "Choose an amount to return to your wallet."}
    >
      <div className="space-y-5">
        {activeWalletAddress && recoveryStatus === "loading" ? <LoadingLine label="Checking local recovery…" /> : null}
        {recoveryIssue ? (
          <Card className="gap-2 rounded-xl border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-sm font-medium">Action recovery needs attention</p>
            <p className="text-xs leading-5 text-muted-foreground">{recoveryIssue}</p>
          </Card>
        ) : null}

        {currentPendingAction ? (
          <Card className="gap-3 rounded-xl border-amber-500/30 bg-amber-500/5 p-3">
            <div>
              <p className="text-sm font-medium">
                {currentPendingAction.stage === "signature" ? "Transaction awaiting confirmation" : "Submission status unknown"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {currentPendingAction.action === "deposit" ? "Investment" : "Withdrawal"} · {formatAtomicAmount(currentPendingAction.amountAtomic, 6)} USDC
                {currentPendingAction.stage === "signature"
                  ? " · resubmission is disabled; you can only check confirmation"
                  : " · check your wallet and Solana Explorer manually; resubmission is disabled"}
              </p>
            </div>
            {currentPendingAction.stage === "signature" ? <a className="break-all text-xs underline" target="_blank" rel="noopener noreferrer"
              href={`https://explorer.solana.com/tx/${currentPendingAction.signature}?cluster=devnet`}>View submitted transaction in Explorer</a> : null}
            {currentPendingAction.stage === "signature" ? (
              <Button className="w-full" onClick={() => void verifyPendingConfirmation()} disabled={Boolean(busy || polling || !recoveryReady)}>
                {busy === "confirming" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {busy === "confirming" ? "Checking confirmation…" : "Check confirmation again"}
              </Button>
            ) : (
              <Button variant="outline" className="w-full" onClick={acknowledgeUnknownSend} disabled={Boolean(busy)}>
                I checked my wallet and Explorer — clear and reset
              </Button>
            )}
          </Card>
        ) : null}

        {recoveryBlocked ? (
          <Button variant="outline" className="w-full" onClick={acknowledgeUnknownSend} disabled={Boolean(busy)}>
            Confirm clearing corrupted data
          </Button>
        ) : null}
        {notice ? <Notice>{notice}</Notice> : null}
        {error ? <p className="text-xs leading-5 text-destructive">{error}</p> : null}
        {polling ? <LoadingLine label="Checking finalization automatically. No new transaction is being sent." /> : null}
        {!prepared && !currentPendingAction ? <div className="flex flex-wrap items-center gap-2 text-xs"><Button variant="ghost" size="sm" onClick={() => void loadWalletSnapshot()} disabled={walletLoading}><RefreshCw className={walletLoading ? "animate-spin" : ""} />Refresh balance</Button>{walletSnapshot && (action === "deposit" && walletSnapshot.liquidityAmountAtomic === "0" || walletSnapshot.solBalanceLamports === "0") ? <a href="/funding" className="underline">Add funds</a> : null}{balanceError ? <p role="alert" className="w-full text-destructive">{balanceError}</p> : null}</div> : null}
        {action === "withdraw" && walletSnapshot?.collateralAmountAtomic === "0" && !currentPendingAction ? <Card className="gap-2 rounded-xl p-4">
          <p className="text-sm font-medium">Nothing to withdraw yet</p>
          <p className="text-xs leading-5 text-muted-foreground">You haven&apos;t invested USDC yet.</p>
          <Button variant="outline" size="sm" disabled={Boolean(busy || prepared || !recoveryReady)} onClick={() => changeAction("deposit")}>Invest</Button>
        </Card> : null}

        {busy === "loading" && !market ? <LoadingLine label="Checking availability…" /> : null}

        {!market && busy !== "loading" ? (
          <UnavailableRoute error={error} onRetry={() => void loadMarket()} />
        ) : null}

        {market && !market.ready ? (
          <UnavailableRoute error={market.reason} onRetry={() => void loadMarket()} />
        ) : null}

        {marketReady && reserve ? (
          <>
            {!prepared && !currentPendingAction ? <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Invest or withdraw">
              <ActionTab
                active={action === "deposit"}
                disabled={Boolean(busy || prepared || currentPendingAction || !recoveryReady)}
                icon={<ArrowDownToLine />}
                label="Invest"
                onClick={() => changeAction("deposit")}
              />
              <ActionTab
                active={action === "withdraw"}
                disabled={Boolean(busy || prepared || currentPendingAction || !recoveryReady)}
                icon={<ArrowUpFromLine />}
                label="Withdraw"
                onClick={() => changeAction("withdraw")}
              />
            </div> : null}

            {!prepared && !currentPendingAction && walletSnapshot ? (
              <Card className="gap-2 rounded-xl border-muted-foreground/15 bg-muted/30 p-3 text-xs leading-5">
                <p>{action === "deposit" ? "Available to invest" : "Estimated available to withdraw"}: <span className="font-medium text-foreground">{formatAtomicAmount(action === "deposit" ? walletSnapshot.liquidityAmountAtomic : walletSnapshot.estimatedUnderlyingAmountAtomic, reserve.decimals)} USDC</span></p>
              </Card>
            ) : null}

            {!prepared && !currentPendingAction ? <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="kamino-lend-amount" className="text-sm font-medium">{inputLabel}</label>
                <Button variant="ghost" size="sm" disabled={availableMaximum === null || availableMaximum === "0" || Boolean(busy || prepared || currentPendingAction)}
                  onClick={() => {
                    if (availableMaximum !== null) {
                      setAmount(formatAtomicToDecimal(BigInt(availableMaximum), reserve.decimals));
                    }
                  }}>Max</Button>
                {reserve.maximumAmountAtomic ? (
                  <span className="text-xs text-muted-foreground">
                    Maximum: {formatAtomicAmount(reserve.maximumAmountAtomic, reserve.decimals)} USDC
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
                <p className="text-xs text-destructive">Amount exceeds the current route limit.</p>
              ) : null}
              {!exceedsMaximum && exceedsWalletMaximum ? <p className="text-xs text-destructive">Amount exceeds your current balance or available withdrawal estimate. Refresh balances to check again.</p> : null}
              {amount && !amountAtomic ? (
                <p className="text-xs text-destructive">Enter a positive amount with up to {reserve.decimals} decimal places.</p>
              ) : null}
            </div> : null}

            {!prepared && !currentPendingAction ? <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs leading-5">
              <Checkbox
                checked={accepted}
                onCheckedChange={(checked) => setAccepted(checked === true)}
                disabled={Boolean(busy || prepared || currentPendingAction || !recoveryReady)}
                className="mt-0.5"
              />
              <span>
                I accept the variable rate and withdrawal terms.
              </span>
            </label> : null}

            {prepared ? (
              <><PreparedActionReview prepared={prepared} reserve={reserve} walletAddress={activeWalletAddress} />{!currentPendingAction ? <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={resetPreparedAction}>Edit amount</Button> : null}</>
            ) : null}

            {!activeWalletAddress || !wallet ? (
              <Card className="gap-2 rounded-xl border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm font-medium">Connect a Solana wallet</p>
                <p className="text-xs leading-5 text-muted-foreground"></p>
              </Card>
            ) : null}

            {prepared && !currentPendingAction ? (
              <Button className="w-full" onClick={() => void signAndSendPreparedAction()} disabled={Boolean(busy || !wallet || !recoveryReady)}>
                {busy === "signing" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
                {busy === "signing" ? "Waiting for your approval…" : `Confirm ${actionLabel.toLowerCase()}`}
              </Button>
            ) : !prepared && !currentPendingAction ? (
              <Button className="w-full" onClick={() => void prepareAction()} disabled={!canPrepare}>
                {busy === "preparing" ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
                {busy === "preparing" ? "Checking your transaction…" : "Continue"}
              </Button>
            ) : null}
            <details className="rounded-xl border p-3 text-xs"><summary className="cursor-pointer font-medium">Investment details</summary><div className="mt-3 space-y-3"><p className="leading-5 text-muted-foreground">Variable returns. Withdrawals depend on available liquidity.</p><RouteSummary market={market} action={action} /></div></details>
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
          <p className="font-medium">{action === "deposit" ? "Supply to Kamino Lend" : "Redeem from Kamino Lend"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {action === "deposit"
              ? "The reserve token will be supplied to the selected lending reserve."
              : "The server will check liquidity and prepare a withdrawal from the selected lending reserve."}
          </p>
        </div>
        <Badge variant="secondary">DEVNET</Badge>
      </div>
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Route technical details</summary>
        <div className="space-y-2 pt-3">
          <RouteRow label="Market" value={market.market.name ?? shortenAddress(market.market.address)} />
          <RouteRow label="Reserve" value={shortenAddress(reserve.address)} />
          <RouteRow label="Mint" value={shortenAddress(reserve.mint)} />
          <RouteRow label="Collateral mint" value={shortenAddress(reserve.collateralMint)} />
        </div>
      </details>
    </Card>
  );
}

export function PreparedActionReview({
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
          <p className="font-medium">Ready for your confirmation</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Checks passed. Nothing has been sent yet.</p>
        </div>
      </div>
      <div className="space-y-2 rounded-xl bg-background/70 p-3 text-xs">
        <RouteRow label="Action" value={prepared.action === "deposit" ? "Invest" : "Withdraw"} />
        <RouteRow label="Amount" value={`${formatAtomicAmount(prepared.amountAtomic, reserve.decimals)} USDC`} />
        <RouteRow label="Network" value="Solana" />
        {prepared.networkFeeLamports !== null ? <RouteRow label="Network fee" value={`${formatAtomicAmount(prepared.networkFeeLamports, 9)} SOL`} /> : null}
      </div>
      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Technical checks</summary><div className="mt-2 space-y-2"><RouteRow label="Fee payer" value={walletAddress ? shortenAddress(walletAddress) : "Connected wallet"} /><RouteRow label="Reserve" value={shortenAddress(prepared.reserve)} />{prepared.simulation.unitsConsumed !== null ? <RouteRow label="Compute units" value={prepared.simulation.unitsConsumed.toLocaleString("en-US")} /> : null}</div></details>
      <p className="text-xs leading-5 text-muted-foreground">Network fee excludes refundable account rent.</p>
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
        <p className="font-medium">Kamino Lend is temporarily unavailable</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{error ?? "Temporarily unavailable."}</p>
      </div>
      <Button variant="outline" onClick={onRetry}><RefreshCw />Refresh</Button>
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
  if (isLikelyUserRejection(error)) return "Wallet confirmation was canceled. The transaction was not submitted.";
  const message = error instanceof Error ? error.message : "";
  if (/insufficient|balance|liquidity/i.test(message)) return "Insufficient available balance or liquidity for this transaction.";
  if (/blockhash|expired/i.test(message)) return "The prepared transaction has expired. Prepare it again before signing.";
  if (/wallet|session/i.test(message)) return "Could not verify the connected Solana wallet. Sign in again and retry.";
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
