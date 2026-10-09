"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChartNoAxesCombined, CircleHelp, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatApy } from "@/lib/format";
import { KZ_BOND, ONDO_USDY } from "@/lib/yields";
import { useMarketData } from "@/lib/useMarketData";
import { formatDataDate, getStrategyApy, type DatedMetric } from "@/lib/market-data";
import { MarketDataNote, marketApyLabel } from "@/components/app/market-data-note";

type DevnetStatus = {
  configured?: boolean;
  usdMint?: string | null;
  assetMint?: string | null;
  vaultUsdyMint?: string | null;
  vaultKzgbMint?: string | null;
  treasury?: string | null;
};

type VaultQuote = { productId: string; mint: string; ticker: string; priceUsd: number; apy: number };

const questions = [
  { question: "Как войти?", answer: "Укажите email. Кошелёк Solana создаётся автоматически." },
  { question: "Как формируется цена доли?", answer: "Для vUSDY цена следует доходности USDY, публикуемой Ondo через DefiLlama. Для vKZGB используется ориентир индекса государственных облигаций KASE." },
  { question: "Где проверить операции?", answer: "Подтверждённые операции и адреса токенов доступны в обозревателе Solana." },
  { question: "Какие риски?", answer: "Доходность не гарантирована. Это не банковский вклад и не застраховано фондом гарантирования депозитов." },
];

