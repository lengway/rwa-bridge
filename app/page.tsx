"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChartNoAxesCombined, CircleHelp, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type KaminoMarketStatus = {
  ready?: boolean;
  network?: string;
  market?: { address?: string; name?: string };
  reserve?: { address?: string; mint?: string; symbol?: string };
};

const KAMINO_DEVNET_MARKET = "8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa";
const KAMINO_DEVNET_USDC_RESERVE = "8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const questions = [
  { question: "Как войти?", answer: "Укажите email. Кошелёк Solana создаётся автоматически." },
  { question: "Как пополнить Kamino Lend?", answer: "Выберите сумму Devnet USDC. Приложение готовит и проверяет маршрут, а транзакцию подписывает только ваш кошелёк в Solana Devnet." },
  { question: "Какая ставка применяется?", answer: "Ставка формируется протоколом Kamino Lend и может меняться. Она не является обещанием доходности и не отображается как фиксированный APR." },
  { question: "Где проверить операции?", answer: "После подтверждения подписи транзакция, рынок и reserve доступны в Solana Explorer." },
  { question: "Это денежный продукт?", answer: "Нет. Это среда Solana Devnet: Devnet USDC и позиция не имеют денежной стоимости." },
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
                Kamino Lend в Solana Devnet
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Вход по email, автоматически созданный Solana-кошелёк и пользовательская on-chain подпись. Маршрут Kamino Lend строится для Devnet, а ставка остаётся переменной ставкой протокола.
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
              <ProductMetric label="Маршрут" value="KAMINO LEND · USER-SIGNED" />
              <ProductMetric label="Ставка" value="VARIABLE PROTOCOL RATE" />
              <ProductMetric label="Среда" value="DEVNET · NO MONETARY VALUE" />
            </div>
          </Card>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Как это работает" title="Пройдите путь Kamino Lend" description="Email-вход, автоматически созданный Solana-кошелёк и проверка подтверждённой подписи в сети." />
          <div className="grid gap-3 sm:grid-cols-3">
            <ValueCard icon={<ShieldCheck />} title="Войдите по email" text="Кошелёк Solana создаётся автоматически, без seed-фразы." />
            <ValueCard icon={<ChartNoAxesCombined />} title="Подготовьте Devnet USDC" text="Для комиссии также нужен SOL в Solana Devnet. Банковская карта, KZT-перевод и фиатный платёж не используются." />
            <ValueCard icon={<Building2 />} title="Подпишите операцию" text="Приложение проверяет рынок и reserve, затем ваш кошелёк подписывает пополнение или вывод в Kamino Lend." />
          </div>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Стратегия" title="Один проверяемый маршрут Devnet" description="Kamino Lend использует закреплённые market и reserve. Банковские, KZT и off-ramp операции не входят в этот маршрут." />
          <div className="grid gap-3 sm:grid-cols-1">
            <ProductCard title="Kamino Lend" ticker="DEVNET USDC" label="SOLANA DEVNET" detail="Пользовательская on-chain подпись для supply и withdrawal в закреплённом Kamino Lend reserve. Ставка протокола переменная; Devnet USDC не имеет денежной стоимости." href="/earn/kamino-lend" />
          </div>
        </section>

        <NetworkAssets />

        <section className="my-8 grid gap-5 rounded-3xl border bg-card p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
          <div className="space-y-2">
            <Badge variant="secondary">Интеграционный статус</Badge>
            <h2 className="text-2xl font-semibold tracking-tight">Kamino Lend Devnet подключён</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Приложение строит и предварительно проверяет транзакцию для закреплённого Kamino Lend market. Подпись и отправка всегда происходят только в вашем кошельке. Банковские, KZT и off-ramp операции не входят в маршрут.</p>
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
  const [status, setStatus] = useState<KaminoMarketStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/kamino/market", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<KaminoMarketStatus> : null)
      .then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
      })
      .catch(() => {
        if (active) setStatus(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const addresses = [
    { label: "Kamino Lend market", ticker: "SOLANA DEVNET", address: status?.market?.address ?? KAMINO_DEVNET_MARKET },
    { label: "Kamino Lend reserve", ticker: status?.reserve?.symbol ?? "DEVNET USDC", address: status?.reserve?.address ?? KAMINO_DEVNET_USDC_RESERVE },
    { label: "Devnet USDC mint", ticker: "DEVNET USDC", address: status?.reserve?.mint ?? DEVNET_USDC_MINT },
  ];

  return (
    <section className="space-y-5 py-8">
      <SectionHeading eyebrow="Проверяемая инфраструктура" title="Kamino Lend · Solana Devnet" description="Закреплённые адреса market, reserve и Devnet USDC mint. Откройте запись в Solana Explorer." />
      <Card className="divide-y rounded-2xl p-0">
        {addresses.map((item) => <NetworkAddressRow key={item.label} {...item} loading={loading} />)}
      </Card>
      {!loading ? <p className="text-xs text-muted-foreground">{status?.ready ? "Маршрут проверен сервером перед подготовкой каждой транзакции." : "Доступность маршрута проверяется сервером перед подготовкой транзакции."}</p> : null}
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
