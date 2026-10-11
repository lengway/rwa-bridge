"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Activity, ArrowLeft, BriefcaseBusiness, House, Landmark, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBankEmbed } from "@/lib/useBankEmbed";
import { isCrossmintConfigured } from "@/lib/config";
import { useAuth } from "@/lib/useAuth";
import { useDevnet } from "@/lib/useDevnet";
import { Input } from "@/components/ui/input";

const tabs = [
  { href: "/home", label: "Главная", icon: House },
  { href: "/earn", label: "Доход", icon: Landmark },
  { href: "/assets", label: "Активы", icon: BriefcaseBusiness },
  { href: "/activity", label: "История", icon: Activity },
  { href: "/portfolio", label: "Портфель", icon: PieChart },
];

const titles: Record<string, string> = {
  "/home": "Plain",
  "/earn": "Доход",
  "/assets": "Активы",
  "/activity": "История",
  "/portfolio": "Портфель",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, walletAddress, walletError } = useAuth();
  if (status === "signed-in" && walletError) return <WalletConnectionError message={walletError} />;
  if (status === "loading" || (status === "signed-in" && isCrossmintConfigured && !walletAddress)) return <AuthLoader />;
  if (status === "signed-out") return <SignInScreen />;
  if (!isCrossmintConfigured) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-8">
        <section className="w-full max-w-md space-y-3 rounded-3xl border bg-background p-7 text-center shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Plain</h1>
          <p className="text-sm leading-6 text-muted-foreground">Кошелёк сейчас недоступен. Попробуйте позже.</p>
        </section>
      </main>
    );
  }
  return <SignedInShell>{children}</SignedInShell>;
}

function AuthLoader() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40" aria-label="Загрузка">
      <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground" />
    </main>
  );
}

function WalletConnectionError({ message }: { message: string }) {
  const { retryWallet, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-8">
      <section className="w-full max-w-md space-y-4 rounded-3xl border bg-background p-7 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Кошелёк недоступен</h1>
        <p role="alert" className="text-sm leading-6 text-muted-foreground">{error ?? message}</p>
        <Button className="w-full" onClick={retryWallet}>Повторить подключение</Button>
        <Button variant="outline" className="w-full" onClick={() => {
          void signOut().catch(() => setError("Не удалось завершить сессию на сервере. Повторите выход после восстановления соединения."));
        }}>Выйти</Button>
      </section>
    </main>
  );
}

function SignInScreen() {
  const { refreshSession } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const requestCode = async (resend = false) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json().catch(() => null) as { error?: unknown; resendAfterSeconds?: unknown } | null;
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Не удалось отправить код. Попробуйте ещё раз.");
      setStep("code");
      setCode("");
      setResendIn(typeof result?.resendAfterSeconds === "number" ? result.resendAfterSeconds : 60);
      if (resend) setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось отправить код. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const result = await response.json().catch(() => null) as { error?: unknown } | null;
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Не удалось проверить код.");
      if (!await refreshSession()) throw new Error("Вход подтверждён, но не удалось загрузить сессию. Попробуйте ещё раз.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось проверить код. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const changeEmail = () => {
    setStep("email");
    setCode("");
    setResendIn(0);
    setError(null);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-8">
      <section className="w-full max-w-md space-y-5 rounded-3xl border bg-background p-7 shadow-sm sm:p-9">
        <div className="space-y-2">
          <h1 className="text-center text-2xl font-semibold tracking-tight">Plain</h1>
          <p className="text-center text-sm leading-6 text-muted-foreground">Войдите по email, чтобы продолжить.</p>
        </div>
        {step === "email" ? (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void requestCode(); }}>
            <label className="block space-y-2 text-left text-sm font-medium">
              <span>Email</span>
              <Input
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
                disabled={busy}
              />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" size="lg" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Отправляем…" : "Получить код"}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void verifyCode(); }}>
            <p className="text-center text-sm leading-6 text-muted-foreground">Мы отправили код на <span className="font-medium text-foreground">{email}</span></p>
            <label className="block space-y-2 text-left text-sm font-medium">
              <span>Код из письма</span>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                placeholder="123 456"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                disabled={busy}
                aria-label="Шестизначный код из письма"
                className="text-center font-mono text-xl tracking-[0.35em]"
              />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" size="lg" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Проверяем…" : "Войти"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <Button type="button" variant="link" className="h-auto p-0" onClick={changeEmail} disabled={busy}>Изменить email</Button>
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => void requestCode(true)} disabled={busy || resendIn > 0}>
                {resendIn > 0 ? `Повторить через ${resendIn} сек.` : "Отправить код повторно"}
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

function SignedInShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bankEmbed = useBankEmbed();
  const { portfolioError, refreshPortfolio } = useDevnet();
  const isEarnDetail = /^\/earn\/[^/]+/.test(pathname);
  const isAssetDetail = /^\/assets\/[^/]+/.test(pathname);
  const isDetail = isEarnDetail || isAssetDetail;
  const title = isEarnDetail
    ? "Детали вклада"
    : isAssetDetail
      ? "Детали актива"
      : (titles[pathname] ?? "Plain");

  useEffect(() => {
    if (!bankEmbed) return;
    const root = document.documentElement;
    const hadDarkClass = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (hadDarkClass) root.classList.add("dark");
    };
  }, [bankEmbed]);

  return (
    <div className="min-h-dvh bg-muted/40">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background shadow-sm ring-1 ring-border/60">
        {pathname !== "/portfolio" ? (
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-5 backdrop-blur">
            {isDetail ? (
              <Link
                href={isEarnDetail ? "/earn" : "/assets"}
                aria-label={isEarnDetail ? "Назад к доходу" : "Назад к активам"}
                className="-ml-2 inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"
              >
                <ArrowLeft className="size-5" />
              </Link>
            ) : null}
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
            <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">devnet</span>
          </header>
        ) : null}
        <main
          className={`flex-1 px-4 pt-5 ${isDetail ? "pb-[calc(12rem_+_env(safe-area-inset-bottom))]" : "pb-28"}`}
        >
          {portfolioError ? <div role="alert" className="mb-4 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p>{portfolioError}</p>
            <Button variant="outline" size="sm" onClick={() => void refreshPortfolio()}>Обновить портфель</Button>
          </div> : null}
          {children}
        </main>
        <nav
          aria-label="Основная навигация"
          className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t bg-background/95 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur"
        >
          <div className="grid grid-cols-5">
            {tabs.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className={`size-5 ${active ? "stroke-[2.25]" : ""}`} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
