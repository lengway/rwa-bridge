"use client";

import { useEffect, useState } from "react";
import { formatDataDate } from "@/lib/market-data";

type Quote = {
  provider: "transak" | "moonpay";
  side: "buy" | "sell";
  amount: number;
  cryptoAmount: number;
  cryptoCode: "USDC" | "SOL";
  feeUsd: number;
  asOf: string;
  source: { name: string; url: string };
  stale: boolean;
};

export function ProviderQuote({
  provider,
  side,
  amount,
  valid,
}: {
  provider: "transak" | "moonpay";
  side: "buy" | "sell";
  amount: number;
  valid: boolean;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!valid || !Number.isFinite(amount)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ provider, side, amount: amount.toFixed(2) });
      fetch(`/api/quotes?${params.toString()}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("quote unavailable");
          return response.json() as Promise<Quote>;
        })
        .then((value) => {
          if (active) setQuote(value);
        })
        .catch(() => {
          if (active) setQuote(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [amount, provider, side, valid]);

  if (!valid) return null;
  const matchingQuote = quote
    && quote.provider === provider
    && quote.side === side
    && quote.amount === Number(amount.toFixed(2))
    ? quote
    : null;
  if (!matchingQuote) {
    return loading ? <p className="text-xs text-muted-foreground">Считаем котировку…</p> : null;
  }

  const amountLabel = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(matchingQuote.cryptoAmount);
  const feeLabel = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(matchingQuote.feeUsd);
  const dateLabel = formatDataDate(matchingQuote.asOf);

  return (
    <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
      <p className="text-sm text-foreground">
        {side === "buy"
          ? `Вы получите ≈ ${amountLabel} ${matchingQuote.cryptoCode} · комиссия ≈ $${feeLabel}`
          : `≈ ${amountLabel} ${matchingQuote.cryptoCode} на выплату · комиссия ≈ $${feeLabel}`}
      </p>
      <p>
        <a href={matchingQuote.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {matchingQuote.source.name}
        </a>
        {" · котировка на "}{dateLabel}{matchingQuote.stale ? " · последняя сохранённая котировка" : null}
      </p>
    </div>
  );
}
