"use client";

import { useEffect, useRef, useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Coins, CreditCard, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CrossmintOnramp } from "@/components/CrossmintOnramp";
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
          {id === "crossmint" ? <Badge variant="secondary">Рекомендуем</Badge> : null}
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
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function getCreditedAmount(eventData: unknown, requestedAmount: number): number {
  const payload = isRecord(eventData) && isRecord(eventData.data) ? eventData.data : null;
  const status = payload && isRecord(payload.status) ? payload.status : null;
  const candidates = [
    payload?.cryptoAmount,
    status?.cryptoAmount,
    payload?.fiatAmount,
    status?.fiatAmount,
  ];

  for (const candidate of candidates) {
    const amount = toPositiveAmount(candidate);
    if (amount !== null) return amount;
  }

  return Math.round((requestedAmount + Number.EPSILON) * 100) / 100;
}

export function TransakPath({
  amount,
  onDemo,
  onComplete,
  onSelectAnotherMethod,
  onWidgetVisibilityChange,
}: {
  amount: number;
  onDemo: () => void;
  onComplete: (amount: number) => void;
  onSelectAnotherMethod: () => void;
  onWidgetVisibilityChange: (visible: boolean) => void;
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
      onSelectAnotherMethod={onSelectAnotherMethod}
      onWidgetVisibilityChange={onWidgetVisibilityChange}
    />
  );
}

function TransakSessionPath({
  amount,
  onDemo,
  onComplete,
  onSelectAnotherMethod,
  onWidgetVisibilityChange,
}: {
  amount: number;
  onDemo: () => void;
  onComplete: (amount: number) => void;
  onSelectAnotherMethod: () => void;
  onWidgetVisibilityChange: (visible: boolean) => void;
}) {
  const { login, status, user } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderFailed, setOrderFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const completed = useRef(false);
  const opening = useRef(false);
  const mounted = useRef(false);
  const requestedAmount = useRef(amount);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const openWidget = async () => {
    if (amount < TRANSAK_MIN_USD || opening.current || widgetUrl || !wallet?.address) return;

    opening.current = true;
    requestedAmount.current = amount;
    completed.current = false;
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
      onWidgetVisibilityChange(true);
    } catch (requestError: unknown) {
      if (mounted.current) {
        setError(requestError instanceof Error
          ? requestError.message
          : "Не удалось открыть виджет Transak.");
        onWidgetVisibilityChange(false);
      }
    } finally {
      opening.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== TRANSAK_STAGING_WIDGET_ORIGIN
        || event.source !== iframeRef.current?.contentWindow
        || !event.data
        || typeof event.data !== "object"
      ) return;

      const eventId = event.data.event_id;
      if (eventId === "TRANSAK_ORDER_SUCCESSFUL" && !completed.current) {
        completed.current = true;
        onWidgetVisibilityChange(false);
        onComplete(getCreditedAmount(event.data, requestedAmount.current));
      }
      if (eventId === "TRANSAK_ORDER_FAILED" && !completed.current) {
        setOrderFailed(true);
      }
      if (eventId === "TRANSAK_WIDGET_CLOSE" && !completed.current) {
        setWidgetUrl(null);
        onWidgetVisibilityChange(false);
        onSelectAnotherMethod();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onComplete, onSelectAnotherMethod, onWidgetVisibilityChange]);

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
    <div className={widgetUrl ? "flex min-h-0 flex-1 flex-col gap-3" : "space-y-3"}>
      {widgetUrl ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background">
          <iframe
            ref={iframeRef}
            src={widgetUrl}
            title="Transak — покупка USDC"
            className="h-full w-full border-0"
            allow="camera; microphone; payment"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
      {!widgetUrl ? (
        <p className="text-xs text-muted-foreground">
          {amount < TRANSAK_MIN_USD
            ? "Минимальная сумма для Transak — $30. Увеличьте сумму или продолжите в демо-режиме."
            : "Откроется тестовый виджет Transak. Тестовые данные для проверки личности заполнятся сами — останется код из письма и тестовая карта."}
        </p>
      ) : null}
      {loading ? <p className="text-xs text-muted-foreground">Открываем тестовый виджет Transak…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!widgetUrl && !loading && amount >= TRANSAK_MIN_USD ? (
        <Button
          className="w-full"
          onClick={openWidget}
        >
          {error ? "Повторить" : `Открыть Transak · ${formatMoney(amount)}`}
        </Button>
      ) : null}
      {!widgetUrl ? (
        <Button variant="outline" className="w-full" onClick={onDemo}>
          <Plus />Продолжить в демо-режиме · {formatMoney(amount)}
        </Button>
      ) : null}
      {widgetUrl && orderFailed ? (
        <p className="text-xs text-destructive">
          Оплата не прошла. Попробуйте ещё раз или выберите другой способ.
        </p>
      ) : null}
      {widgetUrl ? (
        <Button variant="outline" className="w-full shrink-0" onClick={onSelectAnotherMethod}>
          Выбрать другой способ
        </Button>
      ) : null}
    </div>
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
