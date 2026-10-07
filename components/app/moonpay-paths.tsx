"use client";

import { useEffect, useRef, useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { isCrossmintConfigured } from "@/lib/config";
import { useDevnet } from "@/lib/useDevnet";

type MoonPaySetup = {
  configured: boolean;
  environment: "sandbox" | "production";
  canSign: boolean;
};

type WidgetResponse = {
  url?: unknown;
  externalTransactionId?: unknown;
  error?: unknown;
};

type MoonPayIpResponse = {
  ipAddress?: unknown;
  isBuyAllowed?: unknown;
  isSellAllowed?: unknown;
};

const SIGNING_MESSAGE = "Добавьте MOONPAY_SECRET_KEY в .env.local, чтобы подписывать ссылку MoonPay.";
const IFRAME_ALLOW = "accelerometer; autoplay; camera; gyroscope; payment";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;
const SANDBOX_BUY_NOTE = "Тестовый режим MoonPay: покупается тестовый SOL, а на баланс зачисляются тестовые доллары на сумму покупки.";

async function getMoonPayIp(flow: "buy" | "sell") {
  const apiKey = process.env.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY;
  if (!apiKey) throw new Error("Добавьте NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY в .env.local для подключения MoonPay.");

  const url = new URL("https://api.moonpay.com/v4/ip_address");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось проверить доступность MoonPay в вашей стране.");

  const result = await response.json().catch(() => null) as MoonPayIpResponse | null;
  const allowed = flow === "buy" ? result?.isBuyAllowed : result?.isSellAllowed;
  if (typeof result?.ipAddress !== "string" || typeof allowed !== "boolean") {
    throw new Error("Не удалось проверить доступность MoonPay в вашей стране.");
  }
  return { ipAddress: result.ipAddress, allowed };
}

function TestCardDetails({ flow }: { flow: "buy" | "sell" }) {
  return (
    <details className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">Тестовые данные</summary>
      {flow === "buy" ? (
        <p className="mt-2 leading-5">
          Visa · 4242 4242 4242 4242 · срок 12/2030 · CVC 123 (3DS Challenge, UK).
          Для тестового аккаунта MoonPay рекомендует адрес США или Великобритании.
        </p>
      ) : (
        <p className="mt-2 leading-5">
          Карта для тестовой выплаты: Visa · 4000 0209 5159 5032 · срок 12/2030 · CVC 123.
        </p>
      )}
    </details>
  );
}

function useMoonPaySetup() {
  const [setup, setSetup] = useState<MoonPaySetup | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/moonpay/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        return response.json() as Promise<MoonPaySetup>;
      })
      .then((value) => {
        if (!cancelled) setSetup(value);
      })
      .catch(() => {
        if (!cancelled) setSetup({ configured: false, environment: "sandbox", canSign: false });
      });
    return () => { cancelled = true; };
  }, []);

  return setup;
}

function MoonPayFallback({
  message,
  amount,
  environment,
  onDemo,
  onSelectAnotherMethod,
}: {
  message: string;
  amount: number;
  environment: "sandbox" | "production";
  onDemo: () => void;
  onSelectAnotherMethod: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{message}</p>
      {environment === "sandbox" ? <p className="text-xs text-muted-foreground">{SANDBOX_BUY_NOTE}</p> : null}
      <p className="text-xs text-muted-foreground">
        Тестовый режим MoonPay: данные для проверки личности не проверяются, используйте тестовую карту из подсказки.
      </p>
      <TestCardDetails flow="buy" />
      <Button className="w-full" onClick={onDemo}>
        <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
      </Button>
      <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>
        Выбрать другой способ
      </Button>
    </div>
  );
}

