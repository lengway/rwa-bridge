"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Chain, Wallet } from "@crossmint/wallets-sdk";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { formatAtomicToDecimal } from "@/lib/earn-gateway";
import { useAuth } from "@/lib/useAuth";
import {
  continueSmartWalletChain,
  readStoredSmartWalletOperation,
  type SmartWalletOperationStatus,
  type StoredSmartWalletOperation,
} from "@/lib/kamino-smart-wallet-client";

export type KaminoSmartWalletApprovalProps = {
  action: "deposit" | "withdraw";
  amountAtomic: string;
  wallet: Wallet<Chain> | null;
  walletAddress: string | null;
  onCompleted?: (status: SmartWalletOperationStatus) => void;
  onDone?: () => void;
  onActiveChange?: (active: boolean) => void;
};

function amountLabel(amountAtomic: string) {
  try { return `${formatAtomicToDecimal(BigInt(amountAtomic), 6)} USDC`; }
  catch { return "USDC"; }
}

export function KaminoSmartWalletApproval(props: KaminoSmartWalletApprovalProps) {
  const { action, amountAtomic, wallet, walletAddress, onDone, onActiveChange } = props;
  const [operation, setOperation] = useState<StoredSmartWalletOperation | null>(null);
  const [running, setRunning] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [, setProgress] = useState("Preparing…");
  const [, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<SmartWalletOperationStatus | null>(null);
  const [completedAmount, setCompletedAmount] = useState(amountAtomic);
  const { email } = useAuth();
  const latest = useRef({ ...props, email });
  const currentOperation = useRef<StoredSmartWalletOperation | null>(null);
  const controller = useRef<AbortController | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const inFlight = useRef<AbortSignal | null>(null);
  useEffect(() => { latest.current = { ...props, email }; });

  const run = useCallback(async (userTap: boolean, signal: AbortSignal) => {
    const context = latest.current;
    if (inFlight.current && !inFlight.current.aborted || !context.wallet || !context.walletAddress
      || context.wallet.address !== context.walletAddress || signal.aborted) return;
    inFlight.current = signal;
    setRunning(true);
    setError(null);
    setStalled(false);
    const intent = currentOperation.current?.continuation ?? currentOperation.current;
    setCompletedAmount(intent && intent.action !== "initialize" ? intent.amountAtomic : context.amountAtomic);
    const watchdog = window.setTimeout(() => { if (!signal.aborted) setStalled(true); }, 60_000);
    const wait = (waitSignal: AbortSignal) => new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(timer);
        waitSignal.removeEventListener("abort", finish);
        if (wake.current === finish) wake.current = null;
        resolve();
      };
      const timer = window.setTimeout(finish, 5_000);
      wake.current = finish;
      waitSignal.addEventListener("abort", finish, { once: true });
      if (waitSignal.aborted) finish();
    });
    try {
      const client = await import("@/lib/kamino-smart-wallet-client");
      if (signal.aborted) return;
      const result = await continueSmartWalletChain({
        operation: currentOperation.current, action: context.action, amountAtomic: context.amountAtomic,
        walletAddress: context.walletAddress, userTap, signal,
        approve: async (transactionId) => {
          // A stalled provider UI must not stop background status reconciliation.
          // Timeout never causes another approval: the durable marker stays set.
          let timer: number | undefined;
          try {
            // The server requests approval from the wallet's email signer; the SDK
            // otherwise approves with its device signer and finds no pending approval.
            console.info("[smart-wallet] switching to email signer", transactionId);
            if (context.email) await context.wallet!.useSigner({ type: "email", email: context.email });
            console.info("[smart-wallet] approving", transactionId);
            return await Promise.race([
              context.wallet!.approve({ transactionId }).then(result => { console.info("[smart-wallet] approved", transactionId); return result; }),
              new Promise<never>((_, reject) => {
                timer = window.setTimeout(() => reject(new Error("The wallet response was interrupted.")), 180_000);
              }),
            ]);
          } finally { window.clearTimeout(timer); }
        },
        onOperation: (next) => { currentOperation.current = next; setOperation(next); },
        onProgress: setProgress,
        dependencies: {
          prepare: client.prepareSmartWalletOperation, initialize: client.initializeSmartWallet,
          status: client.getSmartWalletOperationStatus, store: client.storeSmartWalletOperation,
          clear: client.clearStoredSmartWalletOperation, newId: () => crypto.randomUUID(), wait,
        },
      });
      if (!signal.aborted && result) {
        setCompleted(result);
        setProgress("Done");
        latest.current.onCompleted?.(result);
      }
    } catch (cause) {
      console.error("[smart-wallet] operation failed:", cause);
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      window.clearTimeout(watchdog);
      if (inFlight.current === signal) inFlight.current = null;
      if (!signal.aborted) { setRunning(false); setRecovering(false); setStalled(false); }
    }
  }, []);

  const matches = Boolean(wallet && walletAddress && wallet.address === walletAddress);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => {
      if (abort.signal.aborted) return;
      setCompleted(null);
      setError(null);
      setRunning(false);
      setStalled(false);
      setRecovering(true);
      try {
        const stored = matches && walletAddress ? readStoredSmartWalletOperation(walletAddress) : null;
        currentOperation.current = stored;
        setOperation(stored);
        if (stored) void run(false, abort.signal);
        else setRecovering(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setRecovering(false);
      }
    }, 0);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [matches, walletAddress, run]);

  const active = running || recovering || Boolean(operation && (operation.action !== "initialize" || operation.continuation)) || Boolean(completed);
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  const intent = operation?.continuation ?? operation;
  const displayedAction = intent && intent.action !== "initialize" ? intent.action : action;
  const displayedAmount = intent && intent.action !== "initialize" ? intent.amountAtomic : amountAtomic;
  const start = () => {
    if (!controller.current || controller.current.signal.aborted) controller.current = new AbortController();
    void run(true, controller.current.signal);
  };

  if (!matches) return <p className="py-6 text-center text-sm text-muted-foreground">Connect this account&apos;s wallet</p>;

  if (completed) return (
    <DrawerSuccess
      amount={0}
      amountLabel={amountLabel(completedAmount)}
      sentence={completed.action === "deposit" ? "Deposited into Kamino. It now earns the current supply rate." : "Withdrawn from Kamino to your USDC balance."}
      explorerUrl={completed.signature ? `https://explorer.solana.com/tx/${completed.signature}?cluster=devnet` : undefined}
      onDone={() => onDone?.()}
      secondaryHref="/home"
      secondaryLabel="Back to balances"
    />
  );

  if (running || recovering) return (
    <div role="status" aria-live="polite" aria-label="Processing operation" className="flex justify-center py-10">
      <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-3">
      {error ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {displayedAction === "deposit" ? "Couldn't deposit. Your funds stayed in your balance." : "Couldn't withdraw. Your funds stayed in Kamino."}
          </p>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Details</summary><p className="mt-2 break-words">{error}</p></details>
        </>
      ) : null}
      <Button className="w-full" onClick={start}
        disabled={!operation && !/^[1-9]\d*$/.test(amountAtomic)}>
        {error ? "Retry" : `${displayedAction === "deposit" ? "Deposit" : "Withdraw"} ${amountLabel(displayedAmount)}`}
      </Button>
    </div>
  );
}
