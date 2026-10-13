"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ProviderSheet } from "@/components/app/provider-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDataDate } from "@/lib/market-data";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useDevnet } from "@/lib/useDevnet";

function formatKzt(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function IntebixKztePath({
  amountKzt,
  usdKzt,
  asOf,
  validAmount,
  onComplete,
  onSelectAnotherMethod,
}: {
  amountKzt: number;
  usdKzt: number;
  asOf: string;
  validAmount: boolean;
  onComplete: (result: { amountKzt: number; explorerUrl: string }) => void;
  onSelectAnotherMethod: () => void;
}) {
  const devnet = useDevnet();
  const [cardEnding, setCardEnding] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountUsd = amountKzt / usdKzt;

  const pay = async () => {
    if (processing || !validAmount || !/^\d{4}$/.test(cardEnding)) return;
    setProcessing(true);
    setError(null);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      const response = await fetch("/api/devnet/kzte/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountKzt }),
      });
      const result = await response.json() as { explorerUrl?: unknown; error?: unknown };
      if (!response.ok || typeof result.explorerUrl !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Couldn't credit KZTE.");
      }
      onComplete({ amountKzt, explorerUrl: result.explorerUrl });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Couldn't credit KZTE. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ProviderSheet open title="Intebix" onOpenChange={(open) => { if (!open) onSelectAnotherMethod(); }}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-2 text-[11px] font-bold tracking-tight text-slate-900">Intebix</span>
          <div>
            <p className="text-sm font-semibold text-slate-950">Payment confirmation</p>
            <p className="text-xs text-slate-500">Transfer from the Intebix reserve</p>
          </div>
        </div>
        <div className="mt-5 space-y-3 rounded-2xl border border-slate-200 p-4 text-sm">
          <div className="flex justify-between gap-3"><span className="text-slate-500">Recipient</span><span className="text-right font-medium">Intebix · KZTE reserve</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-500">Amount</span><span className="font-semibold tabular-nums">{formatKzt(amountKzt)}</span></div>
          <div className="space-y-1">
            <label htmlFor="intebix-card-ending" className="text-slate-500">Payment method</label>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-slate-950">Bank card ··</span>
              <Input id="intebix-card-ending" type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={cardEnding} onChange={(event) => setCardEnding(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" disabled={processing} className="h-9 w-20 border-slate-300 bg-white text-slate-950" />
            </div>
          </div>
          <div className="flex justify-between gap-3"><span className="text-slate-500">Fee</span><span className="font-medium">0 ₸</span></div>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <p>≈ {formatMoney(amountUsd, "USD")} at the NBK rate as of {formatDataDate(asOf)}</p>
          <p className="font-medium text-slate-900">You&apos;ll receive {amountKzt.toLocaleString("en-US")} KZTE</p>
          <p>Intebix reserve: {devnet.kzteReserve === null ? "—" : formatQuantity(devnet.kzteReserve)} KZTE · total supply {formatQuantity(devnet.kzteSupply ?? 1_000_000_000, 0)}</p>
          <p className="mt-2">Paid on Solana devnet</p>
        </div>
        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        {validAmount && cardEnding.length > 0 && cardEnding.length !== 4 ? <p className="mt-3 text-xs text-red-600">Enter the last 4 digits of the card.</p> : null}
        <div className="mt-auto pt-5">
          <Button type="button" className="w-full bg-slate-950 text-white hover:bg-slate-800" onClick={() => void pay()} disabled={processing || !validAmount || cardEnding.length !== 4}>
            {processing ? <><LoaderCircle className="animate-spin" />Processing…</> : "Pay " + formatKzt(amountKzt)}
          </Button>
        </div>
      </div>
    </ProviderSheet>
  );
}