export function MoonPayBuyPath({
  amount,
  onDemo,
  onComplete,
  onSelectAnotherMethod,
  onWidgetVisibilityChange,
}: {
  amount: number;
  onDemo: () => void;
  onComplete: (amountUsd: number, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => void;
  onSelectAnotherMethod: () => void;
  onWidgetVisibilityChange: (visible: boolean) => void;
}) {
  const setup = useMoonPaySetup();
  if (!setup) return <p className="text-xs text-muted-foreground">Проверяем настройки MoonPay…</p>;
  if (!setup.configured) {
    return (
      <MoonPayFallback
        message="Добавьте NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY в .env.local, чтобы подключить MoonPay."
        amount={amount}
        environment={setup.environment}
        onDemo={onDemo}
        onSelectAnotherMethod={onSelectAnotherMethod}
      />
    );
  }
  if (!setup.canSign) {
    return (
      <MoonPayFallback
        message={SIGNING_MESSAGE}
        amount={amount}
        environment={setup.environment}
        onDemo={onDemo}
        onSelectAnotherMethod={onSelectAnotherMethod}
      />
    );
  }
  if (!isCrossmintConfigured) {
    return (
      <MoonPayFallback
        message="Для привязки покупки MoonPay к кошельку настройте вход по email через Crossmint."
        amount={amount}
        environment={setup.environment}
        onDemo={onDemo}
        onSelectAnotherMethod={onSelectAnotherMethod}
      />
    );
  }

  return (
    <MoonPayBuyReady
      amount={amount}
      environment={setup.environment}
      onDemo={onDemo}
      onComplete={onComplete}
      onSelectAnotherMethod={onSelectAnotherMethod}
      onWidgetVisibilityChange={onWidgetVisibilityChange}
    />
  );
}

function MoonPayBuyReady({
  amount,
  environment,
  onDemo,
  onComplete,
  onSelectAnotherMethod,
  onWidgetVisibilityChange,
}: {
  amount: number;
  environment: "sandbox" | "production";
  onDemo: () => void;
  onComplete: (amountUsd: number, extra?: { onchain?: boolean; signature?: string; explorerUrl?: string }) => void;
  onSelectAnotherMethod: () => void;
  onWidgetVisibilityChange: (visible: boolean) => void;
}) {
  const { login, status } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [externalTransactionId, setExternalTransactionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderFailed, setOrderFailed] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [countryUnavailable, setCountryUnavailable] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const opening = useRef(false);
  const completed = useRef(false);

  const openWidget = async () => {
    if (amount < 5 || !wallet?.address || opening.current || widgetUrl) return;
    opening.current = true;
    completed.current = false;
    setLoading(true);
    setError(null);
    setCountryUnavailable(false);
    setOrderFailed(false);
    setPollTimedOut(false);
    try {
      const customer = await getMoonPayIp("buy");
      if (!customer.allowed) {
        setCountryUnavailable(true);
        return;
      }
      const response = await fetch("/api/moonpay/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "buy", walletAddress: wallet.address, amountUsd: amount, userIp: customer.ipAddress }),
      });
      const result = await response.json().catch(() => null) as WidgetResponse | null;
      if (!response.ok || typeof result?.url !== "string" || typeof result.externalTransactionId !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : "Не удалось открыть MoonPay.");
      }

      const parsedUrl = new URL(result.url);
      const expectedHost = environment === "sandbox" ? "buy-sandbox.moonpay.com" : "buy.moonpay.com";
      if (parsedUrl.hostname !== expectedHost) throw new Error("MoonPay вернул ссылку для другой среды.");
      setExternalTransactionId(result.externalTransactionId);
      setWidgetUrl(parsedUrl.toString());
      onWidgetVisibilityChange(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось открыть MoonPay.");
    } finally {
      opening.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!widgetUrl || !externalTransactionId || !wallet?.address) return;
    let active = true;
    let timer: number | undefined;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let requestPending = false;

    const poll = async () => {
      if (!active || requestPending) return;
      if (Date.now() >= deadline) {
        setPollTimedOut(true);
        return;
      }
      requestPending = true;
      try {
        const response = await fetch("/api/moonpay/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalTransactionId, walletAddress: wallet.address, flow: "buy" }),
        });
        const result = await response.json().catch(() => null) as {
          pending?: unknown;
          amountUsd?: unknown;
          signature?: unknown;
          explorerUrl?: unknown;
          error?: unknown;
        } | null;
        if (response.status === 202 || result?.pending === true) return;
        if (response.status === 409) {
          setOrderFailed(true);
          setError(typeof result?.error === "string" ? result.error : "Оплата не прошла. Попробуйте ещё раз.");
          active = false;
          setWidgetUrl(null);
          setExternalTransactionId(null);
          onWidgetVisibilityChange(false);
          return;
        }
        if (!response.ok) {
          setError(typeof result?.error === "string" ? result.error : "Не удалось проверить покупку MoonPay.");
          return;
        }
        if (typeof result?.amountUsd !== "number" || completed.current) return;
        completed.current = true;
        active = false;
        setWidgetUrl(null);
        setExternalTransactionId(null);
        onWidgetVisibilityChange(false);
        onComplete(result.amountUsd, {
          ...(typeof result.signature === "string" ? { onchain: true, signature: result.signature } : {}),
          ...(typeof result.explorerUrl === "string" ? { explorerUrl: result.explorerUrl } : {}),
        });
      } catch {
        // Keep polling while the widget remains open; network errors are transient here.
      } finally {
        requestPending = false;
        if (active) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [externalTransactionId, onComplete, onWidgetVisibilityChange, wallet?.address, widgetUrl]);

  if (status !== "logged-in") {
    const authLoading = status === "initializing" || status === "in-progress";
    return (
      <div className="space-y-3">
        {environment === "sandbox" ? <p className="text-xs text-muted-foreground">{SANDBOX_BUY_NOTE}</p> : null}
        <p className="text-xs text-muted-foreground">
          Тестовый режим MoonPay: данные для проверки личности не проверяются, используйте тестовую карту из подсказки.
        </p>
        <TestCardDetails flow="buy" />
        <p className="text-xs text-muted-foreground">Войдите, чтобы привязать покупку MoonPay к своему кошельку.</p>
        <Button variant="outline" className="w-full" onClick={login} disabled={authLoading}>
          {authLoading ? "Загружаем…" : "Войти"}
        </Button>
        <Button className="w-full" onClick={onDemo}><Plus />Продолжить в демо-режиме · {formatMoney(amount)}</Button>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Выбрать другой способ</Button>
      </div>
    );
  }
  if (!wallet?.address || walletStatus === "in-progress") {
    return <p className="text-xs text-muted-foreground">Подготавливаем кошелёк…</p>;
  }

  return (
    <div className={widgetUrl ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
      {environment === "sandbox" ? <p className="text-xs text-muted-foreground">{SANDBOX_BUY_NOTE}</p> : null}
      <p className="text-xs text-muted-foreground">
        Тестовый режим MoonPay: данные для проверки личности не проверяются, используйте тестовую карту из подсказки.
      </p>
      <TestCardDetails flow="buy" />
      {widgetUrl ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
          <iframe
            ref={iframeRef}
            src={widgetUrl}
            title={`MoonPay — покупка ${environment === "sandbox" ? "SOL" : "USDC"}`}
            className="h-full w-full border-0"
            allow={IFRAME_ALLOW}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
      {!widgetUrl ? (
        <p className="text-xs text-muted-foreground">
          {countryUnavailable
            ? "MoonPay недоступен в вашей стране."
            : amount < 5
            ? "Минимальная сумма покупки через MoonPay — $5."
            : `Откроется MoonPay ${environment === "sandbox" ? "Sandbox" : ""} для покупки ${environment === "sandbox" ? "SOL" : "USDC"}.`}
        </p>
      ) : null}
      {loading ? <p className="text-xs text-muted-foreground">Открываем MoonPay…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {pollTimedOut ? <p className="text-xs text-muted-foreground">Проверка остановлена через 15 минут. Оставьте виджет открытым и повторите проверку позже.</p> : null}
      {orderFailed ? <p className="text-xs text-destructive">Оплата не прошла. Попробуйте ещё раз.</p> : null}
      {!widgetUrl && !loading && amount >= 5 && !countryUnavailable ? (
        <Button className="w-full" onClick={openWidget} disabled={loading}>
          {error ? "Повторить" : `Открыть MoonPay · ${formatMoney(amount)}`}
        </Button>
      ) : null}
      {!widgetUrl ? (
        <Button variant="outline" className="w-full" onClick={onDemo}>
          <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
        </Button>
      ) : null}
      <Button
        variant="outline"
        className="w-full shrink-0"
        onClick={() => {
          setWidgetUrl(null);
          setExternalTransactionId(null);
          onWidgetVisibilityChange(false);
          onSelectAnotherMethod();
        }}
      >
        Выбрать другой способ
      </Button>
    </div>
  );
}

type WithdrawalDetails = {
  onchain?: boolean;
  signature?: string;
  explorerUrl?: string;
  note: string;
};

export function MoonPaySellPath({
  amount,
  validAmount,
  onWithdrawal,
  onSelectAnotherMethod,
  onWidgetVisibilityChange,
}: {
  amount: number;
  validAmount: boolean;
  onWithdrawal: (amount: number, details: WithdrawalDetails) => boolean;
  onSelectAnotherMethod: () => void;
  onWidgetVisibilityChange: (visible: boolean) => void;
}) {
  const setup = useMoonPaySetup();
  const devnet = useDevnet();
  if (!setup) return <p className="text-xs text-muted-foreground">Проверяем настройки MoonPay…</p>;

  const missingConfiguration = !setup.configured
    ? "Добавьте NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY в .env.local, чтобы подключить MoonPay."
    : !setup.canSign
      ? SIGNING_MESSAGE
      : null;
  if (missingConfiguration) {
    return (
      <MoonPaySellFallback
        message={missingConfiguration}
        amount={amount}
        validAmount={validAmount}
        canDemo={devnet.mode === "demo"}
        onWithdrawal={onWithdrawal}
        onSelectAnotherMethod={onSelectAnotherMethod}
      />
    );
  }
  if (!isCrossmintConfigured) {
    return (
      <MoonPaySellFallback
        message="Для открытия MoonPay войдите через настроенный Crossmint-кошелёк."
        amount={amount}
        validAmount={validAmount}
        canDemo={devnet.mode === "demo"}
        onWithdrawal={onWithdrawal}
        onSelectAnotherMethod={onSelectAnotherMethod}
      />
    );
  }

  return (
    <MoonPaySellReady
      amount={amount}
      validAmount={validAmount}
      environment={setup.environment}
      onWithdrawal={onWithdrawal}
      onSelectAnotherMethod={onSelectAnotherMethod}
      onWidgetVisibilityChange={onWidgetVisibilityChange}
    />
  );
}

function MoonPaySellFallback({
  message,
  amount,
  validAmount,
  canDemo,
  onWithdrawal,
  onSelectAnotherMethod,
}: {
  message: string;
  amount: number;
  validAmount: boolean;
  canDemo: boolean;
  onWithdrawal: (amount: number, details: WithdrawalDetails) => boolean;
  onSelectAnotherMethod: () => void;
}) {
  const simulateDemoWithdrawal = () => {
    onWithdrawal(amount, { note: "Демо: MoonPay не получил перевод, сумма списана только с локального баланса." });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{message}</p>
      <TestCardDetails flow="sell" />
      {canDemo ? (
        <Button className="w-full" onClick={simulateDemoWithdrawal} disabled={!validAmount}>
          Симулировать вывод · {formatMoney(amount)}
        </Button>
      ) : null}
      <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Из вклада на баланс</Button>
    </div>
  );
}

function MoonPaySellReady({
  amount,
  validAmount,
  environment,
  onWithdrawal,
  onSelectAnotherMethod,
  onWidgetVisibilityChange,
}: {
  amount: number;
  validAmount: boolean;
  environment: "sandbox" | "production";
  onWithdrawal: (amount: number, details: WithdrawalDetails) => boolean;
  onSelectAnotherMethod: () => void;
  onWidgetVisibilityChange: (visible: boolean) => void;
}) {
  const { login, status } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();
  const devnet = useDevnet();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [externalTransactionId, setExternalTransactionId] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "iframe" | "deposit" | "provider-complete">("idle");
  const [cryptoAmount, setCryptoAmount] = useState<number | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [countryUnavailable, setCountryUnavailable] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const opening = useRef(false);

  const openWidget = async () => {
    if (!validAmount || !wallet?.address || opening.current || widgetUrl) return;
    opening.current = true;
    setLoading(true);
    setError(null);
    setCountryUnavailable(false);
    setFailed(false);
    setPollTimedOut(false);
    setStage("idle");
    setExternalTransactionId(null);
    try {
      const customer = await getMoonPayIp("sell");
      if (!customer.allowed) {
        setCountryUnavailable(true);
        return;
      }
      const response = await fetch("/api/moonpay/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "sell", walletAddress: wallet.address, amountUsd: amount, userIp: customer.ipAddress }),
      });
      const result = await response.json().catch(() => null) as WidgetResponse | null;
      if (!response.ok || typeof result?.url !== "string" || typeof result.externalTransactionId !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : "Не удалось открыть MoonPay.");
      }
      const parsedUrl = new URL(result.url);
      const expectedHost = environment === "sandbox" ? "sell-sandbox.moonpay.com" : "sell.moonpay.com";
      if (parsedUrl.hostname !== expectedHost) throw new Error("MoonPay вернул ссылку для другой среды.");
      setExternalTransactionId(result.externalTransactionId);
      setWidgetUrl(parsedUrl.toString());
      setStage("iframe");
      onWidgetVisibilityChange(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось открыть MoonPay.");
    } finally {
      opening.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!externalTransactionId || !wallet?.address) return;
    let active = true;
    let timer: number | undefined;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let requestPending = false;

    const poll = async () => {
      if (!active || requestPending) return;
      if (Date.now() >= deadline) {
        setPollTimedOut(true);
        return;
      }
      requestPending = true;
      try {
        const response = await fetch("/api/moonpay/sell-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalTransactionId }),
        });
        const result = await response.json().catch(() => null) as {
          pending?: unknown;
          status?: unknown;
          cryptoAmount?: unknown;
          depositAddress?: unknown;
          error?: unknown;
        } | null;
        if (response.status === 202 || result?.pending === true) return;
        if (!response.ok) {
          setError(typeof result?.error === "string" ? result.error : "Не удалось проверить вывод MoonPay.");
          return;
        }
        if (typeof result?.cryptoAmount === "number" && result.cryptoAmount > 0) setCryptoAmount(result.cryptoAmount);
        if (typeof result?.depositAddress === "string") setDepositAddress(result.depositAddress);
        if (result?.status === "waitingForDeposit") {
          setStage("deposit");
          setWidgetUrl(null);
        } else if (result?.status === "failed") {
          setFailed(true);
          setStage("idle");
          setWidgetUrl(null);
          setExternalTransactionId(null);
          onWidgetVisibilityChange(false);
        } else if (result?.status === "completed") {
          setStage("provider-complete");
          setWidgetUrl(null);
        }
      } catch {
        // Keep polling while the sell flow is active; transient status API failures do not cancel it.
      } finally {
        requestPending = false;
        if (active) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [externalTransactionId, onWidgetVisibilityChange, wallet?.address]);

  const recordDemoWithdrawal = () => {
    const note = "Демо: MoonPay не получил перевод, сумма списана только с локального баланса.";
    if (onWithdrawal(amount, { note })) setExternalTransactionId(null);
  };

  const sendSimulatedDevnetDeposit = async () => {
    if (!wallet || !devnet.walletAddress || !devnet.treasuryOwner || !devnet.usdMint || sending) {
      setError("Не удалось подключить Solana devnet-кошелёк.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      // The sandbox deposit is simulated: our app's test dollar is not MoonPay's test SOL.
      const transfer = await wallet.send(devnet.treasuryOwner, devnet.usdMint, String(amount));
      const explorerUrl = `https://explorer.solana.com/tx/${encodeURIComponent(transfer.hash)}?cluster=devnet`;
      const recorded = onWithdrawal(amount, {
        onchain: true,
        signature: transfer.hash,
        explorerUrl,
        note: "В тестовом режиме перевод на адрес MoonPay симулируется: тестовые доллары списаны с баланса.",
      });
      if (!recorded) throw new Error("Не удалось записать вывод в историю операций.");
      void devnet.refresh();
      setExternalTransactionId(null);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось списать тестовые доллары. Проверьте баланс и повторите попытку.");
    } finally {
      setSending(false);
    }
  };

  if (status !== "logged-in") {
    const authLoading = status === "initializing" || status === "in-progress";
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Войдите, чтобы привязать вывод MoonPay к своему Solana-кошельку.</p>
        <Button variant="outline" className="w-full" onClick={login} disabled={authLoading || !validAmount}>
          {authLoading ? "Загружаем…" : "Войти"}
        </Button>
        {devnet.mode === "demo" ? (
          <Button className="w-full" onClick={recordDemoWithdrawal} disabled={!validAmount}>
            Симулировать вывод · {formatMoney(amount)}
          </Button>
        ) : null}
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Из вклада на баланс</Button>
      </div>
    );
  }
  if (!wallet?.address || walletStatus === "in-progress") {
    return <p className="text-xs text-muted-foreground">Подготавливаем кошелёк…</p>;
  }

  const currentCryptoAmount = cryptoAmount ?? (environment === "sandbox" ? null : amount);
  const simulateWithdrawal = devnet.mode === "devnet" ? sendSimulatedDevnetDeposit : recordDemoWithdrawal;

  if (countryUnavailable) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">MoonPay недоступен в вашей стране.</p>
        <TestCardDetails flow="sell" />
        {devnet.mode === "devnet" ? (
          <p className="text-xs text-muted-foreground">Можно списать тестовые доллары с devnet-баланса без перевода через MoonPay.</p>
        ) : null}
        <Button className="w-full" onClick={simulateWithdrawal} disabled={!validAmount || sending}>
          {sending ? "Отправляем…" : `Симулировать вывод · ${formatMoney(amount)}`}
        </Button>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Из вклада на баланс</Button>
      </div>
    );
  }

  return (
    <div className={widgetUrl ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
      <TestCardDetails flow="sell" />
      {widgetUrl ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
          <iframe
            ref={iframeRef}
            src={widgetUrl}
            title={`MoonPay — вывод ${environment === "sandbox" ? "SOL" : "USDC"}`}
            className="h-full w-full border-0"
            allow={IFRAME_ALLOW}
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
      {stage === "deposit" ? (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <p className="text-sm font-medium">
            {currentCryptoAmount === null
              ? "MoonPay ждёт перевод выбранной суммы."
              : `MoonPay ждёт перевод ${currentCryptoAmount.toFixed(2)} ${environment === "sandbox" ? "SOL" : "USDC"}.`}
          </p>
          {depositAddress ? <p className="break-all text-xs text-muted-foreground">Адрес депозита MoonPay: {depositAddress}</p> : null}
          {devnet.mode === "devnet" ? (
            <p className="text-xs text-muted-foreground">
              В sandbox тестовый доллар приложения отличается от SOL MoonPay. Кнопка ниже только симулирует депозит и списывает тестовые доллары.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Демо-вывод только уменьшит локальный баланс; перевод MoonPay не отправляется.</p>
          )}
          <Button className="w-full" onClick={simulateWithdrawal} disabled={sending}>
            {sending ? "Отправляем…" : devnet.mode === "devnet" ? "Отправить с баланса" : "Симулировать вывод"}
          </Button>
        </div>
      ) : null}
      {stage === "provider-complete" ? (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <p className="text-sm font-medium">MoonPay завершил тестовую операцию.</p>
          <p className="text-xs text-muted-foreground">
            {devnet.mode === "devnet"
              ? `Чтобы баланс приложения отражал вывод, отдельно спишите тестовые доллары. Это не отправляет ${environment === "sandbox" ? "SOL" : "USDC"} MoonPay.`
              : "Продолжите демо-сценарий, чтобы списать сумму с локального баланса."}
          </p>
          <Button className="w-full" onClick={simulateWithdrawal} disabled={sending}>
            {sending ? "Отправляем…" : devnet.mode === "devnet" ? "Списать тестовые доллары" : "Завершить демо-вывод"}
          </Button>
        </div>
      ) : null}
      {loading ? <p className="text-xs text-muted-foreground">Открываем MoonPay…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {pollTimedOut ? <p className="text-xs text-muted-foreground">Проверка остановлена через 15 минут. Можно повторить попытку.</p> : null}
      {failed ? <p className="text-xs text-destructive">Вывод не прошёл. Попробуйте ещё раз.</p> : null}
      {stage === "idle" && !widgetUrl && validAmount ? (
        <Button className="w-full" onClick={openWidget} disabled={loading}>
          {failed || error ? "Повторить" : "Открыть MoonPay"}
        </Button>
      ) : null}
      {stage === "idle" && !widgetUrl && devnet.mode === "demo" && validAmount ? (
        <Button variant="outline" className="w-full" onClick={recordDemoWithdrawal}>
          Симулировать вывод · {formatMoney(amount)}
        </Button>
      ) : null}
      <Button
        variant="outline"
        className="w-full shrink-0"
        onClick={() => {
          setWidgetUrl(null);
          setExternalTransactionId(null);
          setStage("idle");
          onWidgetVisibilityChange(false);
          onSelectAnotherMethod();
        }}
      >
        Из вклада на баланс
      </Button>
    </div>
  );
}
