"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { CrossmintPath, MethodOption, TransakPath } from "@/components/app/onramp-methods";
import { MoonPayBuyPath } from "@/components/app/moonpay-paths";
import { IntebixKztePath } from "@/components/app/intebix-kzte-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import { KztEstimate } from "@/components/app/kzt-estimate";
import { useBankEmbed } from "@/lib/useBankEmbed";

type SuccessState = { amount: number; sentence: string; note?: string; explorerUrl?: string; currency?: "USD" | "KZT"; amountLabel?: string };
type AddMoneyDrawerProps = { open: boolean; onOpenChange: (open: boolean) => void };

function createFaucetRequestId() {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `faucet-${id}`;
}

export function AddMoneyDrawer(props: AddMoneyDrawerProps) {
  return <AddMoneyDrawerContent {...props} />;
}

function AddMoneyDrawerContent({ open, onOpenChange }: AddMoneyDrawerProps) {
  const devnet = useDevnet();
  const { marketData } = useAppStore();
  const bankEmbed = useBankEmbed();
  const [amount, setAmount] = useState("50");
  const [kztAmount, setKztAmount] = useState("25000");
  const [method, setMethod] = useState<string | null>(null);
  const [intebixSheetOpen, setIntebixSheetOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [bankPaymentPending, setBankPaymentPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bankRequestRef = useRef<{ id: string; amountUsd: number } | null>(null);
  const faucetActionRef = useRef<{ walletAddress: string; amount: number; requestId: string } | null>(null);
  const amountValue = Number(amount);
  const kztAmountValue = Number(kztAmount);
  const valid = Number.isFinite(amountValue) && amountValue >= 1 && amountValue <= 1000;
  const validKztAmount = Number.isInteger(kztAmountValue) && kztAmountValue >= 5_000 && kztAmountValue <= 1_000_000;
  // External rails remain a separately reviewed future adapter. The only
  // default path is a deliberately opt-in Devnet test-token issuer.
  const legacyFiatAdaptersEnabled = process.env.NEXT_PUBLIC_ENABLE_LEGACY_FIAT_ADAPTERS === "true";
  const methods = useMemo(
    () => !legacyFiatAdaptersEnabled
      ? ["devnet-faucet"]
      : bankEmbed
      ? ["bank-embed", "kzte-intebix", "devnet-faucet", "transak", "moonpay", "crossmint"]
      : ["devnet-faucet", "kzte-intebix", "transak", "moonpay", "crossmint"],
    [bankEmbed, legacyFiatAdaptersEnabled],
  );
  const selectedMethod = method ?? methods[0];

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setIntebixSheetOpen(false);
    setSuccess(null);
    setError(null);
    onOpenChange(nextOpen);
  };

  const complete = useCallback((value: number, sentence: string, note?: string, explorerUrl?: string, currency: "USD" | "KZT" = "USD", amountLabel?: string) => {
    setSuccess({ amount: value, sentence, note, explorerUrl, currency, amountLabel });
    void devnet.refreshPortfolio();
    toast.success("Баланс обновлён");
  }, [devnet]);

  const issueFaucetDollars = useCallback(async (value: number, source: "faucet" | "bank-embed") => {
    if (!devnet.legacyFaucetEnabled) {
      setError("Тестовый issuer выключен. Devnet-зачисление не создаёт фиатное пополнение.");
      return;
    }
    if (!devnet.walletAddress || processing) return;
    const priorAction = faucetActionRef.current;
    const requestId = priorAction
      && priorAction.walletAddress === devnet.walletAddress
      && priorAction.amount === value
      ? priorAction.requestId
      : createFaucetRequestId();
    // Keep an ambiguous action id for retry; the server never submits a second
    // mint for the same id and will return its already-completed signature.
    faucetActionRef.current = { walletAddress: devnet.walletAddress, amount: value, requestId };
    setProcessing(true);
    setError(null);
    try {
      const response = await fetch("/api/devnet/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: devnet.walletAddress, amountUsd: value, requestId, source }),
      });
      const result = await response.json() as { signature?: unknown; explorerUrl?: unknown; error?: unknown };
      if (!response.ok || typeof result.signature !== "string" || typeof result.explorerUrl !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось выпустить тестовые токены.");
      }
      faucetActionRef.current = null;
      complete(
        value,
        "DEVNET TEST FUNDING: тестовые единицы зачислены.",
        "Подтверждено в Solana Devnet; это не банковский или карточный платёж и не имеет денежной стоимости.",
        result.explorerUrl,
        "USD",
        `${formatQuantity(value)} TEST QUOTE`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось зачислить средства. Попробуйте ещё раз.");
    } finally {
      setProcessing(false);
    }
  }, [complete, devnet.legacyFaucetEnabled, devnet.walletAddress, processing]);

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
      description: "Пополнение баланса Plain",
    }, window.location.origin);
  };

  const selectAnotherMethod = useCallback(() => setMethod(methods[0]), [methods]);
  const closeIntebixSheet = useCallback(() => {
    setIntebixSheetOpen(false);
    setMethod(methods[0]);
  }, [methods]);
  const completeTransak = useCallback((credit: { amountUsd: number; signature: string; explorerUrl: string }) => {
    complete(credit.amountUsd, "Покупка подтверждена Transak. Тестовые доллары зачислены.", "Зачисление подтверждено в сети Solana devnet.", credit.explorerUrl);
  }, [complete]);

  const completeMoonPay = useCallback((credit: { amountUsd: number; signature: string; explorerUrl: string }) => {
    complete(credit.amountUsd, "Покупка подтверждена MoonPay. Тестовые доллары зачислены.", "Зачисление подтверждено в сети Solana devnet.", credit.explorerUrl);
  }, [complete]);

  const completeCrossmint = useCallback((value: number) => {
    complete(value, "Покупка подтверждена Crossmint.", "Данные кошелька обновлены.");
  }, [complete]);

  const completeIntebix = useCallback((result: { amountKzt: number; explorerUrl: string }) => {
    complete(
      result.amountKzt,
      "Переведено " + result.amountKzt.toLocaleString("ru-RU") + " KZTE из резерва Intebix.",
      "Оплата в сети Solana devnet. Квитанция будет отправлена на email аккаунта.",
      result.explorerUrl,
      "KZT",
      result.amountKzt.toLocaleString("ru-RU") + " ₸",
    );
  }, [complete]);

  return (
    <DrawerFrame open={open} onOpenChange={changeOpen} title="Подготовить Devnet-единицы" description="DEVNET TEST FUNDING · только Devnet-токены, без фиатного платежа.">
      {success ? (
        <DrawerSuccess amount={success.amount} currency={success.currency} amountLabel={success.amountLabel} sentence={success.sentence} note={success.note} explorerUrl={success.explorerUrl} onDone={() => changeOpen(false)} secondaryHref="/earn" secondaryLabel="Открыть вклад" />
      ) : (
        <div className="space-y-5">
          {selectedMethod === "kzte-intebix" ? (
            <div className="space-y-3">
              <label htmlFor="add-kzte-amount" className="text-sm font-medium">Сумма</label>
              <div className="flex items-center gap-2">
                <Input id="add-kzte-amount" type="number" min="5000" max="1000000" step="1" inputMode="numeric" value={kztAmount} onChange={(event) => setKztAmount(event.target.value)} className="h-11 text-lg tabular-nums" disabled={processing || bankPaymentPending} />
                <span className="text-sm font-medium">₸</span>
              </div>
              <p className="text-xs text-muted-foreground">≈ {formatMoney(kztAmountValue / marketData.rate.usdKzt, "USD")} по курсу НБ РК на {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(marketData.rate.asOf + "T12:00:00Z"))}</p>
              <p className="text-sm font-medium">Вы получите {Number.isFinite(kztAmountValue) ? kztAmountValue.toLocaleString("ru-RU") : "0"} KZTE</p>
              {!validKztAmount ? <p className="text-xs text-destructive">Укажите целую сумму от 5 000 до 1 000 000 ₸.</p> : null}
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor="add-amount" className="text-sm font-medium">Сумма</label>
              <div className="flex items-center gap-2">
                <Input id="add-amount" type="number" min="1" max="1000" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-11 text-lg tabular-nums" disabled={processing || bankPaymentPending} />
                <span className="text-sm font-medium">TEST QUOTE</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[30, 50, 100].map((value) => <Button key={value} type="button" variant={amount === String(value) ? "secondary" : "outline"} onClick={() => setAmount(String(value))} disabled={processing || bankPaymentPending}>{value} TEST</Button>)}
              </div>
              {legacyFiatAdaptersEnabled ? <KztEstimate usd={Number(amount) || 0} /> : <p className="text-xs text-muted-foreground">NO MONETARY VALUE · фиатные, карточные и KZT-адаптеры выключены.</p>}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Способ подготовки</p>
            {methods.map((id) => (
              <MethodOption
                key={id}
                id={id}
                selected={selectedMethod === id}
                onSelect={setMethod}
                disabled={processing || bankPaymentPending || (id === "devnet-faucet" && !devnet.legacyFaucetEnabled)}
              />
            ))}
            {!legacyFiatAdaptersEnabled && !devnet.legacyFaucetEnabled ? (
              <p className="rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
                Тестовый issuer выключен по умолчанию. Включайте его только для контролируемой Devnet-проверки;
                фиатный платёж, карта и KZT-пополнение не выполняются.
              </p>
            ) : null}
          </div>

          {selectedMethod === "bank-embed" ? (
            <Button className="w-full" onClick={requestBankPayment} disabled={!valid || processing || bankPaymentPending}>
              {bankPaymentPending ? "Ожидаем подтверждение банка…" : `Оплатить ${formatMoney(amountValue || 0)}`}
            </Button>
          ) : null}
          {selectedMethod === "devnet-faucet" ? (
            <Button className="w-full" onClick={() => void issueFaucetDollars(amountValue, "faucet")} disabled={!valid || processing || !devnet.legacyFaucetEnabled}>
              {processing ? "Зачисляем…" : devnet.legacyFaucetEnabled ? `Получить ${amountValue || 0} TEST QUOTE` : "Тестовый issuer недоступен"}
            </Button>
          ) : null}
          {selectedMethod === "kzte-intebix" ? (
            <>
              <Button className="w-full" onClick={() => setIntebixSheetOpen(true)} disabled={!validKztAmount}>
                Пополнить через Intebix
              </Button>
              {intebixSheetOpen ? (
                <IntebixKztePath
                  amountKzt={kztAmountValue}
                  usdKzt={marketData.rate.usdKzt}
                  asOf={marketData.rate.asOf}
                  validAmount={validKztAmount}
                  onComplete={completeIntebix}
                  onSelectAnotherMethod={closeIntebixSheet}
                />
              ) : null}
            </>
          ) : null}
          {selectedMethod === "transak" ? (
            <TransakPath amount={amountValue} onCompleteOnchain={completeTransak} onSelectAnotherMethod={selectAnotherMethod} />
          ) : null}
          {selectedMethod === "moonpay" ? (
            <MoonPayBuyPath amount={amountValue} onComplete={completeMoonPay} onSelectAnotherMethod={selectAnotherMethod} />
          ) : null}
          {selectedMethod === "crossmint" ? (
            <CrossmintPath amount={amountValue} onComplete={completeCrossmint} onSelectAnotherMethod={selectAnotherMethod} />
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {selectedMethod !== "kzte-intebix" && !valid ? <p className="text-xs text-destructive">Укажите сумму от 1 до 1 000 TEST QUOTE.</p> : null}
        </div>
      )}
    </DrawerFrame>
  );
}
