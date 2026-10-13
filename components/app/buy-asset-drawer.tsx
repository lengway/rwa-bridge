"use client";

import { useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useDevnet } from "@/lib/useDevnet";
import type { BridgeAsset } from "@/lib/assets";
import { useAuth } from "@/lib/useAuth";

type BuyAssetDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: BridgeAsset;
};

type BuyResult = {
  amount: number;
  units: number;
  note?: string;
  explorerUrl?: string;
};

export function BuyAssetDrawer(props: BuyAssetDrawerProps) {
  const { wallet } = useAuth();
  return <BuyAssetDrawerContents {...props} wallet={wallet} />;
}

function BuyAssetDrawerContents({
  open,
  onOpenChange,
  asset,
  wallet,
}: BuyAssetDrawerProps & { wallet: ReturnType<typeof useAuth>["wallet"] }) {
  const { cashUsd } = useAppStore();
  const devnet = useDevnet();
  const [amount, setAmount] = useState("10");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ signature: string; amount: number } | null>(null);
  const amountValue = Number(amount);
  const maximumAmount = Math.min(cashUsd, 1000);
  const valid = Number.isFinite(amountValue) && amountValue >= 10 && amountValue <= maximumAmount;
  const purchaseAmount = pendingPayment?.amount ?? amountValue;
  const units = purchaseAmount;

  const changeOpen = (nextOpen: boolean) => {
    setResult(null);
    setError(null);
    onOpenChange(nextOpen);
  };

  const completePurchase = async () => {
    if ((!valid && !pendingPayment) || processing) return;
    setProcessing(true);
    setError(null);

    if (!devnet.treasuryOwner) {
        const message = "Solana devnet is not configured. Run node scripts/setup-devnet.mjs.";
        setError(message);
        toast.error(message);
        setProcessing(false);
        return;
      }
      if ((!wallet && !pendingPayment) || !devnet.walletAddress || !devnet.usdMint) {
        const message = "Couldn't connect your Solana wallet. Sign in again.";
        setError(message);
        toast.error(message);
        setProcessing(false);
        return;
      }
      try {
        let signature = pendingPayment?.signature;
        if (!signature) {
          setProgress("Signing the TEST QUOTE Devnet transfer…");
          const payment = await wallet!.send(devnet.treasuryOwner, devnet.usdMint, String(purchaseAmount));
          if (!payment.hash) throw new Error("The wallet did not return a transfer signature.");
          signature = payment.hash;
          setPendingPayment({ signature, amount: purchaseAmount });
        }
        setProgress("Confirming the Devnet transfer…");
        const requestPurchase = async () => {
          const response = await fetch("/api/devnet/buy-asset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              walletAddress: devnet.walletAddress,
              assetId: asset.id,
              amountUsd: purchaseAmount,
              signature,
            }),
          });
          const data = await response.json() as {
            signature?: unknown;
            explorerUrl?: unknown;
            units?: unknown;
            stage?: unknown;
          };
          if (response.ok && typeof data.signature === "string" && typeof data.explorerUrl === "string") {
            return {
              signature: data.signature,
              explorerUrl: data.explorerUrl,
              units: typeof data.units === "number" ? data.units : undefined,
            };
          }
          const message = data.stage === "verify"
            ? "Couldn't confirm the TEST QUOTE Devnet transfer."
            : data.stage === "mint"
              ? "The Devnet transfer is confirmed, but test asset issuance isn't complete yet."
              : "Couldn't confirm test asset issuance.";
          const failure = new Error(message) as Error & { stage?: unknown };
          failure.stage = data.stage;
          throw failure;
        };

        let data: Awaited<ReturnType<typeof requestPurchase>> | null = null;
        let lastRequestError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            data = await requestPurchase();
            break;
          } catch (requestError) {
            lastRequestError = requestError;
            const stage = (requestError as { stage?: unknown }).stage;
            if (stage !== "mint" && stage !== undefined) throw requestError;
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
          }
        }
        if (!data) {
          throw new Error("The Devnet transfer is confirmed, but the test asset hasn't been issued yet. Retry the confirmation.", { cause: lastRequestError });
        }
        const purchasedUnits = typeof data.units === "number" ? data.units : units;
        setResult({ amount: purchaseAmount, units: purchasedUnits, explorerUrl: data.explorerUrl });
        setPendingPayment(null);
        void devnet.refreshPortfolio();
        toast.success("Test asset issued");
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : "";
        const visibleMessage = message === "The wallet did not return a transfer signature."
          || message.startsWith("Devnet transfer")
          || message.startsWith("Couldn't confirm issuance")
          ? message
          : "Couldn't complete the TEST QUOTE Devnet transfer. Check your wallet and retry the confirmation.";
        setError(visibleMessage);
        toast.error(visibleMessage);
      } finally {
        setProcessing(false);
        setProgress(null);
      }
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title={`Get test asset · ${asset.ticker}`}
      description="SOLANA DEVNET · NO MONETARY VALUE. OFFICE grants no rights to real estate or any cash payout."
    >
      {result ? (
        <DrawerSuccess
          amount={result.amount}
          amountLabel={`${formatQuantity(result.units, 0)} ${asset.ticker}`}
          sentence="Test asset issued on Solana Devnet."
          note={result.note ?? "SOLANA DEVNET · NO MONETARY VALUE. OFFICE grants no rights to real estate or any cash payout."}
          onDone={() => changeOpen(false)}
          secondaryHref="/assets"
          secondaryLabel="Back to assets"
          explorerUrl={result.explorerUrl}
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="buy-amount" className="font-medium">TEST QUOTE amount</label>
              <span className="text-muted-foreground">
                Available {formatQuantity(cashUsd)} TEST QUOTE
              </span>
            </div>
            <div className="relative">
              <Input
                id="buy-amount"
                type="number"
                min="10"
                max={maximumAmount}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={processing || Boolean(pendingPayment)}
                className="h-12 pr-16 text-xl font-semibold tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                TEST QUOTE
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              1 {asset.ticker} = 1 TEST QUOTE · will issue {units > 0 ? formatQuantity(units, 0) : "0"} {asset.ticker}
            </p>
          </div>

          <Card className="gap-2 p-4">
            <p className="text-sm font-medium">Test asset issuance</p>
            <p className="text-xs leading-5 text-muted-foreground">
              After a confirmed Devnet transfer, the app will issue {asset.ticker} to your wallet. This is not a real estate purchase, an investment or a monetary transaction.
            </p>
          </Card>
          {amountValue < 10 ? (
            <p className="text-xs text-destructive">Minimum is 10 TEST QUOTE.</p>
          ) : null}
          {amountValue > cashUsd ? (
            <p className="text-xs text-destructive">
              Not enough TEST QUOTE. <a href="/home" className="underline">Prepare test units</a>.
            </p>
          ) : null}
          {amountValue > 1000 ? (
            <p className="text-xs text-destructive">Maximum is 1,000 TEST QUOTE.</p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {progress ? <p className="text-center text-xs text-muted-foreground">{progress}</p> : null}
          <Button className="w-full" onClick={completePurchase} disabled={(!valid && !pendingPayment) || processing}>
            <ArrowDownToLine />{processing ? (progress ?? "Issuing test asset…") : pendingPayment ? "Retry confirmation" : `Get ${formatQuantity(amountValue || 0)} ${asset.ticker}`}
          </Button>
        </div>
      )}
    </DrawerFrame>
  );
}
