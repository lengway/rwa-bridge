"use client";

import { isUserFacingMessage } from "@/lib/action-errors";
import { useState } from "react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDataDate } from "@/lib/market-data";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useAuth } from "@/lib/useAuth";
import { useDevnet } from "@/lib/useDevnet";

type Direction = "kzte-to-usd" | "usd-to-kzte";
type ExchangeResult = {
  direction: Direction;
  amountKzt: number;
  amountUsd: number;
  sourceExplorerUrl: string;
  targetExplorerUrl: string;
};

const legacyFiatAdaptersEnabled = process.env.NEXT_PUBLIC_ENABLE_LEGACY_FIAT_ADAPTERS === "true";

export function ExchangeDrawer({
  open,
  onOpenChange,
  initialDirection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDirection: Direction;
}) {
  const { wallet } = useAuth();
  const devnet = useDevnet();
  const { marketData } = useAppStore();
  const [direction, setDirection] = useState<Direction | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pending, setPending] = useState<{ direction: Direction; amount: number; signature: string } | null>(null);
  const [completed, setCompleted] = useState<ExchangeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedDirection = direction ?? initialDirection;
  const selectedAmount = amount ?? (selectedDirection === "kzte-to-usd" ? "100" : "10");
  const sourceAmount = Number(selectedAmount);
  const rate = marketData.rate.usdKzt;
  const sourceBalance = devnet.portfolio?.holdings
    .find((holding) => holding.kind === (selectedDirection === "kzte-to-usd" ? "kzte" : "cash"))?.balance ?? 0;
  const validAmount = Number.isFinite(sourceAmount) && sourceAmount > 0 && sourceAmount <= sourceBalance;
  const amountKzt = selectedDirection === "kzte-to-usd" ? sourceAmount : sourceAmount * rate;
  const amountUsd = selectedDirection === "kzte-to-usd" ? sourceAmount / rate : sourceAmount;
  const outputLabel = selectedDirection === "kzte-to-usd"
    ? "≈ " + formatMoney(amountUsd, "USD")
    : "≈ " + formatQuantity(amountKzt) + " KZTE";

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      if (pending) {
        setDirection(pending.direction);
        setAmount(String(pending.amount));
      } else {
        setDirection(null);
        setAmount(null);
      }
    } else {
      setCompleted(null);
      setError(null);
      if (!pending) {
        setDirection(null);
        setAmount(null);
      }
    }
    onOpenChange(nextOpen);
  };

  const exchange = async () => {
    const pendingMatches = pending?.direction === selectedDirection && Math.abs(pending.amount - sourceAmount) < 0.000001;
    if (processing || (!validAmount && !pendingMatches) || !devnet.walletAddress || !devnet.treasuryOwner) return;
    if (pending && !pendingMatches) {
      setError("Retry the confirmation of the previous exchange first.");
      return;
    }
    const mint = selectedDirection === "kzte-to-usd" ? devnet.kzteMint : devnet.usdMint;
    if ((!wallet && !pendingMatches) || !mint) {
      setError("Couldn't connect the wallet or token for the exchange.");
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      let signature = pendingMatches ? pending.signature : null;
      if (!signature) {
        const transfer = await wallet!.send(devnet.treasuryOwner, mint, String(sourceAmount));
        if (!transfer.hash) throw new Error("The wallet did not return a transfer signature.");
        signature = transfer.hash;
        setPending({ direction: selectedDirection, amount: sourceAmount, signature });
      }
      const response = await fetch("/api/devnet/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature, from: devnet.walletAddress, amount: sourceAmount }),
      });
      const result = await response.json() as {
        kind?: unknown;
        amountKzt?: unknown;
        amountUsd?: unknown;
        sourceExplorerUrl?: unknown;
        targetExplorerUrl?: unknown;
        error?: unknown;
      };
      if (!response.ok || typeof result.amountKzt !== "number" || typeof result.amountUsd !== "number"
        || typeof result.sourceExplorerUrl !== "string" || typeof result.targetExplorerUrl !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Couldn't complete the exchange.");
      }
      const actualDirection: Direction = result.kind === "exchange-kzte-usd" ? "kzte-to-usd" : "usd-to-kzte";
      setCompleted({
        direction: actualDirection,
        amountKzt: result.amountKzt,
        amountUsd: result.amountUsd,
        sourceExplorerUrl: result.sourceExplorerUrl,
        targetExplorerUrl: result.targetExplorerUrl,
      });
      setPending(null);
      void devnet.refreshPortfolio();
      toast.success("Exchange complete");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(isUserFacingMessage(message) ? message : "Couldn't confirm the exchange. Check your connection and try again.");
    } finally {
      setProcessing(false);
    }
  };

  if (!legacyFiatAdaptersEnabled) {
    return (
      <DrawerFrame
        open={open}
        onOpenChange={changeOpen}
        title="Exchange unavailable"
        description="Legacy KZT/KZTE adapters are disabled for Universal Earn on Solana Devnet."
      >
        <p className="rounded-xl bg-muted/50 p-3 text-sm leading-6 text-muted-foreground">
          This route is disabled pending separate checks of the provider, regional availability and server configuration.
          No KZT, bank or off-ramp transfers are made.
        </p>
      </DrawerFrame>
    );
  }

  return (
    <DrawerFrame open={open} onOpenChange={changeOpen} title="Exchange" description="Exchange at the NBK rate.">
      {completed ? (
        <DrawerSuccess
          amount={completed.amountUsd}
          currency="USD"
          amountLabel={completed.direction === "kzte-to-usd" ? undefined : formatQuantity(completed.amountKzt) + " KZTE"}
          sentence={completed.direction === "kzte-to-usd"
            ? "Received " + formatMoney(completed.amountUsd, "USD") + " for " + formatQuantity(completed.amountKzt) + " KZTE."
            : "Received " + formatQuantity(completed.amountKzt) + " KZTE for " + formatMoney(completed.amountUsd, "USD") + "."}
          note={completed.direction === "kzte-to-usd"
            ? "KZTE returned to the Intebix reserve. Exchange processed on Solana devnet. A receipt will be sent to your account email."
            : "Transfer from the Intebix reserve. Exchange processed on Solana devnet. A receipt will be sent to your account email."}
          onDone={() => changeOpen(false)}
          secondaryHref="/activity"
          secondaryLabel="Transaction history"
          explorerUrl={completed.sourceExplorerUrl}
          secondaryExplorerUrl={completed.targetExplorerUrl}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Exchange direction">
            <button type="button" role="tab" aria-selected={selectedDirection === "kzte-to-usd"} disabled={processing || Boolean(pending)} onClick={() => { setDirection("kzte-to-usd"); setAmount("100"); setError(null); }} className={selectedDirection === "kzte-to-usd" ? "rounded-lg border border-foreground bg-muted px-3 py-2 text-sm font-medium" : "rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"}>KZTE → $</button>
            <button type="button" role="tab" aria-selected={selectedDirection === "usd-to-kzte"} disabled={processing || Boolean(pending)} onClick={() => { setDirection("usd-to-kzte"); setAmount("10"); setError(null); }} className={selectedDirection === "usd-to-kzte" ? "rounded-lg border border-foreground bg-muted px-3 py-2 text-sm font-medium" : "rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/40"}>$ → KZTE</button>
          </div>
          <label htmlFor="exchange-amount" className="block text-sm font-medium">Amount</label>
          <div className="flex items-center gap-2">
            <Input id="exchange-amount" type="number" min="0.000001" step="any" max={sourceBalance} inputMode="decimal" value={selectedAmount} onChange={(event) => setAmount(event.target.value)} disabled={processing || Boolean(pending)} className="h-11 text-lg tabular-nums" />
            <span className="text-sm font-medium">{selectedDirection === "kzte-to-usd" ? "KZTE" : "USD"}</span>
          </div>
          <div className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm">
            <p className="text-muted-foreground">NBK rate: 1 USD = {formatQuantity(rate, 2)} ₸</p>
            <p className="text-xs text-muted-foreground">Data as of {formatDataDate(marketData.rate.asOf)}</p>
            <p className="font-medium">You&apos;ll receive {outputLabel}</p>
          </div>
          <p className="text-xs text-muted-foreground">Available: {formatQuantity(sourceBalance)} {selectedDirection === "kzte-to-usd" ? "KZTE" : "USD"}</p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {!validAmount ? <p className="text-xs text-destructive">Enter an amount no greater than your available balance.</p> : null}
          <Button className="w-full" onClick={() => void exchange()} disabled={processing || (!validAmount && !pending) || Boolean(pending && (pending.direction !== selectedDirection || Math.abs(pending.amount - sourceAmount) >= 0.000001))}>
            {processing ? "Exchanging…" : pending ? "Retry confirmation" : "Exchange"}
          </Button>
        </div>
      )}
    </DrawerFrame>
  );
}
