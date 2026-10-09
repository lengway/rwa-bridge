"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Activity, ArrowLeft, BriefcaseBusiness, House, Landmark, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBankEmbed } from "@/lib/useBankEmbed";
import { isCrossmintConfigured } from "@/lib/config";

const tabs = [
  { href: "/home", label: "Главная", icon: House },
  { href: "/earn", label: "Доход", icon: Landmark },
  { href: "/assets", label: "Активы", icon: BriefcaseBusiness },
  { href: "/activity", label: "История", icon: Activity },
  { href: "/portfolio", label: "Портфель", icon: PieChart },
];

const titles: Record<string, string> = {
  "/home": "RWA Bridge",
  "/earn": "Доход",
  "/assets": "Активы",
  "/activity": "История",
  "/portfolio": "Портфель",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  if (!isCrossmintConfigured) return <SignInScreen />;
  return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}

function AuthenticatedAppShell({ children }: { children: React.ReactNode }) {
  const { login, status } = useCrossmintAuth();
  const { wallet } = useWallet();

  if (status === "initializing" || (status === "logged-in" && !wallet?.address)) {
    return <AuthLoader />;
  }
  if (status !== "logged-in") return <SignInScreen onLogin={login} busy={status === "in-progress"} />;
  return <SignedInShell>{children}</SignedInShell>;
}

function AuthLoader() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40" aria-label="Загрузка">
      <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-foreground" />
    </main>
  );
}

function SignInScreen({ onLogin, busy = false }: { onLogin?: () => void; busy?: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-8">
      <section className="w-full max-w-md space-y-5 rounded-3xl border bg-background p-7 text-center shadow-sm sm:p-9">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">RWA Bridge</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Доход на реальных активах. Вход по email — кошелёк Solana создаётся автоматически.
          </p>
        </div>
        <Button className="w-full" size="lg" onClick={onLogin} disabled={!onLogin || busy}>
          Войти по email
        </Button>
        <p className="text-xs text-muted-foreground">Работает в сети Solana devnet</p>
      </section>
    </main>
  );
}

function SignedInShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bankEmbed = useBankEmbed();
  const isEarnDetail = /^\/earn\/[^/]+/.test(pathname);
  const isAssetDetail = /^\/assets\/[^/]+/.test(pathname);
  const isDetail = isEarnDetail || isAssetDetail;
  const title = isEarnDetail
    ? "Детали вклада"
    : isAssetDetail
      ? "Детали актива"
      : (titles[pathname] ?? "RWA Bridge");

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
        <main className="flex-1 px-4 pb-28 pt-5">{children}</main>
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
