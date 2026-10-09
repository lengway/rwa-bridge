"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { CrossmintPath, MethodOption, TransakPath } from "@/components/app/onramp-methods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import { KztEstimate } from "@/components/app/kzt-estimate";
import { useBankEmbed } from "@/lib/useBankEmbed";

type SuccessState = { amount: number; sentence: string; note?: string; explorerUrl?: string };
type AddMoneyDrawerProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function AddMoneyDrawer(props: AddMoneyDrawerProps) {
  return <AddMoneyDrawerContent {...props} />;
}

function AddMoneyDrawerContent({ open, onOpenChange }: AddMoneyDrawerProps) {
  const devnet = useDevnet();
  const { marketData } = useAppStore();
  const bankEmbed = useBankEmbed();
  const [amount, setAmount] = useState("50");
  const [method, setMethod] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [bankPaymentPending, setBankPaymentPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bankRequestRef = useRef<{ id: string; amountUsd: number } | null>(null);
  const amountValue = Number(amount);
  const valid = Number.isFinite(amountValue) && amountValue >= 1 && amountValue <= 1000;
  const methods = useMemo(
    () => bankEmbed ? ["bank-embed", "devnet-faucet", "transak", "crossmint"] : ["devnet-faucet", "transak", "crossmint"],
    [bankEmbed],
  );
  const selectedMethod = method ?? methods[0];

  const changeOpen = (nextOpen: boolean) => {
    setSuccess(null);
    setError(null);
    onOpenChange(nextOpen);
  };

  const complete = useCallback((value: number, sentence: string, note?: string, explorerUrl?: string) => {
    setSuccess({ amount: value, sentence, note, explorerUrl });
    void devnet.refreshPortfolio();
    toast.success("Баланс обновлён");
  }, [devnet]);

  const issueFaucetDollars = useCallback(async (value: number, source: "faucet" | "bank-embed") => {
    if (!devnet.walletAddress || processing) return;
    setProcessing(true);
    setError(null);
    try {
      const response = await fetch("/api/devnet/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: devnet.walletAddress, amountUsd: value, source }),
      });
      const result = await response.json() as { signature?: unknown; explorerUrl?: unknown; error?: unknown };
      if (!response.ok || typeof result.signature !== "string" || typeof result.explorerUrl !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось выпустить тестовые доллары.");
      }
      complete(value, source === "bank-embed" ? "Оплата подтверждена в приложении банка." : "Тестовые доллары зачислены.", "Подтверждено в сети Solana devnet.", result.explorerUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось зачислить средства. Попробуйте ещё раз.");
    } finally {
      setProcessing(false);
    }
  }, [complete, devnet.walletAddress, processing]);

  const handleBankPaymentResult = useCallback((request: { id: string; amountUsd: number }) => {
    void issueFaucetDollars(request.amountUsd, "bank-embed");
  }, [issueFaucetDollars]);

  useEffect(() => {
    if (!bankEmbed) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (typeof event.data !== "object" || event.data === null) return;
      const data = event.data as { type?: unknown; id?: unknown; status?: unknown };
      const request = bankRequestRef.current;
      if (data.type !== "rwa-bridge:payment-result" || typeof data.id !== "string" || !request || data.id !== request.id) return;
      bankRequestRef.current = null;
      setBankPaymentPending(false);
      if (data.status === "cancelled") {
        setError("Оплата отменена");
        toast.error("Оплата отменена");
      } else if (data.status === "paid") {
        handleBankPaymentResult(request);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bankEmbed, handleBankPaymentResult]);

  const requestBankPayment = () => {
    if (!valid || bankPaymentPending || processing || !bankEmbed) return;
    const request = { id: window.crypto.randomUUID(), amountUsd: amountValue };
    bankRequestRef.current = request;
    setError(null);
    setBankPaymentPending(true);
    window.parent.postMessage({
      type: "rwa-bridge:payment-request",
      id: request.id,
      amountUsd: request.amountUsd,
      amountKzt: request.amountUsd * marketData.rate.usdKzt,
      description: "Пополнение баланса RWA Bridge",
    }, window.location.origin);
  };

  const selectAnotherMethod = useCallback(() => setMethod(methods[0]), [methods]);
  const completeTransak = useCallback((credit: { amountUsd: number; signature: string; explorerUrl: string }) => {
    complete(credit.amountUsd, "Покупка подтверждена Transak. Тестовые доллары зачислены.", "Зачисление подтверждено в сети Solana devnet.", credit.explorerUrl);
  }, [complete]);

  const completeCrossmint = useCallback((value: number) => {
    complete(value, "Покупка подтверждена Crossmint.", "Данные кошелька обновлены.");
  }, [complete]);

  return (
    <DrawerFrame open={open} onOpenChange={changeOpen} title="Пополнить баланс" description="Выберите сумму и способ пополнения.">
      {success ? (
        <DrawerSuccess amount={success.amount} sentence={success.sentence} note={success.note} explorerUrl={success.explorerUrl} onDone={() => changeOpen(false)} secondaryHref="/earn" secondaryLabel="Открыть вклад" />
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            <label htmlFor="add-amount" className="text-sm font-medium">Сумма</label>
            <div className="flex items-center gap-2">
              <Input id="add-amount" type="number" min="1" max="1000" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-11 text-lg tabular-nums" disabled={processing || bankPaymentPending} />
              <span className="text-sm font-medium">USD</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[30, 50, 100].map((value) => <Button key={value} type="button" variant={amount === String(value) ? "secondary" : "outline"} onClick={() => setAmount(String(value))} disabled={processing || bankPaymentPending}>{formatMoney(value)}</Button>)}
            </div>
            <KztEstimate usd={Number(amount) || 0} />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Способ пополнения</p>
            {methods.map((id) => <MethodOption key={id} id={id} selected={selectedMethod === id} onSelect={setMethod} disabled={processing || bankPaymentPending} />)}
          </div>

          {selectedMethod === "bank-embed" ? (
            <Button className="w-full" onClick={requestBankPayment} disabled={!valid || processing || bankPaymentPending}>
              {bankPaymentPending ? "Ожидаем подтверждение банка…" : `Оплатить ${formatMoney(amountValue || 0)}`}
            </Button>
          ) : null}
          {selectedMethod === "devnet-faucet" ? (
            <Button className="w-full" onClick={() => void issueFaucetDollars(amountValue, "faucet")} disabled={!valid || processing}>
              {processing ? "Зачисляем…" : `Получить ${formatMoney(amountValue || 0)}`}
            </Button>
          ) : null}
          {selectedMethod === "transak" ? (
            <TransakPath amount={amountValue} onCompleteOnchain={completeTransak} onSelectAnotherMethod={selectAnotherMethod} />
          ) : null}
          {selectedMethod === "crossmint" ? (
            <CrossmintPath amount={amountValue} onComplete={completeCrossmint} onSelectAnotherMethod={selectAnotherMethod} />
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {!valid ? <p className="text-xs text-destructive">Укажите сумму от $1 до $1 000.</p> : null}
        </div>
      )}
    </DrawerFrame>
  );
}
