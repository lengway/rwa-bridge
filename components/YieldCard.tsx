"use client";

import { useEffect, useState } from "react";
import { useBalance } from "@/lib/mockBalance";
import { accrued, DEMO_DAY_MS, type YieldStrategy } from "@/lib/yields";

const DEPOSIT_AMOUNT = 20;

export function YieldCard({ strategy }: { strategy: YieldStrategy }) {
  const { usdc, positions, deposit, withdraw } = useBalance();
  const position = positions[strategy.id];
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!position) return;
    const t = setInterval(() => setNow(Date.now()), DEMO_DAY_MS / 4);
    return () => clearInterval(t);
  }, [position]);

  const earned = position ? accrued(position.principal, position.since, strategy.demoApy, now) : 0;
  const days = position ? Math.floor((now - position.since) / DEMO_DAY_MS) : 0;

  const handleDeposit = () => {
    if (!deposit(strategy.id, DEPOSIT_AMOUNT)) {
      setMessage(`не хватает баланса (есть $${usdc}, нужно $${DEPOSIT_AMOUNT}) — сначала пополни`);
      return;
    }
    setNow(Date.now());
    setMessage(null);
  };

  const handleWithdraw = () => {
    if (!position) return;
    const payout = Math.round((position.principal + earned) * 100) / 100;
    withdraw(strategy.id, payout);
    setMessage(`выведено $${payout.toFixed(2)} на баланс`);
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {strategy.name}
            {strategy.kind === "demo" && (
              <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-500">демо</span>
            )}
          </p>
          <p className="text-xs text-zinc-500">
            {strategy.ticker} · {strategy.issuer} · {strategy.apyLabel}
          </p>
        </div>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{strategy.description}</p>
      <dl className="text-xs text-zinc-500 grid gap-1">
        <div><dt className="inline">Риск: </dt><dd className="inline">{strategy.riskLabel}</dd></div>
        <div><dt className="inline">Кому доступно: </dt><dd className="inline">{strategy.eligibilityLabel}</dd></div>
        {strategy.mintAddress && strategy.sourceUrl && (
          <div>
            <dt className="inline">Токен: </dt>
            <dd className="inline">
              <a
                href={`https://solscan.io/token/${strategy.mintAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono underline underline-offset-2 break-all"
              >
                {strategy.mintAddress}
              </a>{" "}
              (
              <a href={strategy.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                адрес из документации эмитента
              </a>
              )
            </dd>
          </div>
        )}
      </dl>

      {position ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-lg bg-zinc-100 dark:bg-zinc-900 p-3 flex items-baseline justify-between">
            <span className="text-sm">Вложено ${position.principal}</span>
            <span className="text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-500">
              +${earned.toFixed(4)} за {days} дн.
            </span>
          </div>
          <button
            onClick={handleWithdraw}
            className="self-start rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Вывести всё
          </button>
        </div>
      ) : (
        <button
          onClick={handleDeposit}
          className="self-start rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Вложить ${DEPOSIT_AMOUNT} (демо)
        </button>
      )}

      <p className="text-xs text-zinc-500">Демо: 1 секунда = 1 день, депозит не уходит в блокчейн.</p>
      {message && <p className="text-xs text-zinc-500">{message}</p>}
    </div>
  );
}