export default function LandingPage() {
  const marketData = useMarketData();
  const usdyApy = getStrategyApy(ONDO_USDY.id, marketData.yields);
  const kaseApy = getStrategyApy(KZ_BOND.id, marketData.yields);

  return (
    <main className="min-h-dvh bg-muted/40">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">RWA Bridge</Link>
        </header>

        <section className="grid gap-8 py-12 sm:grid-cols-[1.2fr_0.8fr] sm:items-center sm:py-20">
          <div className="space-y-6">
            <div className="space-y-4">
              <Badge variant="secondary">Слой доходности для банков и финтехов</Badge>
              <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
                Доход на реальных активах — так же просто, как банковский вклад
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Вход по email, кошелёк создаётся автоматически, операции доступны в обозревателе Solana. Продукт можно встроить в банковское или финтех-приложение.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" nativeButton={false} render={<Link href="/home" />}>
                Открыть приложение <ArrowRight />
              </Button>
              <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/bank" />}>
                Посмотреть в банковском приложении
              </Button>
            </div>
          </div>

          <Card className="gap-4 rounded-3xl p-5 sm:p-7">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Продукты</span>
              <ChartNoAxesCombined className="size-4 text-emerald-700 dark:text-emerald-400" />
            </div>
            <div className="grid gap-3">
              <ProductMetric label="Долларовый вклад · vUSDY" value={marketApyLabel(usdyApy, marketData.availability.usdy)} date={marketData.availability.usdy ? marketData.yields.usdy.asOf : undefined} />
              <ProductMetric label="Тенговые облигации · vKZGB" value={formatApy(kaseApy)} date={marketData.yields.kaseGov.asOf} />
              <ProductMetric label="Офисное здание класса A · OFFICE" value="1 токен = $1 доли объекта" />
            </div>
          </Card>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Как это работает" title="Управляйте портфелем в одном приложении" description="Email-вход, автоматически созданный кошелёк Solana и подтверждаемые операции в сети." />
          <div className="grid gap-3 sm:grid-cols-3">
            <ValueCard icon={<ShieldCheck />} title="Войдите по email" text="Кошелёк Solana создаётся автоматически, без seed-фразы." />
            <ValueCard icon={<ChartNoAxesCombined />} title="Выберите продукт" text="Изучите ориентиры ставок, источники данных, условия и риски." />
            <ValueCard icon={<Building2 />} title="Управляйте активами" text="Пополняйте баланс, вкладывайте средства и покупайте доли объекта." />
          </div>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Продукты и ставки" title="Доходность на понятных активах" description="Показатели обновляются из указанных источников и сопровождаются датой. Доход не гарантирован." />
          <div className="grid gap-3 sm:grid-cols-3">
            <ProductCard title="Долларовый вклад" ticker="vUSDY" label={`${marketApyLabel(usdyApy, marketData.availability.usdy)} · ориентир`} detail="Цена доли следует доходности USDY, публикуемой Ondo через DefiLlama." data={marketData.availability.usdy ? marketData.yields.usdy : null} secondaryData={marketData.availability.tbill3m ? marketData.yields.tbill3m : null} href="/earn/ondo-usdy" />
            <ProductCard title="Тенговые облигации" ticker="vKZGB" label={`${formatApy(kaseApy)} · ориентир`} detail="Ориентир — индекс государственных облигаций KASE." data={marketData.yields.kaseGov} href="/earn/kz-bond" />
            <ProductCard title="Офисное здание класса A" ticker="OFFICE" label="От $10" detail="1 OFFICE = $1 доли объекта." href="/assets/office-building" />
          </div>
        </section>

        <NetworkAssets />

        <section className="my-8 grid gap-5 rounded-3xl border bg-card p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
          <div className="space-y-2">
            <Badge variant="secondary">Банковская интеграция</Badge>
            <h2 className="text-2xl font-semibold tracking-tight">Для банков и финтехов</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Встраивание RWA Bridge добавляет вход по email, кошелёк Solana, продукты доходности и проверяемые операции в существующее приложение.</p>
          </div>
          <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/bank" />}>Открыть банковское приложение <ArrowRight /></Button>
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
            <p className="mt-1 text-sm text-muted-foreground">Войдите по email и управляйте активами.</p>
          </div>
          <Button size="lg" nativeButton={false} render={<Link href="/home" />}>Начать <ArrowRight /></Button>
        </section>

        <footer className="border-t py-5 text-xs leading-5 text-muted-foreground">
          Работает в сети Solana devnet. Не является инвестиционной рекомендацией.
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
    { label: "Тестовый доллар", ticker: "USD", address: status?.usdMint },
    { label: "Доля долларового вклада", ticker: "vUSDY", address: vaultMint("ondo-usdy", status?.vaultUsdyMint) },
    { label: "Доля тенговых облигаций", ticker: "vKZGB", address: vaultMint("kz-bond-demo", status?.vaultKzgbMint) },
    { label: "Офисное здание класса A", ticker: "OFFICE", address: status?.assetMint },
    { label: "Казначейство · token account USD", ticker: "Treasury", address: status?.treasury },
  ];

  return (
    <section className="space-y-5 py-8">
      <SectionHeading eyebrow="Проверяемая инфраструктура" title="Всё в сети" description="Mint-адреса продуктов и казначейства. Откройте запись в обозревателе Solana." />
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

function ProductMetric({ label, value, date }: { label: string; value: string; date?: string }) {
  return <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p>{date ? <p className="mt-1 text-xs text-muted-foreground">Данные на {formatDataDate(date)}</p> : null}</div>;
}

function ProductCard({ title, ticker, label, detail, href, data, secondaryData }: { title: string; ticker: string; label: string; detail: string; href: string; data?: DatedMetric | null; secondaryData?: DatedMetric | null }) {
  return (
    <Card className="h-full gap-3 rounded-2xl p-5 transition-colors hover:bg-muted/40">
      <Link href={href} className="block flex-1 space-y-3"><Badge variant="secondary" className="w-fit">{label}</Badge><h3 className="font-semibold">{title}</h3><p className="text-xs font-medium text-muted-foreground">{ticker}</p><p className="text-sm leading-5 text-muted-foreground">{detail}</p><span className="inline-flex items-center gap-1 text-sm font-medium">Подробнее <ArrowRight className="size-4" /></span></Link>
      {data !== undefined ? <MarketDataNote data={data} plain /> : null}
      {secondaryData !== undefined ? <p className="text-xs text-muted-foreground">Доходность 3-месячных казначейских векселей США: {secondaryData ? marketApyLabel(secondaryData.apy, true) : "источник временно недоступен"}. {secondaryData ? <MarketDataNote data={secondaryData} /> : null}</p> : null}
    </Card>
  );
}
