"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { Button } from "@/components/ui/button";
import { formatBps, formatDate } from "@/lib/markets/format";
import type { BondOffering } from "@/lib/markets/investor";
import {
  clearStoredSmartWalletOperation,
  continueSmartWalletChain,
  getSmartWalletOperationStatus,
  initializeSmartWallet,
  prepareSmartWalletOperation,
  readStoredSmartWalletOperation,
  storeSmartWalletOperation,
  type SmartWalletOperationStatus,
  type StoredSmartWalletOperation,
} from "@/lib/kamino-smart-wallet-client";
import { useAuth } from "@/lib/useAuth";
import { cn } from "@/lib/utils";
import { devnetTxUrl, refreshBonds } from "@/lib/useBonds";
import { Row, TestFundsNote, money } from "./bond-parts";

const unitsLabel = (n: string | number) => `${n} unit${String(n) === "1" ? "" : "s"}`;
const PERIOD: Record<number, string> = { 1: "year", 2: "six months", 4: "quarter", 12: "month" };

/** A saved purchase for this bond, if one is still being confirmed. */
function savedPurchase(walletAddress: string | null, mint: string) {
  if (!walletAddress) return null;
  try {
    const op = readStoredSmartWalletOperation(walletAddress, "markets");
    const intent = op?.continuation ?? op;
    return intent?.mint === mint ? op : null;
  } catch {
    return null;
  }
}

/** Why "Buy" is unavailable for this wallet, or null when it is available. Rendered by the caller. */
export function purchaseBlock(offering: BondOffering, heldUnits: bigint): string | null {
  const purchase = offering.purchase;
  if (!purchase) return `Not offered in Plain. ${heldUnits > BigInt(0) ? "Coupons on your units are still paid to your wallet." : "Earlier issue, shown for its payment record."}`;
  if (!purchase.open) return purchase.reason ?? "The offering is closed.";
  if (BigInt(purchase.maxForWallet) < BigInt(1)) return "You can't buy more of this bond.";
  return null;
}

/**
 * "Buy" for a bond with a USDC offering (hidden when the bond has none). Opens the purchase drawer;
 * resumes a purchase that is still being confirmed after a reload.
 */
