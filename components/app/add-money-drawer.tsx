"use client";

import { useCallback, useState } from "react";
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

type SuccessState = {
  amount: number;
  sentence: string;
  note?: string;
  explorerUrl?: string;
};

export function AddMoneyDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { topUp } = useAppStore();
  const devnet = useDevnet();
  const [amount, setAmount] = useState("50");
  const [method, setMethod] = useState("devnet-faucet");
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const amountValue = Number(amount);
  const valid = Number.isFinite(amountValue) && amountValue >= 1 && amountValue <= 1000;
  const methods = ["devnet-faucet", "transak", "moonpay", "crossmint", "mercuryo", "kaspi", "freedom"]
    .map((id) => ONRAMP_OPTIONS.find((option) => option.id === id))
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

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
    topUp(value, source, extra);
    setSuccess({ amount: value, sentence, note, explorerUrl: extra?.explorerUrl });
    if (extra?.onchain) void devnet.refresh();
    toast.success("Баланс пополнен");
  }, [devnet, topUp]);

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
      const source = method === "devnet-faucet" || method === "moonpay" || method === "crossmint" || method === "mercuryo" || method === "transak"
        ? `${method}-demo`
        : method;
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
                >
                  ${value}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              ≈ {formatMoney(Number(amount) || 0, "KZT")} по демо-курсу 480 ₸ за $1.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Способ пополнения</h3>
            <div className="space-y-2">
              {methods.map((option) => (
                <MethodOption
                  key={option.id}
                  id={option.id}
                  selected={method === option.id}
                  onSelect={setMethod}
                />
              ))}
            </div>
          </div>

          {open && method === "devnet-faucet" && valid ? (
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
          {open && method === "transak" && valid ? (
            <TransakPath
              amount={amountValue}
              onDemo={addMockMoney}
              onComplete={completeTransak}
              onCompleteOnchain={completeTransakOnchain}
              onSelectAnotherMethod={selectAnotherMethod}
            />
          ) : null}

          {open && !success ? (
            <div hidden={method !== "moonpay"}>
              <MoonPayBuyPath
                amount={amountValue}
                onDemo={addMockMoney}
                onComplete={completeMoonPay}
                onSelectAnotherMethod={selectAnotherMethod}
              />
            </div>
          ) : null}

          {open && method === "crossmint" && valid ? (
            <CrossmintPath
              amount={amountValue}
              onDemo={addMockMoney}
              onComplete={(value) => complete(value, "crossmint", "Сумма зачислена после оплаты картой.")}
              onSelectAnotherMethod={selectAnotherMethod}
              processing={processing}
            />
          ) : null}
          {open && method === "mercuryo" && valid ? (
            <MercuryoPath amount={amountValue} onDemo={addMockMoney} processing={processing} />
          ) : null}
          {open && (method === "kaspi" || method === "freedom") ? (
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
          <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
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
  const { login, status } = useCrossmintAuth();
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
        headers: { "Content-Type": "application/json" },
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
          <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
        </Button>
      </div>
    );
  }

  if (!serverConfigured) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Тестовый банкомат пока не настроен. Можно продолжить в демо-режиме.</p>
        <Button className="w-full" onClick={onDemo} disabled={processing}>
          <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Тестовые доллары появятся в кошельке после подтверждения транзакции.</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button className="w-full" onClick={requestFaucet} disabled={processing}>
        {processing ? "Выпускаем в сети…" : `Получить ${formatMoney(amount)}`}
      </Button>
    </div>
  );
}
