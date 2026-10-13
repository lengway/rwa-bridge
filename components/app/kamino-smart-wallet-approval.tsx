"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Chain, Wallet } from "@crossmint/wallets-sdk";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAtomicToDecimal } from "@/lib/earn-gateway";
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
  const [progress, setProgress] = useState("Подготавливаем…");
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<SmartWalletOperationStatus | null>(null);
  const [completedAmount, setCompletedAmount] = useState(amountAtomic);
  const latest = useRef(props);
  const currentOperation = useRef<StoredSmartWalletOperation | null>(null);
  const controller = useRef<AbortController | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const inFlight = useRef<AbortSignal | null>(null);
  useEffect(() => { latest.current = props; });

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
            return await Promise.race([
              context.wallet!.approve({ transactionId }),
              new Promise<never>((_, reject) => {
                timer = window.setTimeout(() => reject(new Error("Ответ кошелька прервался.")), 25_000);
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
        setProgress("Готово");
        latest.current.onCompleted?.(result);
      }
    } catch (cause) {
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

  if (!matches) return <Card className="rounded-2xl p-4">Подключите кошелёк этого аккаунта</Card>;

  if (completed) return (
    <Card className="gap-3 rounded-2xl p-4">
      <p className="flex items-center gap-2 font-medium"><Check className="size-4" />
        Готово — {amountLabel(completedAmount)} {completed.action === "deposit" ? "вложен в Kamino" : "выведен из Kamino"}
      </p>
      <a className="text-sm underline" href={`https://explorer.solana.com/tx/${completed.signature}?cluster=devnet`}
        target="_blank" rel="noopener noreferrer">Посмотреть транзакцию</a>
      <Button className="w-full" onClick={onDone}>Готово</Button>
    </Card>
  );

  return (
    <Card className="gap-4 rounded-2xl p-4">
      <p className="font-medium">Проверьте операцию</p>
      <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
        <Row label="Сумма" value={amountLabel(displayedAmount)} />
        <Row label="Маршрут" value="Kamino · Solana Devnet" />
        <Row label="Комиссия сети" value="Оплачивает Plain" />
      </div>
      {running || recovering ? (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
          {stalled ? "Операция ещё обрабатывается. Мы проверим её автоматически" : progress}
        </p>
      ) : null}
      {stalled ? <button className="text-left text-sm underline" onClick={() => wake.current?.()}>Проверить ещё раз</button> : null}
      {error ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {displayedAction === "deposit" ? "Не получилось вложить. Деньги остались на вашем балансе." : "Не получилось вывести. Деньги остались в Kamino."}
          </p>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Подробнее</summary><p className="mt-2 break-words">{error}</p></details>
        </>
      ) : null}
      {!running && !recovering ? <Button className="w-full" onClick={start}
        disabled={!operation && !/^[1-9]\d*$/.test(amountAtomic)}>
        {error ? "Повторить" : `${displayedAction === "deposit" ? "Вложить" : "Вывести"} ${amountLabel(displayedAmount)}`}
      </Button> : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>;
}
