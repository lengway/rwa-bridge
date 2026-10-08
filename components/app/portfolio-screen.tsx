"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCrossmintAuth } from "@crossmint/client-sdk-react-ui";
import { ArrowDownToLine, ArrowUpFromLine, Building2, Copy, ExternalLink, Settings, Wallet } from "lucide-react";
import { toast } from "sonner";
import { BuyAssetDrawer } from "@/components/app/buy-asset-drawer";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { InvestDrawer } from "@/components/app/invest-drawer";
import { PortfolioSettings } from "@/components/app/profile-screen";
import { WithdrawDrawer } from "@/components/app/withdraw-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DEMO_OFFICE_ASSET } from "@/lib/assets";
import { formatEarningsMoney, formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet, type DevnetPortfolio } from "@/lib/useDevnet";
import { accruedPosition, YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { getStrategyApy } from "@/lib/market-data";
import { useNow } from "@/lib/useNow";
import { isCrossmintConfigured } from "@/lib/config";

type Holding = DevnetPortfolio["holdings"][number];

type DisplayHolding = Holding & { demo?: boolean };

const allocationNames = [
  { id: "cash", name: "Свободные доллары", color: "bg-sky-500" },
  { id: "ondo-usdy", name: "Долларовый вклад", color: "bg-emerald-500" },
  { id: "kz-bond-demo", name: "Тенговые облигации", color: "bg-amber-500" },
  { id: "demo-office", name: "Офисное здание", color: "bg-violet-500" },
] as const;

export function PortfolioScreen() {
  const { cashUsd, positions, holdings: localHoldings, displayCurrency, marketData, acceleratedAccrual, hydrated } = useAppStore();
  const devnet = useDevnet();
  const now = useNow();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<DisplayHolding | null>(null);
  const [investStrategy, setInvestStrategy] = useState<YieldStrategy>(YIELD_STRATEGIES[0]);
  const [investOpen, setInvestOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);

  const demoHoldings = useMemo<DisplayHolding[]>(() => {
    const result: DisplayHolding[] = [];
    if (cashUsd > 0) {
      result.push({
        kind: "cash", name: "Свободные доллары", ticker: "USD", mint: "", tokenAccount: "", balance: cashUsd,
        priceUsd: 1, valueUsd: cashUsd, mintExplorerUrl: "", tokenAccountExplorerUrl: "", demo: true,
      });
    }
    for (const strategy of YIELD_STRATEGIES) {
      const position = positions[strategy.id];
      if (!position) continue;
      const earned = devnet.mode === "devnet"
        ? position.earnedCarryUsd ?? 0
        : now === null ? (position.earnedCarryUsd ?? 0) : accruedPosition(
          position,
          getStrategyApy(strategy.id, marketData.yields),
          now,
          acceleratedAccrual,
        );
      const balance = position.principal + earned;
      result.push({
        kind: "vault", productId: strategy.id, name: strategy.name, ticker: strategy.ticker, mint: "", tokenAccount: "",
        balance, priceUsd: 1, valueUsd: balance, costUsd: position.principal, pnlUsd: earned,
        mintExplorerUrl: "", tokenAccountExplorerUrl: "", demo: true,
      });
    }
    const office = localHoldings[DEMO_OFFICE_ASSET.id];
    if (office && office.units > 0) {
      result.push({
        kind: "asset", assetId: DEMO_OFFICE_ASSET.id, name: DEMO_OFFICE_ASSET.name, ticker: "OFFICE-DEMO",
        mint: "", tokenAccount: "", balance: office.units, priceUsd: office.units > 0 ? office.costUsd / office.units : 1,
        valueUsd: office.costUsd, costUsd: office.costUsd, pnlUsd: 0, mintExplorerUrl: "", tokenAccountExplorerUrl: "", demo: true,
      });
    }
    return result;
  }, [acceleratedAccrual, cashUsd, devnet.mode, localHoldings, marketData.yields, now, positions]);

  const devnetHoldings = (devnet.portfolio?.holdings ?? []) as DisplayHolding[];
  const displayHoldings = devnet.mode === "devnet" ? devnetHoldings : demoHoldings;
  const totalValue = devnet.mode === "devnet"
    ? devnet.portfolio?.totalValueUsd ?? 0
    : demoHoldings.reduce((total, item) => total + item.valueUsd, 0);
  const todayChange = devnet.mode === "devnet"
    ? devnet.portfolio?.changeTodayUsd ?? 0
    : demoHoldings.filter((item) => item.kind === "vault").reduce((total, item) => {
      const apy = item.productId ? getStrategyApy(item.productId, marketData.yields) : 0;
      return total + item.valueUsd * apy / 365;
    }, 0);
  const isReady = devnet.mode !== "devnet" || devnet.portfolio !== null;
  const allocationValues = allocationNames.map((category) => ({
    ...category,
    value: displayHoldings
      .filter((holding) => category.id === holding.kind || category.id === holding.productId || category.id === holding.assetId)
      .reduce((sum, holding) => sum + holding.valueUsd, 0),
  }));
  const visibleAllocationValues = allocationValues.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const allocationTotal = visibleAllocationValues.reduce((sum, item) => sum + item.value, 0);

  const openInvest = (holding?: DisplayHolding) => {
    const strategy = YIELD_STRATEGIES.find((item) => item.id === holding?.productId) ?? YIELD_STRATEGIES[0];
    setInvestStrategy(strategy);
    setSelected(null);
    setInvestOpen(true);
  };

  const copyValue = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} скопирован`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Портфель</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {devnet.mode === "devnet" ? "Активы и доли из Solana devnet" : "Ваши средства и активы"}
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Настройки" onClick={() => setSettingsOpen(true)}>
          <Settings />
        </Button>
      </div>

      {devnet.mode === "demo" ? <DemoBanner /> : null}

      <Card className="gap-4 rounded-2xl p-5">
        <div>
          <p className="text-sm text-muted-foreground">Общая стоимость</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(totalValue, displayCurrency)}</p>
          {todayChange !== 0 ? (
            <p className={`mt-1 text-sm tabular-nums ${todayChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
              {todayChange >= 0 ? "+" : "−"}{formatEarningsMoney(Math.abs(todayChange), displayCurrency)} за сегодня
            </p>
          ) : null}
        </div>
        {allocationTotal > 0 ? (
          <div className="space-y-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-label="Распределение портфеля">
              {visibleAllocationValues.map((item) => (
                <span key={item.id} className={item.color} style={{ width: `${item.value / allocationTotal * 100}%` }} />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-y-2 sm:grid-cols-2 sm:gap-x-3">
              {visibleAllocationValues.map((item) => (
                <div key={item.id} className="flex min-w-0 items-start gap-2 text-xs">
                  <span className={`size-2 shrink-0 rounded-full ${item.color}`} />
                  <span className="min-w-0 flex-1 text-muted-foreground">{item.name}</span>
                  <span className="shrink-0 text-right font-medium tabular-nums">
                    {formatMoney(item.value, displayCurrency)} · {allocationTotal > 0 ? `${formatQuantity(item.value / allocationTotal * 100, 1)}%` : "0%"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Распределение появится после пополнения портфеля.</p>
        )}
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Активы</h3>
          <span className="text-xs text-muted-foreground">{displayHoldings.length}</span>
        </div>
        {!isReady ? <p className="text-sm text-muted-foreground">Загружаем данные из Solana…</p> : null}
        {isReady && displayHoldings.length === 0 ? (
          <Card className="items-center gap-3 rounded-2xl p-5 text-center">
            <Wallet className="size-6 text-muted-foreground" />
            <p className="font-medium">Пока нет активов</p>
            <p className="text-sm text-muted-foreground">Пополните баланс, откройте вклад или купите долю.</p>
            <Button variant="outline" nativeButton={false} render={<Link href="/earn" />}>Посмотреть вклады</Button>
          </Card>
        ) : null}
        <div className="space-y-2">
          {displayHoldings.map((holding) => (
            <button key={`${holding.kind}:${holding.mint || holding.productId || holding.assetId}`} type="button" className="block w-full text-left" onClick={() => setSelected(holding)}>
              <HoldingRow holding={holding} currency={displayCurrency} onchain={devnet.mode === "devnet"} />
            </button>
          ))}
        </div>
      </section>

      {devnet.mode === "devnet" ? <WalletCard portfolio={devnet.portfolio} onCopy={copyValue} /> : <DemoWalletCard />}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Операции в сети</h3>
          <Button variant="link" size="sm" className="h-auto p-0" nativeButton={false} render={<Link href="/activity" />}>Все операции</Button>
        </div>
        {devnet.mode === "devnet" ? (
          <OnchainHistory rows={devnet.portfolio?.history ?? []} />
        ) : (
          <DemoHistory />
        )}
      </section>

      <DrawerFrame open={settingsOpen} onOpenChange={setSettingsOpen} title="Настройки">
        <PortfolioSettings />
      </DrawerFrame>

      {selected ? (
        <HoldingDetails
          holding={selected}
          currency={displayCurrency}
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          onInvest={() => openInvest(selected)}
          onWithdraw={() => { setSelected(null); setWithdrawOpen(true); }}
          onBuy={() => { setSelected(null); setBuyOpen(true); }}
          onCopy={copyValue}
          onchain={devnet.mode === "devnet"}
        />
      ) : null}
      <InvestDrawer open={investOpen} onOpenChange={setInvestOpen} strategy={investStrategy} />
      <WithdrawDrawer open={withdrawOpen} onOpenChange={setWithdrawOpen} />
      <BuyAssetDrawer open={buyOpen} onOpenChange={setBuyOpen} asset={DEMO_OFFICE_ASSET} />
      {!hydrated && devnet.mode === "demo" ? <p className="text-center text-xs text-muted-foreground">Загружаем демо-данные…</p> : null}
    </div>
  );
}

function HoldingRow({ holding, currency, onchain }: { holding: DisplayHolding; currency: "USD" | "KZT"; onchain: boolean }) {
  return (
    <Card className="gap-3 rounded-2xl p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {holding.kind === "asset" ? <Building2 className="size-4" /> : holding.kind === "cash" ? "$" : <ArrowDownToLine className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{holding.name}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {formatQuantity(holding.balance)} {holding.ticker}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-semibold tabular-nums">{formatMoney(holding.valueUsd, currency)}</span>
          {holding.pnlUsd !== undefined ? (
            <span className={`mt-1 block text-xs tabular-nums ${holding.pnlUsd >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
              {holding.pnlUsd >= 0 ? "+" : "−"}{formatEarningsMoney(Math.abs(holding.pnlUsd), currency)}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
        <span>1 токен · {formatMoney(holding.priceUsd, currency)}</span>
        <Badge variant={onchain ? "secondary" : "outline"}>{onchain ? "В сети Solana" : "Демо"}</Badge>
      </div>
    </Card>
  );
}

function WalletCard({ portfolio, onCopy }: { portfolio: DevnetPortfolio | null; onCopy: (value: string, label: string) => void }) {
  if (!portfolio) return <Card className="gap-2 rounded-2xl p-4"><h3 className="font-semibold">Кошелёк Solana</h3><p className="text-sm text-muted-foreground">Загружаем адрес кошелька…</p></Card>;
  const address = portfolio.wallet.address;
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Wallet className="size-4 text-muted-foreground" />
        <h3 className="font-semibold">Кошелёк Solana</h3>
        <Badge variant="secondary" className="ml-auto">{portfolio.wallet.network}</Badge>
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 p-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortAddress(address)}</span>
        <Button variant="ghost" size="icon" aria-label="Скопировать адрес" onClick={() => onCopy(address, "Адрес")}><Copy /></Button>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">SOL для комиссий</span>
        <span className="font-medium tabular-nums">{formatQuantity(portfolio.wallet.solBalance, 5)} SOL</span>
      </div>
      <Button variant="outline" className="w-full" nativeButton={false} render={<a href={portfolio.wallet.explorerUrl} target="_blank" rel="noopener noreferrer" />}>
        <ExternalLink />Открыть в обозревателе
      </Button>
    </Card>
  );
}

function HoldingDetails({
  holding,
  currency,
  onOpenChange,
  onInvest,
  onWithdraw,
  onBuy,
  onCopy,
  onchain,
}: {
  holding: DisplayHolding;
  currency: "USD" | "KZT";
  onOpenChange: (open: boolean) => void;
  onInvest: () => void;
  onWithdraw: () => void;
  onBuy: () => void;
  onCopy: (value: string, label: string) => void;
  onchain: boolean;
}) {
  const canInvest = holding.kind === "vault" || holding.kind === "cash";
  const canWithdraw = holding.kind === "vault";
  const canBuy = holding.kind === "asset" || holding.kind === "cash";
  return (
    <DrawerFrame open onOpenChange={onOpenChange} title={holding.name} description={`${formatQuantity(holding.balance)} ${holding.ticker} · ${formatMoney(holding.valueUsd, currency)}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl bg-muted/50 p-3 text-sm">
          <span className="text-muted-foreground">Цена токена</span><span className="font-medium">{formatMoney(holding.priceUsd, currency)}</span>
        </div>
        {holding.costUsd !== undefined ? (
          <div className="flex items-center justify-between rounded-xl bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">Прибыль / убыток</span><span className="font-medium">{formatMoney(holding.pnlUsd ?? 0, currency)}</span>
          </div>
        ) : null}
        {onchain ? (
          <div className="space-y-3 rounded-xl border p-3">
            <AddressLine label="Mint" address={holding.mint} explorerUrl={holding.mintExplorerUrl} onCopy={() => onCopy(holding.mint, "Mint")} />
            <AddressLine label="Token account" address={holding.tokenAccount} explorerUrl={holding.tokenAccountExplorerUrl} onCopy={() => onCopy(holding.tokenAccount, "Token account")} />
          </div>
        ) : <p className="text-xs text-muted-foreground">Демо-данные хранятся в этом браузере.</p>}
        <div className="grid grid-cols-2 gap-2">
          {canInvest ? <Button variant="outline" onClick={onInvest}><ArrowDownToLine />Вложить ещё</Button> : null}
          {canWithdraw ? <Button variant="outline" onClick={onWithdraw}><ArrowUpFromLine />Вывести</Button> : null}
          {canBuy ? <Button variant="outline" className="col-span-2" onClick={onBuy}>Купить ещё</Button> : null}
        </div>
      </div>
    </DrawerFrame>
  );
}

function AddressLine({ label, address, explorerUrl, onCopy }: { label: string; address: string; explorerUrl: string; onCopy: () => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`Скопировать ${label}`} onClick={onCopy}><Copy /></Button>
          <Button variant="ghost" size="icon" aria-label={`Открыть ${label} в обозревателе`} nativeButton={false} render={<a href={explorerUrl} target="_blank" rel="noopener noreferrer" />}><ExternalLink /></Button>
        </div>
      </div>
      <p className="font-mono text-[11px] leading-4" title={address}>{shortAddress(address)}</p>
    </div>
  );
}

function OnchainHistory({ rows }: { rows: DevnetPortfolio["history"] }) {
  if (!rows.length) return <Card className="rounded-2xl p-4 text-sm text-muted-foreground">Операций в Solana пока нет.</Card>;
  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((row) => (
        <Card key={row.id} className="flex-row items-start gap-3 rounded-2xl p-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><ArrowDownToLine className="size-4 text-muted-foreground" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5">{row.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(row.at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            <a href={row.explorerUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-4">Solana Explorer <ExternalLink className="size-3" /></a>
          </div>
        </Card>
      ))}
    </div>
  );
}

function DemoHistory() {
  const { activity } = useAppStore();
  if (!activity.length) return <Card className="rounded-2xl p-4 text-sm text-muted-foreground">Пока нет операций. Они появятся здесь после пополнения или покупки.</Card>;
  return (
    <div className="space-y-2">
      {activity.slice(0, 5).map((item) => (
        <Card key={item.id} className="flex-row items-center gap-3 rounded-2xl p-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-muted"><ArrowDownToLine className="size-4 text-muted-foreground" /></span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{new Date(item.at).toLocaleDateString("ru-RU")}</p></div>
          <span className="text-xs text-muted-foreground">Демо</span>
        </Card>
      ))}
    </div>
  );
}

function DemoBanner() {
  return (
    <Card className="gap-3 rounded-2xl border-amber-500/30 bg-amber-500/5 p-4">
      <div>
        <p className="font-medium">Демо-режим</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">Демо: данные хранятся в этом браузере. Войдите, чтобы активы хранились в сети Solana.</p>
      </div>
      {isCrossmintConfigured ? <LoginButton /> : <Button className="w-full" disabled>Вход будет доступен после настройки</Button>}
    </Card>
  );
}

function LoginButton() {
  const { login, status } = useCrossmintAuth();
  return <Button className="w-full" onClick={login} disabled={status === "initializing" || status === "in-progress"}>{status === "in-progress" ? "Загружаем…" : "Войти по email"}</Button>;
}

function DemoWalletCard() {
  return <Card className="gap-2 rounded-2xl p-4"><div className="flex items-center gap-2"><Wallet className="size-4 text-muted-foreground" /><h3 className="font-semibold">Кошелёк Solana</h3><Badge variant="outline" className="ml-auto">Демо</Badge></div><p className="text-sm text-muted-foreground">Войдите, чтобы получить адрес кошелька и хранить активы в сети.</p></Card>;
}

function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-5)}` : address;
}
