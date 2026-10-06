import Link from "next/link";
import { ArrowRight, Building2, ChartNoAxesCombined, CircleHelp, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatApy, formatMoney } from "@/lib/format";
import { KZ_BOND_DEMO, ONDO_USDY } from "@/lib/yields";

const questions = [
  {
    question: "Это крипта?",
    answer: "Здесь показан понятный интерфейс для цифровых активов. Вход, баланс и покупки работают в демо-режиме.",
  },
  {
    question: "Где мои деньги?",
    answer: "В этой версии реальные деньги не переводятся. Демо-баланс хранится в браузере на вашем устройстве.",
  },
  {
    question: "Какие риски?",
    answer: "Стоимость и доходность могут меняться, вложения могут потерять стоимость. Это не банковский вклад и не застраховано фондом гарантирования депозитов.",
  },
  {
    question: "Что значит демо?",
    answer: "Покупки и начисления симулируются. Демо-токены не дают права на реальную недвижимость или доход.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-muted/40">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">RWA Bridge</Link>
          <Badge variant="outline">Демо-приложение</Badge>
        </header>

        <section className="grid gap-8 py-12 sm:grid-cols-[1.2fr_0.8fr] sm:items-center sm:py-20">
          <div className="space-y-6">
            <div className="space-y-4">
              <Badge variant="secondary">Инвестиции понятным языком</Badge>
              <h1 className="max-w-xl text-4xl font-semibold tracking-tight sm:text-6xl">
                Активы, которые можно понять с первого шага
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                Посмотрите, как цифровые доллары (USDC) и доли реальных активов могут выглядеть в одном приложении.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                nativeButton={false}
                render={<Link href="/home" />}
              >
                Начать <ArrowRight />
              </Button>
              <Link href="/demo-bank" className="inline-flex h-9 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted">
                Посмотреть демо-банк
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">Вход не нужен. Все суммы и операции в приложении — демонстрационные.</p>
          </div>

          <Card className="gap-4 rounded-3xl p-5 sm:p-7">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Ваш капитал</span>
              <span className="size-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            </div>
            <p className="text-4xl font-semibold tracking-tight tabular-nums">
              {formatMoney(1250)}
            </p>
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <ChartNoAxesCombined className="size-4" />
              Пример демо-портфеля
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-4">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Долларовый вклад</p>
                <p className="mt-1 font-semibold">{formatApy(ONDO_USDY.demoApy)}</p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Доля недвижимости</p>
                <p className="mt-1 font-semibold">от $10</p>
              </div>
            </div>
          </Card>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading
            eyebrow="Понятные шаги"
            title="Начните с простого"
            description="Можно изучить сценарий и проверить интерфейс без входа и реальных денег."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <ValueCard
              icon={<ShieldCheck />}
              title="Пополните баланс"
              text="Выберите сумму и способ. Демо-методы не списывают деньги."
            />
            <ValueCard
              icon={<ChartNoAxesCombined />}
              title="Посмотрите доход"
              text="Сравните понятные ориентиры, условия и риски продуктов."
            />
            <ValueCard
              icon={<Building2 />}
              title="Купите долю"
              text="Попробуйте сценарий покупки демо-доли в офисной недвижимости."
            />
          </div>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading
            eyebrow="Примеры продуктов"
            title="Выберите, с чего начать"
            description="Показатели снабжены источником и датой. Они не являются обещанием дохода."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <ProductCard
              title="Долларовый вклад"
              label={`${formatApy(ONDO_USDY.demoApy)} · ориентир`}
              detail={ONDO_USDY.apyLabel}
              href="/earn/ondo-usdy"
            />
            <ProductCard
              title="Тенговые облигации"
              label="Демо"
              detail={KZ_BOND_DEMO.apyLabel}
              href="/earn/kz-bond-demo"
            />
            <ProductCard
              title="Iconic Tower"
              label="Демо-доля · от $10"
              detail="1 ICT-DEMO = $1 условной доли."
              href="/assets/aifc-mock-iconic-tower"
            />
          </div>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading
            eyebrow="Ответы"
            title="Частые вопросы"
            description="Коротко о приложении и демонстрационных сценариях."
          />
          <div className="space-y-2">
            {questions.map(({ question, answer }) => (
              <Collapsible key={question}>
                <Card className="rounded-2xl p-0">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left font-medium">
                    <span>{question}</span>
                    <CircleHelp className="size-4 text-muted-foreground" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-4 py-3 text-sm leading-5 text-muted-foreground">
                    {answer}
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        </section>

        <section className="my-8 flex flex-col gap-4 rounded-3xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="text-xl font-semibold">Попробуйте демо</h2>
            <p className="mt-1 text-sm text-muted-foreground">Начните без входа и изучите основные сценарии.</p>
          </div>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/home" />}
          >
            Начать <ArrowRight />
          </Button>
        </section>

        <footer className="border-t py-5 text-xs leading-5 text-muted-foreground">
          Демо-приложение: не является инвестиционным предложением. Упоминание продуктов и платёжных методов не означает партнёрство с их эмитентами или организациями.
        </footer>
      </div>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function ValueCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <Card className="gap-3 rounded-2xl p-5">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted [&_svg]:size-5">
        {icon}
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{text}</p>
      </div>
    </Card>
  );
}

function ProductCard({
  title,
  label,
  detail,
  href,
}: {
  title: string;
  label: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full gap-3 rounded-2xl p-5 transition-colors hover:bg-muted/40">
        <Badge variant="secondary" className="w-fit">{label}</Badge>
        <h3 className="font-semibold">{title}</h3>
        <p className="flex-1 text-sm leading-5 text-muted-foreground">{detail}</p>
        <span className="inline-flex items-center gap-1 text-sm font-medium">
          Подробнее <ArrowRight className="size-4" />
        </span>
      </Card>
    </Link>
  );
}
