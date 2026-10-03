"use client";

import { useBalance } from "@/lib/mockBalance";

export function BalanceBadge() {
  const { usdc } = useBalance();
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between">
      <span className="text-sm text-zinc-500">Баланс (демо)</span>
      <span className="text-lg font-semibold tabular-nums">${usdc}</span>
    </div>
  );
}
