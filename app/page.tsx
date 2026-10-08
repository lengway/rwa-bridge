"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChartNoAxesCombined, CircleHelp, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatApy, formatMoney } from "@/lib/format";
import { KZ_BOND_DEMO, ONDO_USDY } from "@/lib/yields";
import { useMarketData } from "@/lib/useMarketData";
import { formatDataDate, getStrategyApy, type DatedMetric } from "@/lib/market-data";
import { MarketDataNote } from "@/components/app/market-data-note";

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
  {
    question: "Это реальные деньги?",
    answer: "Нет. Сейчас приложение работает с тестовыми долларами в Solana devnet и демонстрационными активами. Они не имеют денежной стоимости.",
  },
  {
    question: "Как начать?",
    answer: "Войдите по email. Кошелёк Solana создаётся для вас автоматически; seed-фраза не нужна. Тестовые операции можно открыть в обозревателе сети.",
  },
  {
    question: "Что именно происходит в сети?",
    answer: "Пополнение тестовых долларов, переводы, вложения и выпуск демонстрационных токенов проходят как транзакции в Solana devnet. Расчёт доходности и стоимость долей остаются демонстрационными.",
  },
  {
    question: "Какие риски?",
    answer: "Доходность не гарантирована. Это не банковский вклад и не застраховано фондом гарантирования депозитов. Упоминание продуктов не означает партнёрство с их эмитентами.",
  },
];

