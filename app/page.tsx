import Link from "next/link";
import { LoginPanel } from "@/components/LoginPanel";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 dark:bg-black px-6">
      <main className="flex w-full max-w-md flex-col gap-8 items-center text-center">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">RWA Bridge</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Один вход — портфель из токенизированных акций и недвижимости. Без слов «кошелёк», «газ» или «сеть».
          </p>
        </div>
        <LoginPanel />
        <Link href="/portfolio" className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
          перейти в портфель без входа (демо-режим)
        </Link>
      </main>
    </div>
  );
}
