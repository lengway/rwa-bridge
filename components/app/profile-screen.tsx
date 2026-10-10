"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { AccountSection, WalletSection } from "@/components/app/profile-account";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { isCrossmintConfigured } from "@/lib/config";
import { useAuth } from "@/lib/useAuth";

const subscribeToMountedState = () => () => {};
const getMountedState = () => true;
const getServerMountedState = () => false;

export function PortfolioSettings() {
  return (
    <div className="space-y-6">
      <AccountSection />
      <EmailPreferenceSection />
      <InstallAppHint />
      <PreferenceSection />
      <ThemeSection />
      <WalletSection />
    </div>
  );
}

function EmailPreferenceSection() {
  if (!isCrossmintConfigured) {
    return <Card className="gap-2 rounded-2xl p-4"><h2 className="font-semibold">Письма о каждой операции</h2><p className="text-sm text-muted-foreground">Настройка доступна после входа по email.</p></Card>;
  }
  return <EmailPreferenceSectionReady />;
}

function EmailPreferenceSectionReady() {
  const { status } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (status !== "signed-in") return;
    let active = true;
    Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoading(true);
        setError(null);
        return fetch("/api/me/preferences", { cache: "no-store" });
      })
      .then((response) => response ? response : null)
      .then(async (response) => {
        if (!response) return null;
        const result = await response.json() as { receiptsEnabled?: unknown; error?: unknown };
        if (!response.ok || typeof result.receiptsEnabled !== "boolean") {
          throw new Error(typeof result.error === "string" ? result.error : "Не удалось загрузить настройки писем.");
        }
        if (active) setEnabled(result.receiptsEnabled);
        return true;
      })
      .catch(() => { if (active) setError("Не удалось загрузить настройку писем. Проверьте соединение и повторите попытку."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry, status]);

  const savePreference = async (nextEnabled: boolean) => {
    if (status !== "signed-in" || saving) return;
    const previous = enabled;
    setEnabled(nextEnabled);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptsEnabled: nextEnabled }),
      });
      const result = await response.json() as { receiptsEnabled?: unknown; error?: unknown };
      if (!response.ok || result.receiptsEnabled !== nextEnabled) {
        throw new Error(typeof result.error === "string" ? result.error : "Не удалось сохранить настройку.");
      }
    } catch {
      setEnabled(previous);
      setError("Не удалось сохранить настройку. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  };

  const loggedIn = status === "signed-in";
  return (
    <Card className="flex-row items-center justify-between gap-4 rounded-2xl p-4">
      <div className="min-w-0">
        <h2 className="font-semibold">Письма о каждой операции</h2>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          {loggedIn ? "Квитанции об операциях отправляются на email аккаунта." : "Войдите по email, чтобы получать квитанции."}
        </p>
        {error ? (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-destructive">{error}</p>
            <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setRetry((value) => value + 1)}>Повторить загрузку</Button>
          </div>
        ) : null}
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(value) => void savePreference(value)}
        disabled={!loggedIn || loading || saving}
        aria-label="Письма о каждой операции"
      />
    </Card>
  );
}

function InstallAppHint() {
  return (
    <Card className="gap-2 rounded-2xl p-4">
      <h2 className="font-semibold">Установить приложение</h2>
      <p className="text-sm leading-5 text-muted-foreground">iPhone: откройте сайт в Safari и выберите «Поделиться» → «На экран Домой». Android: откройте меню Chrome и выберите «Установить приложение».</p>
    </Card>
  );
}

function PreferenceSection() {
  return (
    <Card className="gap-4 rounded-2xl p-4">
      <div>
        <h2 className="font-semibold">Отображение Solana Devnet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Все тестовые активы отображаются в TEST QUOTE. Конвертация в фиат, KZT и рыночный курс не входят в среду Solana Devnet.
        </p>
      </div>
    </Card>
  );
}

function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToMountedState,
    getMountedState,
    getServerMountedState,
  );
  const selected = mounted ? theme ?? "system" : null;
  const options = [
    { id: "system", label: "Системная" },
    { id: "light", label: "Светлая" },
    { id: "dark", label: "Тёмная" },
  ] as const;

  return (
    <Card className="gap-4 rounded-2xl p-4">
      <div>
        <h2 className="font-semibold">Оформление</h2>
        <p className="mt-1 text-sm text-muted-foreground">Выберите тему приложения.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <Button
            key={option.id}
            variant={selected === option.id ? "secondary" : "outline"}
            aria-pressed={selected === option.id}
            onClick={() => setTheme(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