export default function LandingPage() {
  const marketData = useMarketData();
  const usdyApy = getStrategyApy(ONDO_USDY.id, marketData.yields);
  const kaseApy = getStrategyApy(KZ_BOND_DEMO.id, marketData.yields);
  const usdyData = marketData.yields.usdy;
  const kaseData = marketData.yields.kaseGov;

  return (
    <main className="min-h-dvh bg-muted/40">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">RWA Bridge</Link>
          <Badge variant="outline">Прототип · Solana devnet</Badge>
        </header>

        <section className="grid gap-8 py-12 sm:grid-cols-[1.2fr_0.8fr] sm:items-center sm:py-20">
          <div className="space-y-6">
            <div className="space-y-4">
              <Badge variant="secondary">Слой доходности для банков и финтехов</Badge>
              <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
                Доход на реальных активах — так же просто, как банковский вклад
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Вход по email, кошелёк создаётся сам, все операции видны в сети Solana. Можно встроить в любое банковское или финтех-приложение.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" nativeButton={false} render={<Link href="/home" />}>
                Открыть приложение <ArrowRight />
              </Button>
              <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/demo-bank" />}>
                Посмотреть демо-банк
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Сейчас доступна тестовая сеть Solana devnet: тестовые деньги и демонстрационные активы.</p>
          </div>

          <Card className="gap-4 rounded-3xl p-5 sm:p-7">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Пример портфеля</span>
              <Badge variant="outline">Тестовые активы</Badge>
            </div>
            <p className="text-4xl font-semibold tracking-tight tabular-nums">{formatMoney(1250)}</p>
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <ChartNoAxesCombined className="size-4" /> Пример, не баланс клиента
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-4">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Ориентир USDY</p>
                <p className="mt-1 font-semibold">{formatApy(usdyApy)}</p>
                <p className="mt-1 text-xs text-muted-foreground">Данные на {formatDataDate(usdyData.asOf)}</p>
                <a href={usdyData.source.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-xs text-muted-foreground underline underline-offset-2">{usdyData.source.name}</a>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Демо-актив OFFICE</p>
                <p className="mt-1 font-semibold">от $10</p>
                <p className="mt-1 text-xs text-muted-foreground">условная стоимость доли</p>
              </div>
            </div>
          </Card>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Как это работает" title="Три шага до портфеля" description="В прототипе можно пройти пользовательский сценарий на тестовых долларах без риска для реальных средств." />
          <div className="grid gap-3 sm:grid-cols-3">
            <ValueCard icon={<ShieldCheck />} title="Войдите по email" text="Встроенный кошелёк Solana создаётся автоматически, без seed-фразы." />
            <ValueCard icon={<ChartNoAxesCombined />} title="Выберите продукт" text="Посмотрите ориентиры ставок, источники данных, условия и риски." />
            <ValueCard icon={<Building2 />} title="Проведите операцию" text="Пополните тестовые доллары, вложите их или купите демонстрационные единицы OFFICE-DEMO." />
          </div>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Продукты и ставки" title="Доходность на понятных активах" description="Показатели обновляются из указанных источников и сопровождаются датой. Это ориентиры, не обещание дохода; сделки с реальными активами не совершаются." />
          <div className="grid gap-3 sm:grid-cols-3">
            <ProductCard title="Долларовый вклад" label={`${formatApy(usdyApy)} · ориентир`} detail={`Ориентир по USDY и доходности 3-месячных казначейских векселей США: ${formatApy(marketData.yields.tbill3m.apy)}. В devnet используется vUSDY-DEMO.`} data={usdyData} secondaryData={marketData.yields.tbill3m} href="/earn/ondo-usdy" />
            <ProductCard title="Тенговые облигации" label={`${formatApy(kaseApy)} · демо`} detail="Ориентир индекса доходности гособлигаций KASE. В devnet выпускается vKZGB-DEMO, не токен облигации." data={kaseData} href="/earn/kz-bond-demo" />
            <ProductCard title="Офисное здание" label="OFFICE-DEMO · от $10" detail="Вымышленный объект для демонстрации покупки доли. Токен не подтверждает право собственности." href="/assets/demo-office" />
          </div>
        </section>

        <NetworkAssets />

        <section className="my-8 grid gap-5 rounded-3xl border bg-card p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
          <div className="space-y-2">
            <Badge variant="secondary">Партнёрская интеграция</Badge>
            <h2 className="text-2xl font-semibold tracking-tight">Для банков и финтехов</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">RWA Bridge показывает, как встроить вход по email, создание кошелька, продукты доходности и проверяемые операции в существующее приложение. Посмотрите сценарий внутри вымышленного Демо-банка.</p>
          </div>
          <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/demo-bank" />}>Открыть демо-банк <ArrowRight /></Button>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Ответы" title="Частые вопросы" description="Что работает в прототипе и что означает тестовый режим." />
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
            <h2 className="text-xl font-semibold">Попробуйте прототип</h2>
            <p className="mt-1 text-sm text-muted-foreground">Войдите по email и изучите сценарии в Solana devnet.</p>
          </div>
          <Button size="lg" nativeButton={false} render={<Link href="/home" />}>Начать <ArrowRight /></Button>
        </section>

        <footer className="border-t py-5 text-xs leading-5 text-muted-foreground">
          Прототип работает в Solana devnet с тестовыми деньгами и демонстрационными активами. Он не принимает реальные инвестиции и не является предложением ценных бумаг, банковским вкладом или финансовой рекомендацией. Токены vUSDY-DEMO, vKZGB-DEMO и OFFICE-DEMO не дают прав на реальные активы или доход. Показанная доходность не гарантирована.
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
    { label: "Тестовый доллар", ticker: "USD-DEMO", address: status?.usdMint },
    { label: "Доля долларового вклада", ticker: "vUSDY-DEMO", address: vaultMint("ondo-usdy", status?.vaultUsdyMint) },
    { label: "Доля тенговых облигаций", ticker: "vKZGB-DEMO", address: vaultMint("kz-bond-demo", status?.vaultKzgbMint) },
    { label: "Демо-объект · офис", ticker: "OFFICE-DEMO", address: status?.assetMint },
    { label: "Казначейство · token account USD", ticker: "Treasury", address: status?.treasury },
  ];

  return (
    <section className="space-y-5 py-8">
      <SectionHeading eyebrow="Проверяемая инфраструктура" title="Всё в сети" description="Адреса тестовых mint и казначейского token account загружаются из devnet API. Откройте запись в обозревателе Solana." />
      <Card className="divide-y rounded-2xl p-0">
        {addresses.map((item) => (
          <NetworkAddressRow key={item.ticker} {...item} loading={loading} />
        ))}
      </Card>
      {!loading && !status?.configured ? <p className="text-xs text-muted-foreground">Адреса появятся после настройки devnet в окружении сервера.</p> : null}
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

function ProductCard({ title, label, detail, href, data, secondaryData }: { title: string; label: string; detail: string; href: string; data?: DatedMetric; secondaryData?: DatedMetric }) {
  return (
    <Card className="h-full gap-3 rounded-2xl p-5 transition-colors hover:bg-muted/40">
      <Link href={href} className="block flex-1 space-y-3"><Badge variant="secondary" className="w-fit">{label}</Badge><h3 className="font-semibold">{title}</h3><p className="text-sm leading-5 text-muted-foreground">{detail}</p><span className="inline-flex items-center gap-1 text-sm font-medium">Подробнее <ArrowRight className="size-4" /></span></Link>
      {data ? <MarketDataNote data={data} plain /> : null}
      {secondaryData ? <MarketDataNote data={secondaryData} plain /> : null}
    </Card>
  );
}
