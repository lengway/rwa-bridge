"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AccountSection, WalletSection } from "@/components/app/profile-account";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/lib/store";

export function ProfileScreen() {
  const { displayCurrency, setDisplayCurrency, resetDemo } = useAppStore();
  const [confirmReset, setConfirmReset] = useState(false);
  const reset = () => {
    resetDemo();
    setConfirmReset(false);
    toast.success("Демо-данные сброшены");
  };

  return (
    <div className="space-y-6">
      <AccountSection />
      <PreferenceSection currency={displayCurrency} onCurrencyChange={setDisplayCurrency} />
      <ThemeSection />
      <WalletSection />
      <DemoInfoSection />
      <Card className="gap-3 rounded-2xl p-4">
        <div>
          <h2 className="font-semibold">Демо-данные</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            Сброс удалит баланс, вклады, активы и историю на этом устройстве.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => setConfirmReset(true)}>
          <RotateCcw />Сбросить демо-данные
        </Button>
      </Card>
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сбросить демо-данные?</DialogTitle>
            <DialogDescription>
              Баланс, вклады, купленные доли и история операций будут удалены без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={reset}>Сбросить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreferenceSection({
  currency,
  onCurrencyChange,
}: {
  currency: "USD" | "KZT";
  onCurrencyChange: (currency: "USD" | "KZT") => void;
}) {
  return (
    <Card className="gap-4 rounded-2xl p-4">
      <div>
        <h2 className="font-semibold">Валюта отображения</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Пересчёт в тенге — по демо-курсу 480 ₸ за $1.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["USD", "KZT"] as const).map((value) => (
          <Button
            key={value}
            variant={currency === value ? "secondary" : "outline"}
            aria-pressed={currency === value}
            onClick={() => onCurrencyChange(value)}
          >
            {currency === value ? <Check /> : null}
            {value === "USD" ? "Доллары · USD" : "Тенге · ₸"}
          </Button>
        ))}
      </div>
    </Card>
  );
}

function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const selected = theme ?? "system";
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

function DemoInfoSection() {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <h2 className="font-semibold">О демо-режиме</h2>
      <p className="text-sm leading-5 text-muted-foreground">
        Баланс, вклады, покупки и начисления здесь симулируются и хранятся в браузере. Реальные деньги не переводятся.
      </p>
      <p className="text-sm leading-5 text-muted-foreground">
        Начисления ускорены: 1 секунда = 1 день. Доход не гарантирован. Не банковский вклад, не застраховано фондом гарантирования депозитов.
      </p>
    </Card>
  );
}
