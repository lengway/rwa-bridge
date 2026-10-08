"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { CrossmintPath, MercuryoPath, MethodOption, TransakPath } from "@/components/app/onramp-methods";
import { MoonPayBuyPath } from "@/components/app/moonpay-paths";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { ONRAMP_OPTIONS } from "@/lib/onramps";
import { useAppStore } from "@/lib/store";
import { isCrossmintConfigured } from "@/lib/config";
import { useDevnet } from "@/lib/useDevnet";
import { KztEstimate } from "@/components/app/kzt-estimate";
import { useBankEmbed } from "@/lib/useBankEmbed";

type SuccessState = {
  amount: number;
  sentence: string;
  note?: string;
  explorerUrl?: string;
};

type AddMoneyDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddMoneyDrawer(props: AddMoneyDrawerProps) {
  if (!isCrossmintConfigured) return <AddMoneyDrawerContent {...props} jwt={null} />;
  return <AddMoneyDrawerWithAuth {...props} />;
}

function AddMoneyDrawerWithAuth(props: AddMoneyDrawerProps) {
  const { jwt } = useCrossmintAuth();
  return <AddMoneyDrawerContent {...props} jwt={jwt ?? null} />;
}

function AddMoneyDrawerContent({
  open,
  onOpenChange,
  jwt,
}: AddMoneyDrawerProps & { jwt: string | null }) {
  const { topUp, marketData } = useAppStore();
  const devnet = useDevnet();
  const bankEmbed = useBankEmbed();
  const [amount, setAmount] = useState("50");
  const [method, setMethod] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [bankPaymentPending, setBankPaymentPending] = useState(false);
  const [bankMessage, setBankMessage] = useState<string | null>(null);
  const bankRequestRef = useRef<{ id: string; amountUsd: number } | null>(null);
  const amountValue = Number(amount);
  const valid = Number.isFinite(amountValue) && amountValue >= 1 && amountValue <= 1000;
  const methods = (bankEmbed
    ? ["devnet-faucet", "transak", "moonpay", "crossmint", "mercuryo"]
    : ["devnet-faucet", "transak", "moonpay", "crossmint", "mercuryo", "kaspi", "freedom"])
    .map((id) => ONRAMP_OPTIONS.find((option) => option.id === id))
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

  const selectedMethod = method ?? (bankEmbed ? "bank-demo" : "devnet-faucet");

  const changeOpen = (nextOpen: boolean) => {
    setSuccess(null);
    onOpenChange(nextOpen);
  };

  const complete = useCallback((
    value: number,
    source: string,
    sentence: string,
    note?: string,
    extra?: { onchain?: boolean; signature?: string; explorerUrl?: string },
  ) => {
    if (!extra?.onchain) topUp(value, source, extra);
    setSuccess({ amount: value, sentence, note, explorerUrl: extra?.explorerUrl });
    if (extra?.onchain) void devnet.refresh();
    toast.success("Баланс пополнен");
  }, [devnet, topUp]);

  const handleBankPaymentResult = useCallback(async (request: { id: string; amountUsd: number }) => {
    if (devnet.mode === "devnet" && devnet.walletAddress) {
      setProcessing(true);
      setBankMessage(null);
      try {
        const response = await fetch("/api/devnet/faucet", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          },
          body: JSON.stringify({ walletAddress: devnet.walletAddress, amountUsd: request.amountUsd, source: "bank-demo" }),
        });
        const result = await response.json() as { signature?: unknown; explorerUrl?: unknown; error?: unknown };
        if (!response.ok || typeof result.signature !== "string" || typeof result.explorerUrl !== "string") {
          throw new Error(typeof result.error === "string" ? result.error : "Не удалось выпустить тестовые доллары.");
        }
        complete(
          request.amountUsd,
          "bank-demo",
          "Оплата подтверждена в приложении Демо-банка.",
          "Тестовые доллары выпущены в Solana devnet.",
          { onchain: true, signature: result.signature, explorerUrl: result.explorerUrl },
        );
      } catch {
        setBankMessage("Банк подтвердил оплату, но не удалось выпустить тестовые доллары. Попробуйте позже.");
      } finally {
        setProcessing(false);
      }
      return;
    }

    complete(
      request.amountUsd,
      "bank-demo",
      "Оплата подтверждена в приложении Демо-банка.",
      "Тестовая оплата — деньги не списываются.",
    );
  }, [complete, devnet.mode, devnet.walletAddress, jwt]);

  useEffect(() => {
    if (!bankEmbed) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (typeof event.data !== "object" || event.data === null) return;
      const data = event.data as { type?: unknown; id?: unknown; status?: unknown };
      const request = bankRequestRef.current;
      if (
        data.type !== "rwa-bridge:payment-result"
        || typeof data.id !== "string"
        || !request
        || data.id !== request.id
      ) return;

      bankRequestRef.current = null;
      setBankPaymentPending(false);
      if (data.status === "cancelled") {
        setBankMessage("Оплата отменена");
        toast.error("Оплата отменена");
      } else if (data.status === "paid") {
        void handleBankPaymentResult(request);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bankEmbed, handleBankPaymentResult]);

  const requestBankPayment = () => {
    if (!valid || bankPaymentPending || processing || !bankEmbed) return;
    const request = {
      id: window.crypto.randomUUID(),
      amountUsd: amountValue,
    };
    bankRequestRef.current = request;
    setBankMessage(null);
    setBankPaymentPending(true);
    window.parent.postMessage({
      type: "rwa-bridge:payment-request",
      id: request.id,
      amountUsd: request.amountUsd,
      amountKzt: request.amountUsd * marketData.rate.usdKzt,
      description: "Пополнение баланса RWA Bridge",
    }, window.location.origin);
  };

  const selectAnotherMethod = useCallback(() => {
    setMethod("");
  }, []);

  const completeTransak = useCallback(
    (value: number) => complete(value, "transak", "Сумма зачислена после оплаты картой."),
    [complete],
  );

  const completeTransakOnchain = useCallback((credit: {
    amountUsd: number;
    signature: string;
    explorerUrl: string;
  }) => complete(
    credit.amountUsd,
    "transak",
    "Покупка подтверждена Transak. Тестовые доллары зачислены в Solana devnet.",
    "Сумма зачислена после серверной проверки заказа Transak.",
    { onchain: true, signature: credit.signature, explorerUrl: credit.explorerUrl },
  ), [complete]);

  const completeMoonPay = useCallback((
    value: number,
    extra?: { onchain?: boolean; signature?: string; explorerUrl?: string },
  ) => complete(
    value,
    "moonpay",
    "Покупка подтверждена MoonPay. Сумма отражена в балансе приложения.",
    "В тестовом режиме MoonPay покупается тестовый SOL, а в devnet на баланс зачисляются тестовые доллары на сумму покупки.",
    extra,
  ), [complete]);

  const addMockMoney = () => {
    if (!valid || processing) return;
    setProcessing(true);
    window.setTimeout(() => {
      const source = selectedMethod === "devnet-faucet" || selectedMethod === "moonpay" || selectedMethod === "crossmint" || selectedMethod === "mercuryo" || selectedMethod === "transak"
        ? `${selectedMethod}-demo`
        : selectedMethod;
      complete(
        amountValue,
        source,
        "Сумма зачислена на демо-баланс.",
        "Деньги не списывались. Это демо-пополнение.",
      );
      setProcessing(false);
    }, 450);
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="Пополнить баланс"
      description="Сначала выберите сумму, затем способ. Все суммы показаны в долларах."
    >
      {success ? (
        <DrawerSuccess
          amount={success.amount}
          sentence={success.sentence}
          note={success.note}
          explorerUrl={success.explorerUrl}
          onDone={() => changeOpen(false)}
          secondaryHref="/earn"
          secondaryLabel="Открыть вклад"
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            <label htmlFor="add-amount" className="text-sm font-medium">Сумма</label>
            <div className="flex items-center gap-2">
              <Input
                id="add-amount"
                type="number"
                min="1"
                max="1000"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-11 text-lg tabular-nums"
                disabled={processing || bankPaymentPending}
              />
              <span className="text-sm font-medium">USD</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[30, 50, 100].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={amount === String(value) ? "secondary" : "outline"}
                  onClick={() => setAmount(String(value))}
                  disabled={processing || bankPaymentPending}
                >
                  ${value}
                </Button>
              ))}
            </div>
            <KztEstimate usd={Number(amount) || 0} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Способ пополнения</h3>
            <div className="space-y-2">
              {bankEmbed ? (
                <MethodOption
                  key="bank-demo"
                  id="bank-demo"
                  selected={selectedMethod === "bank-demo"}
                  onSelect={setMethod}
                  disabled={processing || bankPaymentPending}
                  hideRecommended
                />
              ) : null}
              {methods.map((option) => (
                <MethodOption
                  key={option.id}
                  id={option.id}
                  selected={selectedMethod === option.id}
                  onSelect={setMethod}
                  disabled={processing}
                  hideRecommended={bankEmbed}
                />
              ))}
            </div>
          </div>

          {open && selectedMethod === "bank-demo" && valid ? (
            <div className="space-y-3">
              {bankPaymentPending ? (
                <p role="status" className="rounded-xl bg-muted px-3 py-3 text-sm text-muted-foreground">
                  Подтвердите оплату в приложении банка…
                </p>
              ) : null}
              {bankMessage ? <p className="text-xs text-muted-foreground">{bankMessage}</p> : null}
              <Button className="w-full" onClick={requestBankPayment} disabled={bankPaymentPending || processing}>
                {processing ? "Подтверждаем в сети…" : bankPaymentPending ? "Ожидаем подтверждения…" : `Пополнить ${formatMoney(amountValue)}`}
              </Button>
            </div>
          ) : null}

      {open && selectedMethod === "devnet-faucet" && valid ? (
            <DevnetFaucetPath
              amount={amountValue}
              serverConfigured={Boolean(devnet.usdMint && devnet.treasury)}
              onDemo={addMockMoney}
              processing={processing}
              setProcessing={setProcessing}
              onComplete={(signature, explorer) => complete(
                amountValue,
                "devnet-faucet",
                "Тестовые доллары выпущены в Solana devnet.",
                undefined,
                { onchain: true, signature, explorerUrl: explorer },
              )}
            />
          ) : null}
          {open && selectedMethod === "transak" && valid ? (
            <TransakPath
              amount={amountValue}
              onDemo={addMockMoney}
              processing={processing}
              onComplete={completeTransak}
              onCompleteOnchain={completeTransakOnchain}
              onSelectAnotherMethod={selectAnotherMethod}
            />
          ) : null}

          {open && !success ? (
            <div hidden={selectedMethod !== "moonpay"}>
              <MoonPayBuyPath
                amount={amountValue}
                onDemo={addMockMoney}
                processing={processing}
                onComplete={completeMoonPay}
                onSelectAnotherMethod={selectAnotherMethod}
              />
            </div>
          ) : null}

          {open && selectedMethod === "crossmint" && valid ? (
            <CrossmintPath
              amount={amountValue}
              onDemo={addMockMoney}
              onComplete={(value) => complete(value, "crossmint", "Сумма зачислена после оплаты картой.")}
              onSelectAnotherMethod={selectAnotherMethod}
              processing={processing}
            />
          ) : null}
          {open && selectedMethod === "mercuryo" && valid ? (
            <MercuryoPath amount={amountValue} onDemo={addMockMoney} processing={processing} />
          ) : null}
          {open && (selectedMethod === "kaspi" || selectedMethod === "freedom") ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Это концепт. Деньги не списываются, баланс изменится только в демо-режиме.
              </p>
              <Button className="w-full" onClick={addMockMoney} disabled={!valid || processing}>
                <Plus />
                {processing ? "Зачисляем…" : `Продолжить в демо-режиме · ${formatMoney(amountValue || 0)}`}
              </Button>
            </div>
          ) : null}
          {!valid ? (
            <p className="text-xs text-destructive">Введите сумму от $1 до $1 000.</p>
          ) : null}
        </div>
      )}
    </DrawerFrame>
  );
}

