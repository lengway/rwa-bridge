import Link from "next/link";
import { LoginPanel } from "@/components/LoginPanel";
import { OnrampButton } from "@/components/OnrampButton";
import { AssetCard } from "@/components/AssetCard";
import { BalanceBadge } from "@/components/BalanceBadge";
import { BalanceProvider } from "@/lib/mockBalance";
import { DEMO_ASSETS } from "@/lib/assets";

export default function PortfolioPage() {
  return (
    <BalanceProvider>
      <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
        <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-12 flex flex-col gap-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              &larr; назад
            </Link>
            <h1 className="text-lg font-semibold">Портфель</h1>
            <div />
          </div>

          <section className="flex flex-col gap-3">
            <LoginPanel />
          </section>

          <BalanceBadge />

          <section className="flex flex-col gap-3">
            <p className="text-sm text-zinc-500">шаг 1 — пополнить баланс</p>
            <OnrampButton />
          </section>

          <section className="flex flex-col gap-3">
            <p className="text-sm text-zinc-500">шаг 2 — купить долю в активе</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {DEMO_ASSETS.map((asset) => (
                <AssetCard key={asset.id} asset={asset} />
              ))}
            </div>
          </section>
        </main>
      </div>
    </BalanceProvider>
  );
}
