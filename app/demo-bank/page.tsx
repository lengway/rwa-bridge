"use client";

import { useState } from "react";
import { ArrowLeftRight, ChartNoAxesCombined, CreditCard, Landmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const tiles = [
  { id: "transfers", label: "Переводы", icon: ArrowLeftRight },
  { id: "cards", label: "Карты", icon: CreditCard },
  { id: "savings", label: "Сбережения", icon: Landmark },
];

export default function DemoBankPage() {
  const [open, setOpen] = useState(false);

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-muted/50 px-4 py-8">
      <div className="flex min-h-[42rem] w-full max-w-sm flex-col overflow-hidden rounded-[2rem] border bg-background shadow-sm">
        <header className="space-y-2 border-b px-6 pb-5 pt-8">
          <p className="text-xs text-muted-foreground">Демо-банк · экран-пример</p>
          <p className="text-sm text-muted-foreground">Счёт ·· 4821</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">1 250 000 ₸</p>
          <p className="text-xs text-muted-foreground">Условный баланс</p>
        </header>

        <section className="grid grid-cols-2 gap-3 p-5" aria-label="Разделы приложения">
          {tiles.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              disabled
              className="flex min-h-24 flex-col items-start justify-between rounded-2xl border bg-card p-4 text-left text-sm font-medium text-muted-foreground disabled:cursor-default"
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-24 flex-col items-start justify-between rounded-2xl border bg-card p-4 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChartNoAxesCombined className="size-5" />
            Инвестиции
          </button>
        </section>

        <Card className="mx-5 mt-auto mb-5 gap-2 rounded-2xl bg-muted/40 p-4">
          <p className="text-sm font-medium">Демо-сценарий</p>
          <p className="text-xs leading-5 text-muted-foreground">
            Выберите «Инвестиции», чтобы открыть RWA Bridge внутри банковского экрана.
          </p>
        </Card>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="h-dvh max-h-dvh gap-0 rounded-none p-0"
        >
          <SheetHeader className="flex-row items-center border-b px-4 py-3 text-left">
            <div className="min-w-0 flex-1">
              <SheetTitle>Инвестиции</SheetTitle>
              <SheetDescription>Демонстрационный экран</SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Закрыть"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </SheetHeader>
          <iframe
            src="/home"
            title="RWA Bridge внутри демо-банка"
            className="h-full min-h-0 w-full flex-1 border-0"
          />
        </SheetContent>
      </Sheet>
    </main>
  );
}
