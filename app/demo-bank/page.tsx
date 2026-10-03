"use client";

import { useState } from "react";

const TILES = [
  { id: "transfers", label: "Переводы" },
  { id: "tokens", label: "Токены" },
  { id: "payments", label: "Платежи" },
  { id: "deposit", label: "Депозит" },
];

export default function DemoBankPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-100 dark:bg-zinc-950 py-8 px-4">
      <div className="relative w-full max-w-sm h-[720px] rounded-[2.5rem] border border-zinc-300 dark:border-zinc-700 bg-background overflow-hidden flex flex-col">
        <header className="px-6 pt-8 pb-4 flex flex-col gap-1">
          <p className="text-xs text-zinc-500">Демо-банк (не реальное приложение)</p>
          <p className="text-sm text-zinc-500">Карта •• 4821</p>
          <p className="text-3xl font-semibold tabular-nums">1 250 000 ₸</p>
        </header>

        <section className="px-6 grid grid-cols-2 gap-3">
          {TILES.map((t) => (
            <button
              key={t.id}
              onClick={() => t.id === "tokens" && setOpen(true)}
              className={`rounded-xl border p-4 text-sm text-left ${
                t.id === "tokens"
                  ? "border-foreground font-medium"
                  : "border-zinc-200 dark:border-zinc-800 text-zinc-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </section>

        <p className="px-6 pt-4 text-xs text-zinc-500">
          Нажми «Токены»: плитка открывает RWA Bridge внутри банковского экрана.
        </p>

        {open && (
          <div className="absolute inset-0 flex flex-col bg-background">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-sm font-medium">Токены</span>
              <button onClick={() => setOpen(false)} className="text-sm text-zinc-500 hover:text-foreground">
                закрыть
              </button>
            </div>
            <iframe src="/portfolio" title="RWA Bridge внутри банка" className="flex-1 w-full border-0" />
          </div>
        )}
      </div>
    </div>
  );
}
