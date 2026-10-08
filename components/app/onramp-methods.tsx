"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Coins, CreditCard, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CrossmintOnramp } from "@/components/CrossmintOnramp";
import { ProviderSheet } from "@/components/app/provider-sheet";
import { ProviderQuote } from "@/components/app/provider-quote";
import { isCrossmintConfigured } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import {
  buildMercuryoUrl,
  isMercuryoConfigured,
  ONRAMP_OPTIONS,
  TRANSAK_MIN_USD,
  TRANSAK_STAGING_WIDGET_ORIGIN,
} from "@/lib/onramps";

export function MethodOption({
  id,
  selected,
  onSelect,
}: {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const labels: Record<string, string> = {
    "devnet-faucet": "Тестовый банкомат",
    moonpay: "Карта · MoonPay",
    transak: "Карта · Transak",
    crossmint: "Карта · Crossmint",
    mercuryo: "Карта · Mercuryo",
    kaspi: "Kaspi Pay",
    freedom: "Freedom",
  };
  const hint = ONRAMP_OPTIONS.find((option) => option.id === id)?.hint;
  const MethodIcon = id === "devnet-faucet" ? Coins : CreditCard;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? "border-foreground bg-muted/60" : "hover:bg-muted/40"}`}
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <MethodIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {labels[id]}
          {id === "devnet-faucet" ? <Badge variant="outline">Без карты</Badge> : null}
          {id === "transak" ? <Badge variant="secondary">Рекомендуем</Badge> : null}
          {id === "kaspi" || id === "freedom" ? <Badge variant="outline">Концепт</Badge> : null}
        </span>
        {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={`mt-1 size-4 rounded-full border ${selected ? "border-foreground bg-foreground ring-2 ring-background ring-offset-1 ring-offset-foreground" : "border-muted-foreground/40"}`} />
    </button>
  );
}

type TransakSetup = { configured: boolean; message?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPositiveAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;

  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function getTransakOrderId(eventData: unknown): string | null {
  if (!isRecord(eventData) || !isRecord(eventData.data)) return null;
  const payload = eventData.data;
  const status = isRecord(payload.status) ? payload.status : null;
  const candidates = [payload.id, status?.id, payload.orderId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && candidate.length <= 128) {
      return candidate.trim();
    }
  }
  return null;
}

const TRANSAK_POLL_INTERVAL_MS = 5_000;
const TRANSAK_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

type TransakOnchainCompletion = { amountUsd: number; signature: string; explorerUrl: string };

export function TransakPath({
  amount,
  onDemo,
  onComplete,
  onCompleteOnchain,
  onSelectAnotherMethod,
}: {
  amount: number;
  onDemo: () => void;
  onComplete: (amount: number) => void;
  onCompleteOnchain: (credit: TransakOnchainCompletion) => void;
  onSelectAnotherMethod: () => void;
}) {
  const [setup, setSetup] = useState<TransakSetup | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/transak-session")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error("Не удалось проверить настройки Transak.");
        return result as TransakSetup;
      })
      .then((result) => {
        if (!cancelled) setSetup(result);
      })
      .catch(() => {
        if (!cancelled) setSetup({
          configured: false,
          message: "Не удалось проверить настройки Transak. Можно продолжить в демо-режиме.",
        });
      });
    return () => { cancelled = true; };
  }, []);

  if (!setup) {
    return <p className="text-xs text-muted-foreground">Проверяем настройки Transak…</p>;
  }
  if (!setup.configured) {
    return (
      <TransakDemoFallback
        message={setup.message ?? "Тестовый виджет Transak пока не настроен."}
        amount={amount}
        onDemo={onDemo}
      />
    );
  }
  if (!isCrossmintConfigured) {
    return (
      <TransakDemoFallback
        message="Для входа в Transak добавьте NEXT_PUBLIC_CROSSMINT_API_KEY и настройте кошелёк."
        amount={amount}
        onDemo={onDemo}
      />
    );
  }

  return (
    <TransakSessionPath
      amount={amount}
      onDemo={onDemo}
      onComplete={onComplete}
      onCompleteOnchain={onCompleteOnchain}
      onSelectAnotherMethod={onSelectAnotherMethod}
    />
  );
}

function TransakSessionPath({
  amount,
  onDemo,
  onComplete,
  onCompleteOnchain,
  onSelectAnotherMethod,
}: {
  amount: number;
  onDemo: () => void;
  onComplete: (amount: number) => void;
  onCompleteOnchain: (credit: TransakOnchainCompletion) => void;
  onSelectAnotherMethod: () => void;
}) {
  const { login, status, user } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderFailed, setOrderFailed] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hasOpenedSession, setHasOpenedSession] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const completed = useRef(false);
  const reportedCredit = useRef(false);
  const orderIdRef = useRef<string | null>(null);
  const opening = useRef(false);
  const mounted = useRef(false);

  const closeWidget = useCallback(() => {
    setWidgetUrl(null);
    setSheetOpen(false);
    setHasOpenedSession(true);
  }, []);

  const handleSheetOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setSheetOpen(true);
    } else {
      closeWidget();
    }
  }, [closeWidget]);

  const captureOrderId = useCallback((eventData: unknown) => {
    const id = getTransakOrderId(eventData);
    if (!id || orderIdRef.current === id) return id;
    orderIdRef.current = id;
    setOrderId(id);
    setOrderFailed(false);
    setError(null);
    setPollTimedOut(false);
    setVerificationPending(true);
    return id;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const openWidget = async () => {
    if (amount < TRANSAK_MIN_USD || opening.current || widgetUrl || !wallet?.address) return;

    opening.current = true;
    completed.current = false;
    reportedCredit.current = false;
    setLoading(true);
    setError(null);
    setOrderFailed(false);

    try {
      const response = await fetch("/api/transak-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet.address, amountUsd: amount, email: user?.email }),
      });
      const result = await response.json().catch(() => null) as {
        widgetUrl?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof result?.widgetUrl !== "string") {
        throw new Error(typeof result?.error === "string"
          ? result.error
          : "Не удалось открыть виджет Transak.");
      }

      const parsedUrl = new URL(result.widgetUrl);
      if (parsedUrl.origin !== TRANSAK_STAGING_WIDGET_ORIGIN) {
        throw new Error("Transak вернул ссылку не для тестовой среды.");
      }
      if (!mounted.current) return;

      setWidgetUrl(parsedUrl.toString());
      setHasOpenedSession(true);
      setSheetOpen(true);
    } catch (requestError: unknown) {
      if (mounted.current) {
        setError(requestError instanceof Error
          ? requestError.message
          : "Не удалось открыть виджет Transak.");
      }
    } finally {
      opening.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!orderId || !wallet?.address || reportedCredit.current) return;
    let active = true;
    let timer: number | undefined;
    let requestPending = false;
    const deadline = Date.now() + TRANSAK_POLL_TIMEOUT_MS;

    const poll = async () => {
      if (!active || requestPending || reportedCredit.current) return;
      if (Date.now() >= deadline) {
        setPollTimedOut(true);
        setVerificationPending(false);
        return;
      }

      requestPending = true;
      try {
        const response = await fetch("/api/transak/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, walletAddress: wallet.address }),
        });
        const result = await response.json().catch(() => null) as {
          status?: unknown;
          amountUsd?: unknown;
          signature?: unknown;
          explorerUrl?: unknown;
          error?: unknown;
        } | null;
        if (!active) return;

        if (result?.status === "pending" || response.status === 202) {
          setVerificationPending(true);
          setError(null);
        } else if (result?.status === "failed") {
          reportedCredit.current = true;
          orderIdRef.current = null;
          setOrderId(null);
          setVerificationPending(false);
          setOrderFailed(true);
          closeWidget();
          return;
        } else if (response.ok && result?.status === "completed") {
          const amountUsd = toPositiveAmount(result.amountUsd);
          if (amountUsd === null) {
            throw new Error("Transak не вернул корректную сумму покупки.");
          }
          reportedCredit.current = true;
          orderIdRef.current = null;
          setOrderId(null);
          setVerificationPending(false);
          setPollTimedOut(false);
          setError(null);
          closeWidget();
          if (typeof result.signature === "string" && typeof result.explorerUrl === "string") {
            onCompleteOnchain({ amountUsd, signature: result.signature, explorerUrl: result.explorerUrl });
          } else {
            onComplete(amountUsd);
          }
          return;
        } else if (response.status >= 400 && response.status < 500) {
          orderIdRef.current = null;
          setOrderId(null);
          setVerificationPending(false);
          setError(typeof result?.error === "string"
            ? result.error
            : "Не удалось проверить покупку Transak.");
          return;
        } else {
          setVerificationPending(true);
          if (typeof result?.error === "string") setError(result.error);
        }
      } catch (requestError) {
        if (active) {
          setVerificationPending(true);
          setError(requestError instanceof Error
            ? requestError.message
            : "Не удалось проверить покупку Transak.");
        }
      } finally {
        requestPending = false;
        if (active && !reportedCredit.current) {
          timer = window.setTimeout(() => { void poll(); }, TRANSAK_POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [closeWidget, onComplete, onCompleteOnchain, orderId, wallet?.address]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== TRANSAK_STAGING_WIDGET_ORIGIN
        || event.source !== iframeRef.current?.contentWindow
        || !event.data
        || typeof event.data !== "object"
      ) return;

      const eventId = event.data.event_id;
      if (eventId === "TRANSAK_ORDER_CREATED") {
        captureOrderId(event.data);
      }
      if (eventId === "TRANSAK_ORDER_SUCCESSFUL" && !completed.current) {
        if (!captureOrderId(event.data)) {
          setError("Не удалось получить идентификатор заказа Transak для проверки.");
        }
        completed.current = true;
        closeWidget();
      }
      if (eventId === "TRANSAK_ORDER_FAILED" && !completed.current) {
        if (!captureOrderId(event.data) && !orderIdRef.current) setOrderFailed(true);
        closeWidget();
      }
      if (eventId === "TRANSAK_WIDGET_CLOSE" && !completed.current) {
        closeWidget();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [captureOrderId, closeWidget]);

  if (status !== "logged-in") {
    const authLoading = status === "initializing" || status === "in-progress";
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Войдите, чтобы открыть Transak и привязать покупку к своему кошельку.</p>
        <Button variant="outline" className="w-full" onClick={login} disabled={authLoading}>
          {authLoading ? "Загружаем…" : "Войти"}
        </Button>
        <Button className="w-full" onClick={onDemo}>
          <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
        </Button>
      </div>
    );
  }

  if (!wallet?.address || walletStatus === "in-progress") {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Подготавливаем кошелёк…</p>
        <Button className="w-full" onClick={onDemo}>
          <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {!widgetUrl && !orderId ? (
          <p className="text-xs text-muted-foreground">
            {amount < TRANSAK_MIN_USD
              ? "Минимальная сумма для Transak — $30. Увеличьте сумму или продолжите в демо-режиме."
              : "Откроется тестовый виджет Transak."}
          </p>
        ) : widgetUrl && !sheetOpen ? (
          <p className="text-xs text-muted-foreground">Закройте виджет, чтобы вернуться к способам пополнения.</p>
        ) : null}
        {loading ? <p className="text-xs text-muted-foreground">Открываем тестовый виджет Transak…</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {orderId && verificationPending ? <p className="text-xs text-muted-foreground">Проверяем оплату Transak…</p> : null}
        {pollTimedOut && orderId ? <p className="text-xs text-muted-foreground">Подтверждение задерживается. Попробуйте проверить оплату позже.</p> : null}
        {orderFailed && !widgetUrl ? <p className="text-xs text-destructive">Оплата не прошла. Попробуйте ещё раз.</p> : null}
        {!widgetUrl && !loading && amount >= TRANSAK_MIN_USD ? (
          <Button className="w-full" onClick={openWidget}>
            {hasOpenedSession ? "Открыть Transak снова" : error ? "Повторить" : `Открыть Transak · ${formatMoney(amount)}`}
          </Button>
        ) : null}
        {!widgetUrl ? (
          <ProviderQuote
            provider="transak"
            side="buy"
            amount={amount}
            valid={amount >= TRANSAK_MIN_USD && amount <= 1_000}
          />
        ) : null}
        {!widgetUrl ? (
          <Button variant="outline" className="w-full" onClick={onDemo}>
            <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
          </Button>
        ) : null}
        {!sheetOpen ? (
          <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>
            Выбрать другой способ
          </Button>
        ) : null}
      </div>
      <ProviderSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        title="Transak"
        badge="Тестовый режим"
        testData={<p>Тестовые данные для проверки личности заполнятся сами — останется код из письма и тестовая карта.</p>}
      >
        {widgetUrl ? (
          <div className="flex h-full min-h-0 flex-col bg-white">
            <iframe
              ref={iframeRef}
              src={widgetUrl}
              title="Transak — покупка USDC"
              className="min-h-0 flex-1 border-0 bg-white"
              allow="camera; microphone; payment"
              referrerPolicy="strict-origin-when-cross-origin"
            />
            {orderFailed ? (
              <p className="shrink-0 px-4 py-2 text-xs text-red-700">Оплата не прошла. Попробуйте ещё раз.</p>
            ) : null}
          </div>
        ) : null}
      </ProviderSheet>
    </>
  );
}

function TransakDemoFallback({
  message,
  amount,
  onDemo,
}: {
  message: string;
  amount: number;
  onDemo: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{message}</p>
      <Button className="w-full" onClick={onDemo}>
        <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
      </Button>
    </div>
  );
}

export function CrossmintPath({
  amount,
  onDemo,
  onComplete,
  onSelectAnotherMethod,
  processing,
}: {
  amount: number;
  onDemo: () => void;
  onComplete: (amount: number) => void;
  onSelectAnotherMethod: () => void;
  processing: boolean;
}) {
  if (!isCrossmintConfigured) {
    return <DemoPath method="Crossmint" amount={amount} onDemo={onDemo} processing={processing} />;
  }
  return (
    <CrossmintPathReady
      amount={amount}
      onDemo={onDemo}
      onComplete={onComplete}
      onSelectAnotherMethod={onSelectAnotherMethod}
    />
  );
}

function CrossmintPathReady({
  amount,
  onDemo,
  onComplete,
  onSelectAnotherMethod,
}: {
  amount: number;
  onDemo: () => void;
  onComplete: (amount: number) => void;
  onSelectAnotherMethod: () => void;
}) {
  const { login, user, status } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();
  if (status === "logged-in" && user?.email && wallet?.address) {
    return (
      <div className="space-y-3">
        <CrossmintOnramp
          walletAddress={wallet.address}
          email={user.email}
          amountUsd={amount}
          onCompleted={onComplete}
        />
        <p className="text-xs text-muted-foreground">
          Если оплата картой недоступна в вашей стране, выберите другой способ.
        </p>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>
          Выбрать другой способ
        </Button>
      </div>
    );
  }

  const loading = status === "initializing" || status === "in-progress"
    || (status === "logged-in" && walletStatus === "in-progress");
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Для оплаты картой нужны вход по email и созданный аккаунт.
      </p>
      {status === "logged-in" ? (
        <p className="text-xs text-muted-foreground">Подготавливаем аккаунт…</p>
      ) : (
        <Button variant="outline" className="w-full" onClick={login} disabled={loading}>
          {loading ? "Загружаем…" : "Войти по email"}
        </Button>
      )}
      <Button className="w-full" onClick={onDemo} disabled={loading}>
        <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
      </Button>
    </div>
  );
}

export function MercuryoPath({
  amount,
  onDemo,
  processing,
}: {
  amount: number;
  onDemo: () => void;
  processing: boolean;
}) {
  if (!isCrossmintConfigured) {
    return <DemoPath method="Mercuryo" amount={amount} onDemo={onDemo} processing={processing} />;
  }
  return <MercuryoPathReady amount={amount} onDemo={onDemo} />;
}

function MercuryoPathReady({
  amount,
  onDemo,
}: {
  amount: number;
  onDemo: () => void;
}) {
  const { login, user, status } = useCrossmintAuth();
  const { wallet } = useWallet();
  const ready = Boolean(isMercuryoConfigured && wallet?.address && user?.email && status === "logged-in");

  if (ready && wallet?.address) {
    return (
      <div className="space-y-3">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => window.open(buildMercuryoUrl(wallet.address), "_blank", "noopener,noreferrer")}
        >
          Открыть Mercuryo
        </Button>
        <p className="text-xs text-muted-foreground">
          После оплаты демо-баланс приложения не меняется автоматически.
        </p>
      </div>
    );
  }
  if (!isMercuryoConfigured) {
    return <DemoPath method="Mercuryo" amount={amount} onDemo={onDemo} />;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Для виджета Mercuryo нужен аккаунт. Реальное зачисление в приложение не подключено.
      </p>
      {status !== "logged-in" ? (
        <Button variant="outline" className="w-full" onClick={login}>Войти по email</Button>
      ) : null}
      <Button className="w-full" onClick={onDemo}>
        <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
      </Button>
    </div>
  );
}

function DemoPath({
  method,
  amount,
  onDemo,
  processing = false,
}: {
  method: string;
  amount: number;
  onDemo: () => void;
  processing?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Пополнение через {method} пока не подключено. Можно продолжить с демо-зачислением.
      </p>
      <Button className="w-full" onClick={onDemo} disabled={processing}>
        <Plus />{processing ? "Зачисляем…" : `Продолжить в демо-режиме · ${formatMoney(amount)}`}
      </Button>
    </div>
  );
}
