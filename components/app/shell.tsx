"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Activity, ArrowLeft, House, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBankEmbed } from "@/lib/useBankEmbed";
import { isCrossmintConfigured } from "@/lib/config";
import { useAuth } from "@/lib/useAuth";
import { useDevnet } from "@/lib/useDevnet";
import { Input } from "@/components/ui/input";
import { MockOnboardingGate } from "@/components/app/mock-onboarding-gate";
import { DemoBadge } from "@/components/app/demo-badge";

const tabs = [
  { href: "/home", label: "Home", icon: House },
  { href: "/earn", label: "Earn", icon: Landmark },
  { href: "/activity", label: "Activity", icon: Activity },
];

const secondaryLinks = [
  { href: "/assets", label: "Assets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/profile", label: "Account" },
];

const titles: Record<string, string> = {
  "/home": "Plain",
  "/funding": "Add funds",
  "/earn": "Earn",
  "/assets": "Assets",
  "/activity": "Activity",
  "/portfolio": "Portfolio",
};

const authErrorTranslations: Record<string, string> = {
  "Введите корректный email.": "Enter a valid email address.",
  "Отправка писем временно недоступна. Попробуйте позже.": "Email delivery is temporarily unavailable. Please try again later.",
  "Новый код можно запросить через минуту.": "You can request a new code in one minute.",
  "Для этого email запрошено слишком много кодов. Попробуйте позже.": "Too many codes were requested for this email. Please try again later.",
  "С этого устройства запрошено слишком много кодов. Попробуйте позже.": "Too many codes were requested from this device. Please try again later.",
  "Не удалось отправить письмо с кодом. Проверьте адрес и попробуйте позже.": "We couldn't send the code. Check the email address and try again later.",
  "Введите шестизначный код из письма.": "Enter the six-digit code from your email.",
  "Срок действия кода истёк. Запросите новый код.": "This code has expired. Request a new one.",
  "Превышено число попыток. Запросите новый код.": "Too many attempts. Request a new code.",
  "Код не найден или уже использован. Запросите новый код.": "This code was not found or has already been used. Request a new one.",
  "Неверный код. Проверьте письмо и попробуйте ещё раз.": "That code is incorrect. Check your email and try again.",
};

function presentEnglishError(message: string | null | undefined, fallback: string) {
  if (!message) return fallback;
  if (authErrorTranslations[message]) return authErrorTranslations[message];
  return /[А-Яа-яЁё]/.test(message) ? fallback : message;
}

export function AppShell({ children, embedded = false }: { children: React.ReactNode; embedded?: boolean }) {
  const { status } = useAuth();
  const pathname = usePathname();
  if (status === "loading") return <><DemoBadge /><AuthLoader /></>;
  if (status === "signed-out") return <><DemoBadge /><SignInScreen /></>;
  // Mock setup can load while wallet initialization continues in the background.
  // Existing positions, exits and confirmations must remain accessible.
  return <><DemoBadge /><MockOnboardingGate allowExit={!embedded && ["/portfolio", "/activity", "/profile"].includes(pathname)}>
    <ConnectedAppShell embedded={embedded}>{children}</ConnectedAppShell>
  </MockOnboardingGate></>;
}

function ConnectedAppShell({ children, embedded }: { children: React.ReactNode; embedded: boolean }) {
  const { status, walletAddress, walletError } = useAuth();
  if (status === "signed-in" && walletError) return <WalletConnectionError message={walletError} />;
  if (status === "loading" || (status === "signed-in" && isCrossmintConfigured && !walletAddress)) return <AuthLoader />;
  if (status === "signed-out") return <SignInScreen />;
  if (!isCrossmintConfigured) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-8">
        <section className="w-full max-w-md space-y-3 rounded-3xl border bg-background p-7 text-center shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Plain</h1>
          <p className="text-sm leading-6 text-muted-foreground">Your wallet is unavailable right now. Please try again later.</p>
        </section>
      </main>
    );
  }
  return <SignedInShell embedded={embedded}>{children}</SignedInShell>;
}

