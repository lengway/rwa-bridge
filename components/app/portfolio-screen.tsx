"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Building2, Copy, ExternalLink, Settings, Wallet } from "lucide-react";
import { toast } from "sonner";
import { BuyAssetDrawer } from "@/components/app/buy-asset-drawer";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { ExchangeDrawer } from "@/components/app/exchange-drawer";
import { KaminoLendDrawer } from "@/components/app/kamino-lend-drawer";
import { presentDevnetCopy } from "@/components/app/earn-detail-parts";
import { PortfolioSettings } from "@/components/app/profile-screen";
import { WithdrawDrawer } from "@/components/app/withdraw-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OFFICE_ASSET } from "@/lib/assets";
import { formatQuantity } from "@/lib/format";
import { KAMINO_LEND_DEVNET } from "@/lib/kamino-lend-devnet-config";
import { useAppStore } from "@/lib/store";
import { useDevnet, type DevnetPortfolio } from "@/lib/useDevnet";

type DisplayHolding = DevnetPortfolio["holdings"][number];

const allocationNames = [
  { id: "cash", name: "Available balance", color: "bg-sky-500" },
  { id: "kzte", name: "KZTE · archived", color: "bg-rose-500" },
  { id: "kamino-lend", name: "Kamino Lend", color: "bg-emerald-500" },
  { id: "ondo-usdy", name: "USDY · exit only", color: "bg-emerald-500" },
  { id: "kz-bond-demo", name: "Bond · exit only", color: "bg-amber-500" },
  { id: "demo-office", name: "OFFICE · test asset", color: "bg-violet-500" },
] as const;

// Legacy KZT/card adapter screens are retained for a separately reviewed
// future integration, but must not initiate a test-token transfer by default.
const legacyFiatAdaptersEnabled = process.env.NEXT_PUBLIC_ENABLE_LEGACY_FIAT_ADAPTERS === "true";

