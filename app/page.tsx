"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChartNoAxesCombined, CircleHelp, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type DevnetStatus = {
  configured?: boolean;
  usdMint?: string | null;
  assetMint?: string | null;
  vaultUsdyMint?: string | null;
  vaultKzgbMint?: string | null;
  kzteMint?: string | null;
  treasury?: string | null;
};

type VaultQuote = { productId: string; mint: string; ticker: string };

const questions = [
  { question: "Как войти?", answer: "Укажите email. Кошелёк Solana создаётся автоматически." },
  { question: "Как формируется цена Devnet-доли?", answer: "Одна подтверждённая тестовая единица в Solana Devnet соответствует одной Devnet-доле. Иллюстративная доходность не меняет баланс или цену погашения." },
  { question: "Где проверить операции?", answer: "После подтверждения подписи Devnet-операции и адреса токенов доступны в Solana Explorer." },
  { question: "Это реальный инвестиционный продукт?", answer: "Нет. Это среда Solana Devnet: финансирование и выплата симулированы, а токены и записи не имеют денежной стоимости." },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-muted/40">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">Plain</Link>
        </header>

        <section className="grid gap-8 py-12 sm:grid-cols-[1.2fr_0.8fr] sm:items-center sm:py-20">
          <div className="space-y-6">
            <div className="space-y-4">
              <Badge variant="secondary">SOLANA DEVNET · Universal Earn Gateway</Badge>
              <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
                Проверяемый путь Solana Devnet для Earn
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Вход по email, автоматически созданный Solana-кошелёк и подтверждаемые тестовые операции. SIMULATED FUNDING, ILLUSTRATIVE YIELD и NO MONETARY VALUE обозначены явно.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" nativeButton={false} render={<Link href="/home" />}>
                Открыть приложение <ArrowRight />
              </Button>
              <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/earn" />}>
                Посмотреть Devnet-стратегию
              </Button>
            </div>
          </div>

          <Card className="gap-4 rounded-3xl p-5 sm:p-7">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Статус Devnet</span>
              <ChartNoAxesCombined className="size-4 text-emerald-700 dark:text-emerald-400" />
            </div>
            <div className="grid gap-3">
              <ProductMetric label="Solana Devnet Strategy" value="ENABLED" />
              <ProductMetric label="Доходность" value="ILLUSTRATIVE · not accrued" />
              <ProductMetric label="Финансирование / погашение" value="SIMULATED · test tokens only" />
            </div>
          </Card>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Как это работает" title="Пройдите точный Devnet-путь" description="Email-вход, автоматически созданный Solana-кошелёк и проверка подтверждённой подписи в сети." />
          <div className="grid gap-3 sm:grid-cols-3">
            <ValueCard icon={<ShieldCheck />} title="Войдите по email" text="Кошелёк Solana создаётся автоматически, без seed-фразы." />
            <ValueCard icon={<ChartNoAxesCombined />} title="Подготовьте тестовые единицы" text="SIMULATED FUNDING не принимает фиат и не представляет банковский или карточный платёж." />
            <ValueCard icon={<Building2 />} title="Подтвердите Devnet-операцию" text="Devnet-доли выпускаются или погашаются только после проверки подписи, суммы и сети." />
          </div>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Стратегия" title="Одна честно реализованная Devnet-стратегия" description="Внешние протоколы, KZT-рельсы и off-ramp не включены без подтверждённой интеграции и доступности." />
          <div className="grid gap-3 sm:grid-cols-1">
            <ProductCard title="Solana Devnet Strategy" ticker="vUSDY · TEST TOKEN" label="SOLANA DEVNET" detail="Подтверждённый пользовательский перевод тестового токена выпускает Devnet-долю 1:1. ILLUSTRATIVE YIELD не является заработанным или on-chain доходом." href="/earn/ondo-usdy" />
          </div>
        </section>

        <NetworkAssets />

        <section className="my-8 grid gap-5 rounded-3xl border bg-card p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
          <div className="space-y-2">
            <Badge variant="secondary">Интеграционный статус</Badge>
            <h2 className="text-2xl font-semibold tracking-tight">Готово для Devnet-оценки</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Здесь нет заявления о банковской, KZT, Kamino, Crossmint или off-ramp интеграции. Эти адаптеры остаются выключенными до отдельной проверки.</p>
          </div>
          <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/earn" />}>Открыть Devnet-стратегию <ArrowRight /></Button>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Ответы" title="Частые вопросы" description="Ключевые сведения о продуктах и операциях." />
          <div className="space-y-2">
            {questions.map(({ question, answer }) => (
              <Collapsible key={question}>
                <Card className="rounded-2xl p-0">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left font-medium">
                    <span>{question}</span><CircleHelp className="size-4 text-muted-foreground" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-4 py-3 text-sm leading-5 text-muted-foreground">{answer}</CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        </section>

        <section className="my-8 flex flex-col gap-4 rounded-3xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="text-xl font-semibold">Откройте приложение</h2>
            <p className="mt-1 text-sm text-muted-foreground">Войдите по email и проверьте путь Solana Devnet без денежной стоимости.</p>
          </div>
          <Button size="lg" nativeButton={false} render={<Link href="/home" />}>Начать <ArrowRight /></Button>
        </section>

        <footer className="border-t py-5 text-xs leading-5 text-muted-foreground">
          Работает только в Solana Devnet. NO MONETARY VALUE. Не является инвестиционной рекомендацией.
        </footer>
      </div>
    </main>
  );
}

function NetworkAssets() {
  const [status, setStatus] = useState<DevnetStatus | null>(null);
  const [quotes, setQuotes] = useState<VaultQuote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/devnet/status", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<DevnetStatus> : null),
      fetch("/api/devnet/vaults", { cache: "no-store" }).then(async (response) => response.ok ? await response.json() as VaultQuote[] : []),
    ]).then(([nextStatus, nextQuotes]) => {
      if (!active) return;
      setStatus(nextStatus);
      setQuotes(Array.isArray(nextQuotes) ? nextQuotes : []);
    }).catch(() => {
      if (active) {
        setStatus(null);
        setQuotes([]);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const vaultMint = (productId: string, fallback: string | null | undefined) => quotes.find((quote) => quote.productId === productId)?.mint || fallback || null;
  const addresses = [
    { label: "Тестовый quote token", ticker: "QUOTE · TEST TOKEN", address: status?.usdMint },
    { label: "Доля Earn в Solana Devnet", ticker: "vUSDY · TEST TOKEN", address: vaultMint("ondo-usdy", status?.vaultUsdyMint) },
    { label: "Казначейство тестового quote token", ticker: "Treasury", address: status?.treasury },
  ];

  return (
    <section className="space-y-5 py-8">
      <SectionHeading eyebrow="Проверяемая инфраструктура" title="Только Devnet" description="Mint-адреса стратегии Solana Devnet и казначейства. Откройте запись в Solana Explorer." />
      <Card className="divide-y rounded-2xl p-0">
        {addresses.map((item) => <NetworkAddressRow key={item.ticker} {...item} loading={loading} />)}
      </Card>
      {!loading && !status?.configured ? <p className="text-xs text-muted-foreground">Адреса появятся после настройки сети в окружении сервера.</p> : null}
    </section>
  );
}

function NetworkAddressRow({ label, ticker, address, loading }: { label: string; ticker: string; address?: string | null; loading: boolean }) {
  const shortAddress = address ? `${address.slice(0, 7)}…${address.slice(-6)}` : null;
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Адрес скопирован");
    } catch {
      toast.error("Не удалось скопировать адрес");
    }
  };

  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{ticker} · {loading ? "Загружаем адрес…" : shortAddress ?? "Пока не настроен"}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={copy} disabled={!address} aria-label={`Скопировать ${ticker}`}><Copy />Копировать</Button>
        {address ? <Button variant="ghost" size="sm" nativeButton={false} render={<a href={`https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`} target="_blank" rel="noopener noreferrer" />}><ExternalLink />Explorer</Button> : null}
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="space-y-1"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><p className="max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p></div>;
}

function ValueCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <Card className="gap-3 rounded-2xl p-5"><span className="flex size-10 items-center justify-center rounded-full bg-muted [&_svg]:size-5">{icon}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{text}</p></div></Card>;
}

function ProductMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function ProductCard({ title, ticker, label, detail, href }: { title: string; ticker: string; label: string; detail: string; href: string }) {
  return (
    <Card className="h-full gap-3 rounded-2xl p-5 transition-colors hover:bg-muted/40">
      <Link href={href} className="block flex-1 space-y-3"><Badge variant="secondary" className="w-fit">{label}</Badge><h3 className="font-semibold">{title}</h3><p className="text-xs font-medium text-muted-foreground">{ticker}</p><p className="text-sm leading-5 text-muted-foreground">{detail}</p><span className="inline-flex items-center gap-1 text-sm font-medium">Подробнее <ArrowRight className="size-4" /></span></Link>
    </Card>
  );
}