export function BuyButton({ offering, heldUnits, balanceAtomic, className, label }: { offering: BondOffering; heldUnits: bigint; balanceAtomic: string | null; className?: string; label?: string }) {
  const { walletAddress } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // After hydration: localStorage is browser-only.
    const timer = window.setTimeout(() => { if (savedPurchase(walletAddress, offering.mint)) setOpen(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [walletAddress, offering.mint]);

  const purchase = offering.purchase;
  if (!purchase) return null;
  const price = money(purchase.priceAtomic, offering.settlementDecimals, offering.settlementSymbol);
  return (
    <>
      <Button className={cn("h-11 px-5", className)} disabled={purchaseBlock(offering, heldUnits) != null} onClick={() => setOpen(true)}>
        <ShoppingBag />
        {label ?? `${heldUnits > BigInt(0) ? "Buy more" : "Buy"} · ${price} per unit`}
      </Button>
      {open ? <PurchaseDrawer offering={offering} balanceAtomic={balanceAtomic} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PurchaseDrawer({ offering, balanceAtomic, onClose }: { offering: BondOffering; balanceAtomic: string | null; onClose: () => void }) {
  const purchase = offering.purchase!;
  const { wallet, walletAddress, email } = useAuth();
  const d = offering.settlementDecimals;
  const s = offering.settlementSymbol;
  const price = BigInt(purchase.priceAtomic);
  const balance = balanceAtomic == null ? null : BigInt(balanceAtomic);
  const affordable = balance == null ? BigInt(purchase.maxForWallet) : balance / price;
  const max = Number([BigInt(purchase.maxForWallet), affordable, BigInt(1_000)].reduce((a, b) => (a < b ? a : b)));

  const [units, setUnits] = useState(1);
  const [running, setRunning] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: SmartWalletOperationStatus; units: string } | null>(null);
  const operation = useRef<StoredSmartWalletOperation | null>(null);
  const inFlight = useRef<AbortSignal | null>(null);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ wallet, walletAddress, email, units });
  useEffect(() => { latest.current = { wallet, walletAddress, email, units }; });

  const run = useCallback(async (userTap: boolean, signal: AbortSignal) => {
    const ctx = latest.current;
    if ((inFlight.current && !inFlight.current.aborted) || !ctx.wallet || !ctx.walletAddress || ctx.wallet.address !== ctx.walletAddress || signal.aborted) return;
    inFlight.current = signal;
    setRunning(true);
    setError(null);
    const intent = operation.current?.continuation ?? operation.current;
    const boughtUnits = intent && intent.action !== "initialize" ? intent.amountAtomic : String(ctx.units);
    const wait = (waitSignal: AbortSignal) => new Promise<void>((resolve) => {
      const finish = () => { window.clearTimeout(timer); waitSignal.removeEventListener("abort", finish); resolve(); };
      const timer = window.setTimeout(finish, 5_000);
      waitSignal.addEventListener("abort", finish, { once: true });
      if (waitSignal.aborted) finish();
    });
    try {
      const result = await continueSmartWalletChain({
        operation: operation.current, action: "markets-subscribe", amountAtomic: String(ctx.units), mint: offering.mint,
        walletAddress: ctx.walletAddress, userTap, signal,
        approve: async (transactionId) => {
          let timer: number | undefined;
          try {
            // Approval comes from the wallet's email signer, as for Kamino.
            if (ctx.email) await ctx.wallet!.useSigner({ type: "email", email: ctx.email });
            return await Promise.race([
              ctx.wallet!.approve({ transactionId }),
              new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error("The wallet response was interrupted.")), 180_000); }),
            ]);
          } finally { window.clearTimeout(timer); }
        },
        onOperation: (next) => { operation.current = next; },
        onProgress: () => {},
        dependencies: {
          prepare: prepareSmartWalletOperation, initialize: initializeSmartWallet, status: getSmartWalletOperationStatus,
          store: (op) => storeSmartWalletOperation(op, "markets"),
          clear: (address, id) => clearStoredSmartWalletOperation(address, id, "markets"),
          newId: () => crypto.randomUUID(), wait,
        },
      });
      if (!signal.aborted && result) {
        setDone({ status: result, units: boughtUnits });
        toast.success(`${unitsLabel(boughtUnits)} of ${offering.symbol} in your wallet`);
        void refreshBonds();
      }
    } catch (cause) {
      console.error("[bonds] purchase failed:", cause);
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (inFlight.current === signal) inFlight.current = null;
      if (!signal.aborted) { setRunning(false); setRecovering(false); }
    }
  }, [offering.mint, offering.symbol]);

  // Resume a saved purchase for this bond without a new tap (it never approves without one).
  const matches = Boolean(wallet && walletAddress && wallet.address === walletAddress);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const timer = window.setTimeout(() => {
      if (abort.signal.aborted) return;
      const saved = matches ? savedPurchase(walletAddress, offering.mint) : null;
      operation.current = saved;
      if (saved) void run(false, abort.signal);
      else setRecovering(false);
    }, 0);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [matches, walletAddress, offering.mint, run]);

  const start = () => {
    if (!controller.current || controller.current.signal.aborted) controller.current = new AbortController();
    void run(true, controller.current.signal);
  };
  const change = (next: number) => { setUnits(Math.min(Math.max(1, max), Math.max(1, next))); setError(null); };
  const n = BigInt(units);
  const busy = running || recovering;

  return (
    <DrawerFrame open onOpenChange={(o) => !o && !running && onClose()} title={`Buy ${offering.symbol}`} description={offering.name}>
      {done ? (
        <div className="space-y-4 py-2 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Check className="size-6" /></span>
          <div>
            <p className="text-lg font-semibold">Done — {unitsLabel(done.units)} bought</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You paid {money(BigInt(done.units) * price, d, s)} and received the units in the same Solana transaction. Coupons are paid to this wallet automatically.
            </p>
          </div>
          {done.status.signature ? (
            <a href={devnetTxUrl(done.status.signature)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm underline underline-offset-4">
              View transaction <ExternalLink className="size-3.5" />
            </a>
          ) : null}
          <Button className="w-full" size="lg" variant="outline" onClick={onClose}>Done</Button>
        </div>
      ) : busy ? (
        <div role="status" aria-live="polite" aria-label="Processing purchase" className="flex flex-col items-center gap-3 py-10">
          <LoaderCircle className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{recovering && !running ? "Checking your last purchase…" : "Confirming on Solana…"}</p>
        </div>
      ) : !matches ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Connect this account&apos;s wallet to buy.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border p-4">
            <div>
              <p className="text-sm font-medium">Units</p>
              <p className="text-xs text-muted-foreground">{max >= 1 ? `Up to ${max} · ${money(price, d, s)} each` : "Your balance doesn't cover one unit."}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Fewer units" disabled={units <= 1} onClick={() => change(units - 1)}><Minus /></Button>
              <input
                aria-label="Units to buy" inputMode="numeric" value={units}
                onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, "")); if (Number.isSafeInteger(v)) change(v); }}
                className="w-14 rounded-md border bg-transparent py-1 text-center text-xl font-semibold tabular-nums"
              />
              <Button variant="outline" size="icon" aria-label="More units" disabled={units >= max} onClick={() => change(units + 1)}><Plus /></Button>
            </div>
          </div>
          <dl className="space-y-2 text-sm">
            <Row label="You pay" value={money(n * price, d, s)} />
            <Row label={`Your ${s} balance`} value={balance == null ? "—" : money(balance, d, s)} />
            <Row label={`Coupon every ${PERIOD[offering.frequency] ?? "period"}`} value={money(n * BigInt(offering.couponPerUnit), d, s)} />
            <Row label="Yield to maturity" value={offering.ytmBps != null ? formatBps(offering.ytmBps) : "—"} />
            <Row label="Matures" value={formatDate(offering.maturityTs)} />
          </dl>
          <TestFundsNote>Paid in devnet USDC and delivered in the same transaction: either you get the units and the issuer gets the USDC, or nothing moves. Plain pays the network fee.</TestFundsNote>
          {error ? (
            <div className="space-y-1">
              <p role="alert" className="text-sm text-destructive">Couldn&apos;t complete the purchase. Your USDC stayed in your balance.</p>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Details</summary><p className="mt-2 break-words">{error}</p></details>
            </div>
          ) : null}
          <Button className="w-full" size="lg" disabled={max < 1} onClick={start}>
            {error ? "Retry" : `Buy ${unitsLabel(units)} for ${money(n * price, d, s)}`}
          </Button>
        </div>
      )}
    </DrawerFrame>
  );
}