function AuthLoader() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40" aria-label="Loading">
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
        <h1 className="text-2xl font-semibold tracking-tight">Wallet unavailable</h1>
        <p role="alert" className="text-sm leading-6 text-muted-foreground">{error ?? presentEnglishError(message, "We couldn't connect your wallet. Please try again.")}</p>
        <Button className="w-full" onClick={retryWallet}>Retry connection</Button>
        <Button variant="outline" className="w-full" onClick={() => {
          void signOut().catch(() => setError("We couldn't end your server session. Try signing out again when your connection is restored."));
        }}>Sign out</Button>
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
      if (!response.ok) throw new Error(presentEnglishError(typeof result?.error === "string" ? result.error : null, "We couldn't send a sign-in code. Please try again."));
      setStep("code");
      setCode("");
      setResendIn(typeof result?.resendAfterSeconds === "number" ? result.resendAfterSeconds : 60);
      if (resend) setError(null);
    } catch (requestError) {
      setError(presentEnglishError(requestError instanceof Error ? requestError.message : null, "We couldn't send a sign-in code. Please try again."));
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
      if (!response.ok) throw new Error(presentEnglishError(typeof result?.error === "string" ? result.error : null, "We couldn't verify the code. Please try again."));
      if (!await refreshSession()) throw new Error("Your code was accepted, but we couldn't load your session. Please try again.");
    } catch (requestError) {
      setError(presentEnglishError(requestError instanceof Error ? requestError.message : null, "We couldn't verify the code. Please try again."));
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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -left-20 top-1/4 size-72 rounded-full bg-emerald-500/10 blur-3xl animate-pulse motion-reduce:animate-none" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 bottom-1/4 size-72 rounded-full bg-sky-500/10 blur-3xl animate-pulse motion-reduce:animate-none" />
      <section className="relative w-full max-w-md space-y-5 rounded-3xl border bg-card/95 p-7 shadow-xl backdrop-blur animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none sm:p-9">
        <div className="space-y-2">
          <h1 className="text-center text-2xl font-semibold tracking-tight">Plain</h1>
          <p className="text-center text-sm leading-6 text-muted-foreground">Your wallet. Your yield. One email to get started.</p>
          <p className="text-center text-xs leading-5 text-muted-foreground">Create your account → add funds → choose a strategy. Your Solana wallet is created automatically; no seed phrase is needed.</p>
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
              {busy ? "Sending…" : "Send sign-in code"}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void verifyCode(); }}>
            <p className="text-center text-sm leading-6 text-muted-foreground">We sent a code to <span className="font-medium text-foreground">{email}</span></p>
            <label className="block space-y-2 text-left text-sm font-medium">
              <span>Email code</span>
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
                aria-label="Six-digit code from your email"
                className="text-center font-mono text-xl tracking-[0.35em]"
              />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" size="lg" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Verifying…" : "Sign in"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <Button type="button" variant="link" className="h-11 px-2" onClick={changeEmail} disabled={busy}>Change email</Button>
              <Button type="button" variant="link" className="h-11 px-2" onClick={() => void requestCode(true)} disabled={busy || resendIn > 0}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </Button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

function SignedInShell({ children, embedded }: { children: React.ReactNode; embedded: boolean }) {
  const pathname = usePathname();
  const bankEmbed = useBankEmbed();
  const { portfolioError, refreshPortfolio } = useDevnet();
  const isEarnDetail = /^\/earn\/[^/]+/.test(pathname);
  const isAssetDetail = /^\/assets\/[^/]+/.test(pathname);
  const isDetail = isEarnDetail || isAssetDetail;
  const title = isEarnDetail
    ? "Earn strategy"
    : isAssetDetail
      ? "Asset details"
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
        {!embedded && pathname !== "/portfolio" ? (
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-5 backdrop-blur">
            {isDetail ? (
              <Link
                href={isEarnDetail ? "/earn" : "/assets"}
                aria-label={isEarnDetail ? "Back to Earn" : "Back to Assets"}
                className="-ml-2 inline-flex size-11 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="size-5" />
              </Link>
            ) : null}
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
          </header>
        ) : null}
        <main
          className={`flex-1 px-4 pt-5 ${isDetail ? "pb-[calc(12rem_+_env(safe-area-inset-bottom))]" : "pb-28"}`}
        >
          {portfolioError ? <div role="alert" className="mb-4 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p>{presentEnglishError(portfolioError, "We couldn't load your portfolio. Please try again.")}</p>
            <Button variant="outline" size="sm" onClick={() => void refreshPortfolio()}>Refresh portfolio</Button>
          </div> : null}
          {children}
          {!embedded ? <details className="mt-8 border-t pt-4 text-sm text-muted-foreground"><summary className="cursor-pointer">More</summary><div className="mt-3 flex flex-wrap gap-4">{secondaryLinks.map(link => <Link key={link.href} href={link.href} className="underline">{link.label}</Link>)}</div></details> : null}
        </main>
        {!embedded ? <nav
          aria-label="Primary navigation"
          className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t bg-background/95 px-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur"
        >
          <div className="grid grid-cols-3">
            {tabs.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className={`size-5 ${active ? "stroke-[2.25]" : ""}`} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </nav> : null}
      </div>
    </div>
  );
}