export function PortfolioScreen() {
  const { hydrated } = useAppStore();
  const devnet = useDevnet();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<DisplayHolding | null>(null);
  const [kaminoOpen, setKaminoOpen] = useState(false);
  const [kaminoAction, setKaminoAction] = useState<"deposit" | "withdraw">("deposit");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeDirection, setExchangeDirection] = useState<"kzte-to-usd" | "usd-to-kzte">("kzte-to-usd");

  const displayHoldings = devnet.portfolio?.holdings ?? [];
  const totalValue = devnet.portfolio?.totalValueUsd ?? 0;
  const isReady = hydrated && devnet.portfolio !== null;
  const allocationValues = allocationNames.map((category) => ({
    ...category,
    value: displayHoldings
      .filter((holding) => category.id === holding.kind || category.id === holding.productId || category.id === holding.assetId)
      .reduce((sum, holding) => sum + holding.valueUsd, 0),
  }));
  const visibleAllocationValues = allocationValues.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const allocationTotal = visibleAllocationValues.reduce((sum, item) => sum + item.value, 0);

  const openInvest = () => {
    setSelected(null);
    setKaminoAction("deposit");
    setKaminoOpen(true);
  };

  const copyValue = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Balances, positions and activity
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings />
        </Button>
      </div>

      <Card className="gap-4 rounded-2xl p-5">
        <div>
          <p className="text-sm text-muted-foreground">Estimated portfolio value</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{isReady ? `$${formatQuantity(totalValue)}` : devnet.portfolioError ? "Unavailable" : "…"}</p>
          <p className="mt-1 text-xs text-muted-foreground">USD estimate. Position values can change; returns are not guaranteed.</p>
        </div>
        {allocationTotal > 0 ? (
          <div className="space-y-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-label="Portfolio allocation">
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
                    ${formatQuantity(item.value)} · {allocationTotal > 0 ? `${formatQuantity(item.value / allocationTotal * 100, 1)}%` : "0%"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isReady ? "Add USDC or open an Earn position to see your allocation." : devnet.portfolioError ? "Allocation is unavailable. Holdings are not shown as zero." : "Allocation will appear when portfolio data is available."}
          </p>
        )}
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Holdings</h3>
           <span className="text-xs text-muted-foreground">{isReady ? displayHoldings.length : "…"}</span>
        </div>
        {!isReady ? <p className="text-sm text-muted-foreground">{devnet.portfolioError ? "Portfolio data unavailable. Values are not treated as zero." : "Loading balances…"}</p> : null}
        {devnet.portfolio?.legacyUnavailable ? <details className="rounded-xl border p-3 text-xs text-muted-foreground"><summary className="cursor-pointer">Earlier assets · refresh needed</summary><p className="mt-2">Some earlier asset data is unavailable and excluded from the total.</p><Button className="mt-2" variant="outline" size="sm" onClick={() => void devnet.refreshPortfolio()}>Refresh</Button></details> : null}
        {isReady && displayHoldings.length === 0 ? (
          <Card className="items-center gap-3 rounded-2xl p-5 text-center">
            <Wallet className="size-6 text-muted-foreground" />
            <p className="font-medium">No holdings yet</p>
            <p className="text-sm text-muted-foreground">Open Kamino Lend to add a USDC position.</p>
            <Button variant="outline" nativeButton={false} render={<Link href="/earn" />}>Open Kamino Lend</Button>
          </Card>
        ) : null}
        <div className="space-y-2">
          {displayHoldings.map((holding) => (
            <div key={holding.mint} className="space-y-2">
              <button type="button" className="block w-full text-left" onClick={() => setSelected(holding)}>
                <HoldingRow holding={holding} />
              </button>
              {legacyFiatAdaptersEnabled && holding.kind === "cash" ? (
                <Button variant="outline" size="sm" className="ml-4" onClick={() => {
                  setExchangeDirection("usd-to-kzte");
                  setExchangeOpen(true);
                }}>Exchange</Button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <WalletCard portfolio={devnet.portfolio} onCopy={copyValue} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">On-chain activity</h3>
          <Button variant="link" size="sm" className="h-auto p-0" nativeButton={false} render={<Link href="/activity" />}>View all</Button>
        </div>
        <OnchainHistory rows={devnet.portfolio?.history ?? []} />
      </section>

      <DrawerFrame open={settingsOpen} onOpenChange={setSettingsOpen} title="Settings">
        <PortfolioSettings />
      </DrawerFrame>

      {selected ? (
        <HoldingDetails
          holding={selected}
          kzteReserve={devnet.kzteReserve}
          kzteSupply={devnet.kzteSupply}
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          onInvest={openInvest}
          onWithdraw={() => { setSelected(null); setWithdrawOpen(true); }}
          onBuy={() => { setSelected(null); setBuyOpen(true); }}
          legacyFiatAdaptersEnabled={legacyFiatAdaptersEnabled}
          onExchange={(direction) => {
            setSelected(null);
            setExchangeDirection(direction);
            setExchangeOpen(true);
          }}
          onCopy={copyValue}
        />
      ) : null}
      <KaminoLendDrawer
        key={kaminoAction}
        open={kaminoOpen}
        onOpenChange={setKaminoOpen}
        initialAction={kaminoAction}
      />
      <WithdrawDrawer open={withdrawOpen} onOpenChange={setWithdrawOpen} />
      <BuyAssetDrawer open={buyOpen} onOpenChange={setBuyOpen} asset={OFFICE_ASSET} />
      {legacyFiatAdaptersEnabled ? (
        <ExchangeDrawer open={exchangeOpen} onOpenChange={setExchangeOpen} initialDirection={exchangeDirection} />
      ) : null}
    </div>
  );
}

function HoldingRow({ holding }: { holding: DisplayHolding }) {
  const primary = holding.productId === "kamino-lend" || holding.mint === KAMINO_LEND_DEVNET.liquidityMint;
  const name = holding.kind === "asset" ? "OFFICE · test asset" : presentPortfolioCopy(holding.name);
  return (
    <Card className="gap-3 rounded-2xl p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {holding.kind === "asset" ? <Building2 className="size-4" /> : holding.kind === "cash" ? "$" : <ArrowDownToLine className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {formatQuantity(holding.balance)} {presentPortfolioCopy(holding.ticker)}
          </span>
        </span>
        <span className="text-right">
          <span className="block font-semibold tabular-nums">{primary ? `${formatQuantity(holding.valueUsd)} USDC` : `${formatQuantity(holding.valueUsd)} test units`}</span>
          {holding.kind === "vault" ? (
            <span className="mt-1 block text-xs text-muted-foreground">Check the position’s exit terms</span>
          ) : <span className="mt-1 block text-xs text-muted-foreground">{primary ? "Available" : "Test asset"}</span>}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground"><span>{holding.kind === "vault" ? "Estimated position value · withdrawals depend on liquidity" : primary ? "USDC wallet balance" : "Token balance"}</span></div>
    </Card>
  );
}

function WalletCard({ portfolio, onCopy }: { portfolio: DevnetPortfolio | null; onCopy: (value: string, label: string) => void }) {
  if (!portfolio) return <Card className="gap-2 rounded-2xl p-4"><h3 className="font-semibold">Solana wallet</h3><p className="text-sm text-muted-foreground">Loading wallet address…</p></Card>;
  const address = portfolio.wallet.address;
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Wallet className="size-4 text-muted-foreground" />
        <h3 className="font-semibold">Solana wallet</h3>
        <Badge variant="secondary" className="ml-auto">Solana</Badge>
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-muted/60 p-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortAddress(address)}</span>
        <Button variant="ghost" size="icon" aria-label="Copy address" onClick={() => onCopy(address, "Address")}><Copy /></Button>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">SOL for network fees</span>
        <span className="font-medium tabular-nums">{formatQuantity(portfolio.wallet.solBalance, 5)} SOL</span>
      </div>
      <Button variant="outline" className="w-full" nativeButton={false} render={<a href={portfolio.wallet.explorerUrl} target="_blank" rel="noopener noreferrer" />}>
        <ExternalLink />Open in explorer
      </Button>
    </Card>
  );
}

function HoldingDetails({
  holding,
  kzteReserve,
  kzteSupply,
  onOpenChange,
  onInvest,
  onWithdraw,
  onBuy,
  legacyFiatAdaptersEnabled,
  onExchange,
  onCopy,
}: {
  holding: DisplayHolding;
  kzteReserve: number | null;
  kzteSupply: number | null;
  onOpenChange: (open: boolean) => void;
  onInvest: () => void;
  onWithdraw: () => void;
  onBuy: () => void;
  legacyFiatAdaptersEnabled: boolean;
  onExchange: (direction: "kzte-to-usd" | "usd-to-kzte") => void;
  onCopy: (value: string, label: string) => void;
}) {
  const name = holding.kind === "asset" ? "OFFICE · test asset" : presentPortfolioCopy(holding.name);
  const primary = holding.productId === "kamino-lend" || holding.mint === KAMINO_LEND_DEVNET.liquidityMint;
  const canInvest = holding.kind === "cash";
  const canWithdraw = holding.kind === "vault";
  const canBuy = holding.kind === "asset" || holding.kind === "cash";
  const canExchange = legacyFiatAdaptersEnabled && (holding.kind === "cash" || holding.kind === "kzte");
  const exchangeDirection = holding.kind === "kzte" ? "kzte-to-usd" : "usd-to-kzte";
  return (
    <DrawerFrame open onOpenChange={onOpenChange} title={name} description={`${formatQuantity(holding.balance)} ${presentPortfolioCopy(holding.ticker)} · Estimated value: ${formatQuantity(holding.valueUsd)} ${primary ? "USDC" : "test units"}`}>
      <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">{holding.kind === "vault" ? "Position status" : "Token status"}</span><span className="font-medium">{holding.kind === "vault" ? "Check exit terms" : primary ? "Available" : "Test asset"}</span>
          </div>
        {holding.kind === "kzte" ? (
          <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
            <p>App token reserve: {kzteReserve === null ? "—" : formatQuantity(kzteReserve)} KZTE · total supply {formatQuantity(kzteSupply ?? 1_000_000_000, 0)}</p>
            <p>This app token does not represent KZT or a bank product.</p>
          </div>
        ) : null}
        <div className="space-y-3 rounded-xl border p-3">
          <AddressLine label="Mint" address={holding.mint} explorerUrl={holding.mintExplorerUrl} onCopy={() => onCopy(holding.mint, "Mint")} />
          <AddressLine label="Token account" address={holding.tokenAccount} explorerUrl={holding.tokenAccountExplorerUrl} onCopy={() => onCopy(holding.tokenAccount, "Token account")} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {canInvest ? <Button variant="outline" onClick={onInvest}><ArrowDownToLine />Add more</Button> : null}
          {canWithdraw ? <Button variant="outline" onClick={onWithdraw}><ArrowUpFromLine />Withdraw</Button> : null}
          {canExchange ? <Button variant="outline" onClick={() => onExchange(exchangeDirection)}>Exchange</Button> : null}
          {canBuy ? <Button variant="outline" className="col-span-2" onClick={onBuy}>Buy more</Button> : null}
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
          <Button variant="ghost" size="icon" aria-label={`Copy ${label}`} onClick={onCopy}><Copy /></Button>
          <Button variant="ghost" size="icon" aria-label={`Open ${label} in explorer`} nativeButton={false} render={<a href={explorerUrl} target="_blank" rel="noopener noreferrer" />}><ExternalLink /></Button>
        </div>
      </div>
      <p className="font-mono text-[11px] leading-4" title={address}>{shortAddress(address)}</p>
    </div>
  );
}

function OnchainHistory({ rows }: { rows: DevnetPortfolio["history"] }) {
  if (!rows.length) return <Card className="rounded-2xl p-4 text-sm text-muted-foreground">No Solana activity yet.</Card>;
  return (
    <div className="space-y-2">
      {rows.slice(0, 5).map((row) => (
        <Card key={row.id} className="flex-row items-start gap-3 rounded-2xl p-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"><ArrowDownToLine className="size-4 text-muted-foreground" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5">{presentPortfolioCopy(row.title)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(row.at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            <a href={row.explorerUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs underline underline-offset-4">Solana Explorer <ExternalLink className="size-3" /></a>
          </div>
        </Card>
      ))}
    </div>
  );
}

function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-5)}` : address;
}

function presentPortfolioCopy(value: string) {
  return presentDevnetCopy(value)
    .replace(/\btest quote\b/gi, "test units")
    .replace(/\btest token\b/gi, "test asset")
    .replace(/\bsimulated (funding|payout)\b/gi, "Past activity")
    .replace(/\billustrative yield\b/gi, "example rate")
    .replace(/тестов\p{L}*/giu, "test");
}
