"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CreditCard,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useDevnet } from "@/lib/useDevnet";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Overview = {
  walletAddress: string;
  network: string;
  protocolGainAtomic: string | null;
  supplyApy: number | null;
  dailyEstimate: { gross: number; fee: number; net: number } | null;
  performanceFeeBps: number;
  feeCollectionEnabled: boolean;
};
const money = (amount: number) =>
  amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });

export function EarnJourney() {
  const devnet = useDevnet();
  const walletAddress = devnet.walletAddress;
  const funded = devnet.portfolio !== null && devnet.portfolio.cashUsd > 0;
  const invested =
    devnet.portfolio?.positions.some(
      (position) => position.productId === "kamino-lend" && position.shares > 0,
    ) ?? false;
  const [loaded, setLoaded] = useState<Overview | null>(null);
  const overview = loaded?.walletAddress === walletAddress ? loaded : null;
  useEffect(() => {
    if (!walletAddress) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/api/earn/overview", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        const value = await response.json();
        if (!controller.signal.aborted)
          setLoaded(
            response.ok &&
              value.walletAddress === walletAddress &&
              value.network === "devnet" &&
              value.feeCollectionEnabled === false
              ? value
              : null,
          );
      } catch {
        if (!controller.signal.aborted) setLoaded(null);
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [walletAddress, devnet.portfolio]);

  return (
    <section aria-label="Your Earn journey" className="space-y-3">
      <Card className="overflow-hidden rounded-3xl border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-card to-sky-500/10 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              Your next step
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              {invested
                ? "Your USDC is at work"
                : funded
                  ? "Make your first deposit"
                  : "Start with your first USDC"}
            </h2>
          </div>
          <TrendingUp className="size-7 shrink-0 text-emerald-600" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {devnet.portfolio
            ? invested
              ? `Position value: ${money(devnet.portfolio.positions.filter((position) => position.productId === "kamino-lend").reduce((sum, position) => sum + position.valueUsd, 0))} USDC · estimated`
              : `Available: ${money(devnet.portfolio.cashUsd)} USDC`
            : "Loading your balance…"}
        </p>
        <ol className="mt-5 grid grid-cols-3 gap-2">
          {[
            { title: "Account", done: !!walletAddress, icon: Wallet },
            { title: "Add funds", done: funded || invested, icon: CreditCard },
            { title: "Start earning", done: invested, icon: TrendingUp },
          ].map(({ title, done, icon: Icon }, index) => (
            <li key={title} className="space-y-2">
              <span
                className={`flex size-9 items-center justify-center rounded-full ${done ? "bg-emerald-600 text-white" : "border bg-background/70 text-muted-foreground"}`}
              >
                {done ? (
                  <Check className="size-4" />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <p className="text-xs font-medium">
                {index + 1}. {title}
              </p>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            nativeButton={false}
            render={
              <Link
                href={funded || invested ? "/earn/kamino-lend" : "/funding"}
              />
            }
          >
            {funded || invested
              ? invested
                ? "Manage position"
                : "Choose your amount"
              : "Add money"}
            <ArrowRight />
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={funded || invested ? "/funding" : "/earn"} />}
          >
            {funded || invested ? "Add money" : "Explore strategies"}
          </Button>
        </div>
      </Card>
      {invested ? (
        <Card className="gap-4 rounded-2xl p-5">
          <div className="flex justify-between gap-3">
            <h3 className="text-sm font-semibold">Your yield</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Position gain</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {overview?.protocolGainAtomic != null
                  ? `${money(Number(overview.protocolGainAtomic) / 1e6)} USDC`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Estimated daily return
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {overview?.dailyEstimate
                  ? `${money(overview.dailyEstimate.net)} USDC`
                  : "—"}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {overview
              ? `APY ${overview.supplyApy === null ? "—" : `${(overview.supplyApy * 100).toFixed(2)}%`}`
              : "Rate unavailable"}
          </p>
          {overview ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Fees</summary>
              <p className="mt-2">
                Daily estimate includes a {overview.performanceFeeBps / 100}%
                share of positive yield. No fee is currently charged.
              </p>
            </details>
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}