function DevnetFaucetPath({
  amount,
  serverConfigured,
  onDemo,
  processing,
  setProcessing,
  onComplete,
}: {
  amount: number;
  serverConfigured: boolean;
  onDemo: () => void;
  processing: boolean;
  setProcessing: (value: boolean) => void;
  onComplete: (signature: string, explorerUrl: string) => void;
}) {
  if (!isCrossmintConfigured) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Войдите с настроенным Crossmint-кошельком, чтобы получить тестовые доллары в сети.</p>
        <Button className="w-full" onClick={onDemo} disabled={processing}>
          <Plus />{processing ? "Зачисляем…" : `Продолжить в демо-режиме · ${formatMoney(amount)}`}
        </Button>
      </div>
    );
  }
  return (
    <DevnetFaucetReady
      amount={amount}
      serverConfigured={serverConfigured}
      onDemo={onDemo}
      processing={processing}
      setProcessing={setProcessing}
      onComplete={onComplete}
    />
  );
}

function DevnetFaucetReady({
  amount,
  serverConfigured,
  onDemo,
  processing,
  setProcessing,
  onComplete,
}: {
  amount: number;
  serverConfigured: boolean;
  onDemo: () => void;
  processing: boolean;
  setProcessing: (value: boolean) => void;
  onComplete: (signature: string, explorerUrl: string) => void;
}) {
  const { login, status, jwt } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const ready = status === "logged-in" && wallet?.address;

  const requestFaucet = async () => {
    if (!wallet?.address || processing) return;
    setProcessing(true);
    setError(null);
    try {
      const response = await fetch("/api/devnet/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ walletAddress: wallet.address, amountUsd: amount }),
      });
      const result = await response.json() as { signature?: unknown; explorerUrl?: unknown; error?: unknown };
      if (!response.ok || typeof result.signature !== "string" || typeof result.explorerUrl !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось пополнить баланс.");
      }
      onComplete(result.signature, result.explorerUrl);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось получить тестовые доллары. Повторите попытку позже.");
    } finally {
      setProcessing(false);
    }
  };

  if (!ready) {
    const loading = status === "initializing" || status === "in-progress" || walletStatus === "in-progress";
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Войдите, чтобы тестовые доллары поступили в ваш кошелёк.</p>
        <Button variant="outline" className="w-full" onClick={login} disabled={loading}>
          {loading ? "Загружаем…" : "Войти"}
        </Button>
        <Button className="w-full" onClick={onDemo} disabled={processing}>
          <Plus />{processing ? "Зачисляем…" : `Продолжить в демо-режиме · ${formatMoney(amount)}`}
        </Button>
      </div>
    );
  }

  if (!serverConfigured) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Тестовый банкомат пока не настроен. Можно продолжить в демо-режиме.</p>
        <Button className="w-full" onClick={onDemo} disabled={processing}>
          <Plus />{processing ? "Зачисляем…" : `Продолжить в демо-режиме · ${formatMoney(amount)}`}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Тестовые доллары появятся в кошельке после подтверждения транзакции.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button className="w-full" onClick={requestFaucet} disabled={processing}>
        {processing ? "Подтверждаем в сети…" : `Получить ${formatMoney(amount)}`}
      </Button>
    </div>
  );
}
