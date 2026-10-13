"use client";

import { isUserFacingMessage } from "@/lib/action-errors";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpFromLine, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { MoonPaySellPath } from "@/components/app/moonpay-paths";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { ALL_YIELD_STRATEGIES, type YieldStrategy } from "@/lib/yields";
import { formatAtomicToDecimal, parseDecimalToAtomic } from "@/lib/earn-gateway";
import { useDevnet } from "@/lib/useDevnet";
import { useAuth } from "@/lib/useAuth";
import {
  GatewayDisclosureBadges,
  canRedeemStrategy,
  displayStrategyName,
  displayStrategyTicker,
  getGatewayInfo,
} from "@/components/app/earn-detail-parts";

type CompletedWithdrawal = {
  amount: number;
  currency?: "USD" | "KZT";
  shares?: number;
  shareTicker?: string;
  explorerUrl?: string;
  note?: string;
  isCardWithdrawal?: boolean;
  sentence?: string;
  amountLabel?: string;
};

type WithdrawDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddMoney?: () => void;
};

/** Existing portfolio data is numeric presentation data; normalize it before a new exact action. */
function displayShareAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return formatAtomicToDecimal(BigInt(Math.round(value * 1_000_000)), 6);
}

export function WithdrawDrawer(props: WithdrawDrawerProps) {
  const { wallet } = useAuth();
  return <WithdrawDrawerContents {...props} wallet={wallet} />;
}

