"use client";

import Link from "next/link";
import { useCrossmintAuth } from "@crossmint/client-sdk-react-ui";
import { ArrowDownToLine, ArrowUpFromLine, Plus, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { isCrossmintConfigured } from "@/lib/config";

export function QuickActions({
  onAddMoney,
  onWithdraw,
}: {
  onAddMoney: () => void;
  onWithdraw: () => void;
}) {
  return (
    <section aria-label="Быстрые действия" className="grid grid-cols-4 gap-2">
      <QuickAction label="Пополнить" icon={<Plus />} onClick={onAddMoney} />
      <QuickAction label="Вложить" icon={<ArrowDownToLine />} href="/earn" />
      <QuickAction label="Купить долю" icon={<ShoppingBag />} href="/assets" />
      <QuickAction label="Вывести" icon={<ArrowUpFromLine />} onClick={onWithdraw} />
    </section>
  );
}

function QuickAction({
  label,
  icon,
  href,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex size-14 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-accent [&_svg]:size-5">
        {icon}
      </span>
      <span className="text-center text-[11px] font-medium leading-tight">{label}</span>
    </>
  );
  const className = "group flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground";
  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  );
}

export function OnboardingChecklist({
  hasCash,
  hasPosition,
  onAddMoney,
}: {
  hasCash: boolean;
  hasPosition: boolean;
  onAddMoney: () => void;
}) {
  const done = Number(hasCash) + Number(hasPosition);

  return (
    <Card className="gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold">Начните с простых шагов</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Можно попробовать без входа и реальных денег.
          </p>
        </div>
        <Badge variant="outline">{done}/2</Badge>
      </div>
      <Progress value={done * 50} aria-label="Прогресс знакомства" />
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span>Войти по email <span className="text-xs text-muted-foreground">(необязательно)</span></span>
          <LoginChecklistAction />
        </div>
        <button
          type="button"
          onClick={onAddMoney}
          className="flex w-full items-center justify-between text-left"
        >
          <span>Пополнить баланс</span>
          <span className="text-xs text-muted-foreground">{hasCash ? "Готово" : "Добавить"}</span>
        </button>
        <Link href="/earn" className="flex items-center justify-between">
          <span>Открыть первый вклад</span>
          <span className="text-xs text-muted-foreground">{hasPosition ? "Готово" : "Выбрать"}</span>
        </Link>
      </div>
    </Card>
  );
}

function LoginChecklistAction() {
  if (!isCrossmintConfigured) {
    return <span className="text-xs text-muted-foreground">Демо доступно без входа</span>;
  }
  return <LoginChecklistActionReady />;
}

function LoginChecklistActionReady() {
  const { login, status } = useCrossmintAuth();
  if (status === "logged-in") {
    return <span className="text-xs text-emerald-700 dark:text-emerald-400">Выполнено</span>;
  }
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={login}>
      Войти
    </Button>
  );
}
