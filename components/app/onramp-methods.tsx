"use client";

import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { CreditCard, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CrossmintOnramp } from "@/components/CrossmintOnramp";
import { isCrossmintConfigured } from "@/lib/config";
import { formatMoney } from "@/lib/format";
import { buildMercuryoUrl, isMercuryoConfigured, ONRAMP_OPTIONS } from "@/lib/onramps";

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
    crossmint: "Карта · Crossmint",
    mercuryo: "Карта · Mercuryo",
    kaspi: "Kaspi Pay",
    freedom: "Freedom",
  };
  const hint = ONRAMP_OPTIONS.find((option) => option.id === id)?.hint;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? "border-foreground bg-muted/60" : "hover:bg-muted/40"}`}
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <CreditCard className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {labels[id]}
          {id === "mercuryo" ? <Badge variant="secondary">Рекомендуем</Badge> : null}
          {id === "kaspi" || id === "freedom" ? <Badge variant="outline">Концепт</Badge> : null}
        </span>
        {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={`mt-1 size-4 rounded-full border ${selected ? "border-foreground bg-foreground ring-2 ring-background ring-offset-1 ring-offset-foreground" : "border-muted-foreground/40"}`} />
    </button>
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
          Если видите «Not available in your country», этот способ недоступен в вашей стране.
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