function WithdrawDrawerContents({
  open,
  onOpenChange,
  onAddMoney,
  wallet,
}: WithdrawDrawerProps & { wallet: ReturnType<typeof useAuth>["wallet"] }) {
  const {
    positions,
    displayCurrency,
    cashUsd,
  } = useAppStore();
  const devnet = useDevnet();
  const [completed, setCompleted] = useState<CompletedWithdrawal | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pendingRedemption, setPendingRedemption] = useState<{
    productId: string;
    signature: string;
    sharesAtomic: string;
    sharesDecimal: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"yield" | "card" | "tenge">("yield");
  const [tengeAmount, setTengeAmount] = useState("10000");
  const [cardEnding, setCardEnding] = useState("");
  const [pendingKzte, setPendingKzte] = useState<{ signature: string; amount: number } | null>(null);
  const [cardAmount, setCardAmount] = useState("50");
  const [cardAmountTouched, setCardAmountTouched] = useState(false);
  const cardWithdrawalRecorded = useRef(false);
  const active = ALL_YIELD_STRATEGIES.filter((strategy) => positions[strategy.id]);
  const legacyExternalPayoutAvailable = false;
  const cardAmountValue = Number(cardAmount);
  const validCardAmount = Number.isFinite(cardAmountValue)
    && cardAmountValue >= 20
    && cardAmountValue <= cashUsd
    && cardAmountValue <= 1000;
  const kzteBalance = devnet.portfolio?.holdings.find((holding) => holding.kind === "kzte")?.balance ?? 0;
  const tengeAmountValue = Number(tengeAmount);
  const validTengeAmount = Number.isFinite(tengeAmountValue) && tengeAmountValue > 0 && tengeAmountValue <= kzteBalance;
  const pendingKzteMatches = Boolean(pendingKzte && Math.abs(pendingKzte.amount - tengeAmountValue) < 0.000001);

  const resetCardAmount = () => {
    setCardAmount(String(Math.max(20, Math.min(50, Math.floor(cashUsd)))));
    setCardAmountTouched(false);
  };

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen && method === "card") resetCardAmount();
    setCompleted(null);
    setError(null);
    cardWithdrawalRecorded.current = false;
    onOpenChange(nextOpen);
  };

  const completeCardWithdrawal = (amount: number, details: { signature: string; explorerUrl: string; note: string }) => {
    if (cardWithdrawalRecorded.current) return false;
    cardWithdrawalRecorded.current = true;
    setError(null);
    setCompleted({
      amount,
      explorerUrl: details.explorerUrl,
      note: details.note,
      isCardWithdrawal: true,
    });
    void devnet.refreshPortfolio();
    toast.success("MoonPay transfer confirmed");
    return true;
  };

  const withdrawPosition = async (strategy: YieldStrategy, requestedShares?: string) => {
    if (processingId) return;
    setError(null);
    if (!canRedeemStrategy(strategy)) {
      setError("TEST-TOKEN REDEMPTION is not supported for this position. No new operation was prepared.");
      return;
    }
    const position = positions[strategy.id];
    if (!position || !devnet.walletAddress) return;
    let redemption: { atomic: string; decimal: string };
    try {
      const decimal = requestedShares ?? displayShareAmount(position.shares ?? 0);
      const atomic = parseDecimalToAtomic(decimal, 6, "shares");
      if (atomic <= BigInt(0)) throw new Error("The number of shares must be positive.");
      redemption = { atomic: atomic.toString(10), decimal: formatAtomicToDecimal(atomic, 6) };
    } catch {
      setError("Enter the number of test shares with up to 6 decimal places.");
      return;
    }
    const shares = redemption.decimal;
    const vaultMint = strategy.id === "ondo-usdy" ? devnet.vaultUsdyMint : devnet.vaultKzgbMint;
    const retryPending = pendingRedemption?.productId === strategy.id && pendingRedemption.sharesAtomic === redemption.atomic;
    if (pendingRedemption && !retryPending) {
      setError("Retry the confirmation of the previous withdrawal first.");
      return;
    }
    if ((!wallet && !retryPending) || !devnet.treasuryOwner || !vaultMint) {
      setError("Couldn't connect the wallet or share token.");
      return;
    }
    setProcessingId(strategy.id);
    try {
      let signature = retryPending ? pendingRedemption.signature : null;
      if (!signature) {
        setProgress("Signing the transfer…");
        const transfer = await wallet!.send(devnet.treasuryOwner, vaultMint, String(shares));
        if (!transfer.hash) throw new Error("The wallet did not return a share transfer signature.");
        signature = transfer.hash;
        setPendingRedemption({
          productId: strategy.id,
          signature,
          sharesAtomic: redemption.atomic,
          sharesDecimal: shares,
        });
      }
      setProgress("Confirming on-chain…");
      const response = await fetch("/api/devnet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: devnet.walletAddress,
          productId: strategy.id,
          signature,
          sharesAtomic: redemption.atomic,
        }),
      });
      const result = await response.json() as {
        signature?: unknown;
        explorerUrl?: unknown;
        amountUsd?: unknown;
        sharesRedeemed?: unknown;
        error?: unknown;
      };
      if (!response.ok || typeof result.signature !== "string" || typeof result.explorerUrl !== "string"
        || typeof result.amountUsd !== "number" || typeof result.sharesRedeemed !== "number") {
        throw new Error(typeof result.error === "string" ? result.error : "Couldn't confirm test share redemption.");
      }
      setCompleted({
        amount: result.amountUsd,
        amountLabel: `${formatQuantity(result.sharesRedeemed)} ${displayStrategyTicker(strategy)}`,
        shares: result.sharesRedeemed,
        shareTicker: displayStrategyTicker(strategy),
        explorerUrl: result.explorerUrl,
        note: "SOLANA DEVNET · TEST-TOKEN REDEMPTION · NO MONETARY VALUE. This is not a cash payout.",
      });
      setPendingRedemption(null);
      void devnet.refreshPortfolio();
      toast.success("Test shares redeemed on Solana Devnet");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(isUserFacingMessage(message) ? message : "Couldn't confirm the withdrawal. Check your connection and retry the confirmation.");
    } finally {
      setProcessingId(null);
      setProgress(null);
    }
  };

  const redeemKzte = async () => {
    const pendingMatches = pendingKzteMatches;
    if (processingId || (!validTengeAmount && !pendingMatches) || cardEnding.length !== 4 || !devnet.walletAddress || !devnet.treasuryOwner || !devnet.kzteMint) return;
    if (pendingKzte && !pendingMatches) {
      setError("Retry the confirmation of the previous KZTE withdrawal first.");
      return;
    }
    if (!wallet && !pendingMatches) {
      setError("Couldn't connect the KZTE wallet.");
      return;
    }
    setProcessingId("kzte");
    setError(null);
    try {
      let signature = pendingMatches ? pendingKzte?.signature ?? null : null;
      if (!signature) {
        setProgress("Signing the KZTE transfer…");
        const transfer = await wallet!.send(devnet.treasuryOwner, devnet.kzteMint, String(tengeAmountValue));
        if (!transfer.hash) throw new Error("The wallet did not return a KZTE transfer signature.");
        signature = transfer.hash;
        setPendingKzte({ signature, amount: tengeAmountValue });
      }
      setProgress("Returning KZTE to the Intebix reserve…");
      const response = await fetch("/api/devnet/kzte/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      const result = await response.json() as { amountKzt?: unknown; explorerUrl?: unknown; error?: unknown };
      if (!response.ok || typeof result.amountKzt !== "number" || typeof result.explorerUrl !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Couldn't withdraw KZTE.");
      }
      setCompleted({
        amount: result.amountKzt,
        currency: "KZT",
        amountLabel: result.amountKzt.toLocaleString("en-US") + " ₸",
        sentence: "Payout " + result.amountKzt.toLocaleString("en-US") + " ₸ to card ·· " + cardEnding + " via Intebix; KZTE returned to the Intebix reserve.",
        note: "Processed on Solana devnet. A receipt will be sent to your account email.",
        explorerUrl: result.explorerUrl,
      });
      setPendingKzte(null);
      void devnet.refreshPortfolio();
      toast.success("KZTE returned to the Intebix reserve");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "";
      setError(isUserFacingMessage(message) ? message : "Couldn't confirm the KZTE withdrawal. Check your connection and try again.");
    } finally {
      setProcessingId(null);
      setProgress(null);
    }
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="Withdraw funds"
      description={method === "card" ? "The external adapter is not available in Universal Earn on Solana Devnet." : method === "tenge" ? "The external adapter is not available in Universal Earn on Solana Devnet." : "DEVNET TEST-TOKEN REDEMPTION: submit test shares for redemption; test tokens return to your wallet."}
    >
      {completed ? (
        <DrawerSuccess
          amount={completed.amount}
          currency={completed.currency ?? displayCurrency}
          amountLabel={completed.amountLabel}
          sentence={completed.sentence ?? (completed.isCardWithdrawal
            ? "MoonPay transfer confirmed on Solana devnet."
            : `Redeemed ${formatQuantity(completed.shares ?? Number.NaN)} ${completed.shareTicker ?? "test shares"}; test tokens returned to your Devnet wallet. This is not a cash payout.`)}
          note={completed.note}
          onDone={() => changeOpen(false)}
          secondaryHref="/activity"
          secondaryLabel="Transaction history"
          explorerUrl={completed.explorerUrl}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Withdrawal method">
            <button
              type="button"
              role="tab"
              aria-selected={method === "yield"}
              disabled={Boolean(processingId || pendingRedemption || pendingKzte)}
              onClick={() => {
                setMethod("yield");
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${method === "yield" ? "border-foreground bg-muted" : "hover:bg-muted/40"}`}
            >
              From deposit to balance
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "card"}
              disabled
              onClick={() => {
                resetCardAmount();
                setError(null);
                setMethod("card");
              }}
              className="rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              To card · unavailable
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "tenge"}
              disabled
              onClick={() => { setError(null); setMethod("tenge"); }}
              className="rounded-lg border px-3 py-2 text-sm font-medium text-muted-foreground opacity-60"
            >
              KZTE · unavailable
            </button>
          </div>
          <Card className="gap-2 border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-medium">SOLANA DEVNET · NO MONETARY VALUE</p>
            <p className="text-xs leading-5 text-muted-foreground">
              The card, KZTE and Intebix external adapters are optional future integrations and are not part of this
              Devnet strategy. They do not create a cash payout or bank transfer.
            </p>
          </Card>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {method === "yield" && active.length > 0 ? (
            <div className="space-y-2">
              {active.map((strategy) => (
                <WithdrawPosition
                  key={strategy.id}
                  strategy={strategy}
                  position={positions[strategy.id]!}
                  processing={processingId === strategy.id}
                  processingLabel={progress}
                  pending={pendingRedemption?.productId === strategy.id}
                  blocked={Boolean(pendingRedemption && pendingRedemption.productId !== strategy.id)}
                  onWithdraw={withdrawPosition}
                />
              ))}
            </div>
          ) : null}
          {method === "yield" && active.length === 0 ? (
            <Card className="items-center gap-2 p-6 text-center">
              <WalletCards className="size-6 text-muted-foreground" />
              <p className="font-medium">No open deposits</p>
              <p className="text-sm text-muted-foreground">
                Open a deposit in the Earn tab to move money back to your balance.
              </p>
              <Button
                variant="outline"
                className="mt-2"
                nativeButton={false}
                render={<Link href="/earn" />}
              >
                Go to deposits
              </Button>
            </Card>
          ) : null}
          {method === "card" && legacyExternalPayoutAvailable ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="moonpay-withdraw-amount" className="text-sm font-medium">Withdrawal amount</label>
                <span className="text-xs text-muted-foreground">Available {formatMoney(cashUsd, "USD")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="moonpay-withdraw-amount"
                  type="number"
                  min="20"
                  max={cashUsd}
                  inputMode="decimal"
                  value={cardAmount}
                  onChange={(event) => {
                    setCardAmount(event.target.value);
                    setCardAmountTouched(true);
                  }}
                  className="h-11 text-lg tabular-nums"
                />
                <span className="text-sm font-medium">USD</span>
              </div>
              <p className="text-xs text-muted-foreground">Minimum $20, maximum $1,000 per MoonPay operation.</p>
              {cashUsd < 20 ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Withdrawing to a card requires at least $20.</p>
                  {onAddMoney ? (
                    <Button variant="outline" className="w-full" onClick={onAddMoney}>
                      Add to balance
                    </Button>
                  ) : null}
                </div>
              ) : cardAmountTouched && !validCardAmount ? (
                <p className="text-xs text-destructive">
                  Enter an amount from $20 up to your available balance, and no more than $1,000.
                </p>
              ) : null}
            </div>
          ) : null}
          {method === "card" && legacyExternalPayoutAvailable ? (
            <MoonPaySellPath
              amount={cardAmountValue || 0}
              validAmount={validCardAmount}
              onWithdrawal={completeCardWithdrawal}
              onSelectAnotherMethod={() => setMethod("yield")}
            />
          ) : null}
          {method === "tenge" && legacyExternalPayoutAvailable ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="intebix-withdraw-amount" className="text-sm font-medium">Withdrawal amount</label>
                <span className="text-xs text-muted-foreground">Available {formatQuantity(kzteBalance)} KZTE</span>
              </div>
              <div className="flex items-center gap-2">
                <Input id="intebix-withdraw-amount" type="number" min="0.000001" step="any" max={kzteBalance} inputMode="decimal" value={tengeAmount} onChange={(event) => setTengeAmount(event.target.value)} disabled={Boolean(processingId || pendingKzte)} className="h-11 text-lg tabular-nums" />
                <span className="text-sm font-medium">KZTE</span>
              </div>
              <label htmlFor="intebix-withdraw-card" className="block text-sm font-medium">Last 4 digits of the card</label>
              <Input id="intebix-withdraw-card" type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={cardEnding} onChange={(event) => setCardEnding(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" disabled={Boolean(processingId)} className="h-11" />
              <p className="text-xs text-muted-foreground">Payout on Solana devnet.</p>
              {kzteBalance <= 0 ? <p className="text-xs text-muted-foreground">There is no KZTE in the wallet yet.</p> : null}
              {!validTengeAmount && kzteBalance > 0 ? <p className="text-xs text-destructive">Enter an amount no greater than your available balance.</p> : null}
              {cardEnding.length > 0 && cardEnding.length !== 4 ? <p className="text-xs text-destructive">Enter the last 4 digits of the card.</p> : null}
              <Button className="w-full" onClick={() => void redeemKzte()} disabled={Boolean(processingId) || (!validTengeAmount && !pendingKzteMatches) || cardEnding.length !== 4 || Boolean(pendingKzte && !pendingKzteMatches)}>
                {processingId === "kzte" ? (progress ?? "Withdrawing…") : pendingKzte ? "Retry confirmation" : "Withdraw"}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </DrawerFrame>
  );
}

function WithdrawPosition({
  strategy,
  position,
  processing,
  processingLabel,
  pending,
  blocked,
  onWithdraw,
}: {
  strategy: YieldStrategy;
  position: { principal: number; earnedCarryUsd?: number; shares?: number; priceUsd?: number; valueUsd?: number };
  processing: boolean;
  processingLabel: string | null;
  pending: boolean;
  blocked: boolean;
  onWithdraw: (strategy: YieldStrategy, shares?: string) => void;
}) {
  const gateway = getGatewayInfo(strategy);
  const canRedeem = canRedeemStrategy(strategy);
  const availableShares = position.shares ?? position.principal;
  const [sharesInput, setSharesInput] = useState(displayShareAmount(availableShares));
  const requestedShares = Number(sharesInput);
  const validShares = Number.isFinite(requestedShares) && requestedShares > 0 && requestedShares <= availableShares;
  const earned = position.earnedCarryUsd ?? 0;
  const redemptionEstimate = requestedShares * (position.priceUsd ?? 1);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{displayStrategyName(strategy)}</p>
          <p className="text-xs text-muted-foreground">{formatQuantity(availableShares)} {displayStrategyTicker(strategy)} · {formatQuantity(position.valueUsd ?? position.principal + earned)} TEST QUOTE</p>
        </div>
        <span className="text-right text-xs tabular-nums text-muted-foreground">
          Illustrative change: {formatQuantity(earned)} TEST QUOTE
        </span>
      </div>
      <GatewayDisclosureBadges strategy={strategy} />
      <p className="text-xs leading-5 text-muted-foreground">
        DEVNET TEST-TOKEN REDEMPTION: this returns the configured value of test shares; it is not a cash payout.
      </p>
      {!canRedeem ? (
        <p className="text-xs leading-5 text-destructive">
          Exit unavailable: {gateway.availabilityReason ?? "no confirmed TEST-TOKEN REDEMPTION path is configured for this strategy."}
        </p>
      ) : null}
      <label className="space-y-1.5 text-sm">
          <span>Test shares to redeem</span>
          <Input
            type="number"
            min="0.000001"
            step="0.000001"
            max={availableShares}
            inputMode="decimal"
            value={sharesInput}
            onChange={(event) => setSharesInput(event.target.value)}
            disabled={processing || pending || !canRedeem}
          />
          <span className="block text-xs text-muted-foreground">Estimated return: {formatQuantity(redemptionEstimate)} TEST QUOTE · NO MONETARY VALUE</span>
          {!validShares ? <span className="block text-xs text-destructive">Enter an amount no greater than your available balance.</span> : null}
      </label>
      <Button
        variant="outline"
        className="w-full"
            onClick={() => onWithdraw(strategy, sharesInput)}
        disabled={processing || blocked || !canRedeem || (!validShares && !pending)}
      >
        <ArrowUpFromLine />{processing ? (processingLabel ?? "Redeeming test shares…") : pending ? "Retry confirmation" : canRedeem ? "Redeem test shares" : "Exit unavailable"}
      </Button>
    </Card>
  );
}
