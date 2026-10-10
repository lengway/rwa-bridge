"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SolanaWallet } from "@crossmint/wallets-sdk";
import {
  AlertTriangle,
  ArrowDownUp,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/useAuth";
import { useDevnet } from "@/lib/useDevnet";

export type RwaDemoDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Defaults to the API's RWA-DEMO asset. */
  assetId?: string;
  /** Called only after the backend has confirmed the Devnet swap. */
  onTradeConfirmed?: () => void;
};

/** A small self-contained entry point for a demo-asset screen or catalog. */
export function RwaDemoLauncher({
  assetId,
  onTradeConfirmed,
}: Omit<RwaDemoDrawerProps, "open" | "onOpenChange">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card className="gap-3 rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">RWA-DEMO</p>
              <Badge variant="secondary">DEVNET DEMO</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Test-token trading through a direct Meteora DLMM Devnet pool. It is not a real-world asset or a fiat on-ramp.</p>
          </div>
          <ShieldCheck className="mt-0.5 size-5 text-muted-foreground" />
        </div>
        <Button className="w-full" variant="outline" onClick={() => setOpen(true)}>Open Devnet demo</Button>
      </Card>
      <RwaDemoDrawer open={open} onOpenChange={setOpen} assetId={assetId} onTradeConfirmed={onTradeConfirmed} />
    </>
  );
}

type Side = "BUY" | "SELL";
type BusyState = "assets" | "funding" | "quoting" | "building" | "signing" | "confirming" | "payout" | null;
type RetryStage = "assets" | "funding" | "quote" | "confirm" | "payout" | null;

type DemoAsset = {
  id: string;
  name: string;
  symbol: string;
  description: string | null;
  network: string;
  mintAddress: string | null;
  quoteMintAddress: string | null;
  poolAddress: string | null;
  decimals: number;
  quoteDecimals: number;
  tradeEnabled: boolean;
  rightsDisclosure: string;
  explorerUrl: string | null;
  quoteMintExplorerUrl: string | null;
  poolExplorerUrl: string | null;
};

type Funding = {
  id: string;
  status: string;
  requestedKztAmount: string;
  demoRate: string | null;
  quoteTokenAmountAtomic: string;
  mintSignature: string | null;
  mintExplorerUrl: string | null;
  disclosure: string;
};

type DemoQuote = {
  id: string;
  side: Side;
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  minimumOutputAtomic: string;
  slippageBps: number | null;
  feeAmountAtomic: string | null;
  priceImpactBps: number | null;
  expiresAt: string | number | null;
  route: string;
  network: string;
  poolAddress: string | null;
};

type DemoOrder = {
  id: string;
  status: string;
  signature: string | null;
  explorerUrl: string | null;
  actualInputAmountAtomic: string | null;
  actualOutputAmountAtomic: string | null;
};

type Payout = {
  id: string;
  status: string;
  quoteTokenAmountAtomic: string | null;
  simulatedKztAmount: string | null;
  disclosure: string;
};

type DrawerError = {
  message: string;
  retryStage: RetryStage;
};

class DemoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const SIMULATED_FUNDING_DISCLOSURE = "SIMULATED — no fiat payment";
const SIMULATED_PAYOUT_DISCLOSURE = "SIMULATED — no KZT payout";
const DEVNET_TOKEN_DISCLOSURE = "DEVNET TEST TOKEN — no monetary value";
const DEVNET_SWAP_DISCLOSURE = "DEVNET SWAP — no real asset rights";

export function RwaDemoDrawer({
  open,
  onOpenChange,
  assetId,
  onTradeConfirmed,
}: RwaDemoDrawerProps) {
  const { wallet } = useAuth();
  const devnet = useDevnet();
  const [asset, setAsset] = useState<DemoAsset | null>(null);
  const [configured, setConfigured] = useState(false);
  const [assetsDisclosure, setAssetsDisclosure] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("BUY");
  const [kztInput, setKztInput] = useState("25000");
  const [fundingRequestId, setFundingRequestId] = useState<string | null>(null);
  const [sellInput, setSellInput] = useState("");
  const [funding, setFunding] = useState<Funding | null>(null);
  const [quote, setQuote] = useState<DemoQuote | null>(null);
  const [order, setOrder] = useState<DemoOrder | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<DemoOrder | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<DrawerError | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);

  const walletAddress = wallet?.address ?? devnet.walletAddress;
  const walletMismatch = Boolean(wallet?.address && devnet.walletAddress && wallet.address !== devnet.walletAddress);
  const isDevnet = asset?.network.toLowerCase() === "devnet";
  const demoReady = Boolean(asset && configured && isDevnet && asset.tradeEnabled && wallet && walletAddress && !walletMismatch);
  const sellInputAtomic = useMemo(
    () => asset ? decimalToAtomic(sellInput, asset.decimals) : null,
    [asset, sellInput],
  );
  const isFundingIssued = funding?.status === "TEST_TOKEN_ISSUED";
  const quoteInputAtomic = side === "BUY" ? funding?.quoteTokenAmountAtomic ?? null : sellInputAtomic;
  const quoteExpired = quote ? isExpired(quote.expiresAt) : false;

  const clearTrade = useCallback(() => {
    setQuote(null);
    setOrder(null);
    setPendingSignature(null);
    setCompletedOrder(null);
    setPayout(null);
    setNotice(null);
  }, []);

  const resetForClose = useCallback(() => {
    setFunding(null);
    setFundingRequestId(null);
    setSellInput("");
    clearTrade();
    setError(null);
    setBusy(null);
  }, [clearTrade]);

  const loadAssets = useCallback(async () => {
    setBusy("assets");
    setError(null);
    try {
      const payload = await requestJson("/api/demo/assets");
      const response = asRecord(payload);
      const assets = Array.isArray(response?.assets)
        ? response.assets.map(normalizeAsset).filter((item): item is DemoAsset => item !== null)
        : [];
      const selected = assetId
        ? assets.find((item) => item.id === assetId)
        : assets.find((item) => item.id === "rwa-demo") ?? assets[0];
      if (!selected) {
        throw new DemoApiError("RWA-DEMO asset is not configured for this environment.", 503);
      }
      if (assetId && selected.id !== assetId) {
        throw new DemoApiError("The requested demo asset is unavailable.", 404);
      }
      setAsset(selected);
      setConfigured(response?.configured === true);
      setAssetsDisclosure(readString(response?.disclosure));
    } catch (requestError) {
      setAsset(null);
      setConfigured(false);
      setError({ message: userFacingError(requestError, "Could not load the Devnet demo asset."), retryStage: "assets" });
    } finally {
      setBusy(null);
    }
  }, [assetId]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadAssets(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAssets, open]);

  const selectSide = (nextSide: Side) => {
    if (busy) return;
    setSide(nextSide);
    clearTrade();
    setError(null);
  };

  const createFunding = async () => {
    if (!demoReady || busy || !walletAddress || funding) return;
    const requestedKztAmount = parseKztInput(kztInput);
    if (requestedKztAmount === null) {
      setError({ message: "Enter a whole illustrative KZT amount within the demo limits.", retryStage: null });
      return;
    }
    setBusy("funding");
    setError(null);
    setNotice(null);
    try {
      // Keep this key across a network retry so the server never repeats an
      // ambiguous faucet mint. Editing the illustrative amount starts a new
      // intentional funding request.
      const idempotencyKey = fundingRequestId ?? crypto.randomUUID();
      if (!fundingRequestId) setFundingRequestId(idempotencyKey);
      const payload = await requestJson("/api/demo/funding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, requestedKztAmount, idempotencyKey }),
      });
      const response = asRecord(payload);
      const nextFunding = normalizeFunding(response?.funding);
      if (!nextFunding) throw new DemoApiError("The funding response did not contain a valid demo funding event.", 502);
      setFunding(nextFunding);
      clearTrade();
      setNotice(nextFunding.status === "TEST_TOKEN_ISSUED"
        ? "QUOTE-DEMO issuance was confirmed on Solana Devnet. Request a fresh Meteora quote before trading."
        : "The simulated top-up was recorded. QUOTE-DEMO has not been issued yet, so trading remains disabled.");
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Could not create the simulated funding event."), retryStage: "funding" });
    } finally {
      setBusy(null);
    }
  };

  const requestQuote = async () => {
    if (!demoReady || busy || !asset || !walletAddress) return;
    if (side === "BUY" && !isFundingIssued) {
      setError({ message: "Issue QUOTE-DEMO first. A simulated funding record alone is not spendable.", retryStage: null });
      return;
    }
    if (!quoteInputAtomic || !isPositiveAtomic(quoteInputAtomic)) {
      setError({ message: side === "BUY" ? "No issued QUOTE-DEMO amount is available for this buy." : "Enter a valid RWA-DEMO amount to sell.", retryStage: null });
      return;
    }
    setBusy("quoting");
    setError(null);
    setNotice(null);
    try {
      const payload = await requestJson("/api/demo/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          side,
          inputAmountAtomic: quoteInputAtomic,
          walletAddress,
        }),
      });
      const response = asRecord(payload);
      const nextQuote = normalizeQuote(response?.quote);
      if (!nextQuote) throw new DemoApiError("The quote response is incomplete. Please request a fresh quote.", 502);
      if (nextQuote.network.toLowerCase() !== "devnet" || nextQuote.route !== "meteora-dlmm-devnet") {
        throw new DemoApiError("The execution route is not a direct Meteora DLMM Devnet route.", 409);
      }
      setQuote(nextQuote);
      setOrder(null);
      setPendingSignature(null);
      setCompletedOrder(null);
      setPayout(null);
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Could not request a fresh Meteora Devnet quote."), retryStage: "quote" });
    } finally {
      setBusy(null);
    }
  };

  const confirmExistingOrder = useCallback(async (orderId: string, signature: string) => {
    setBusy("confirming");
    setError(null);
    try {
      const payload = await requestJson(`/api/demo/orders/${encodeURIComponent(orderId)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });
      const response = asRecord(payload);
      const nextOrder = normalizeOrder(response?.order);
      if (!nextOrder) throw new DemoApiError("The confirmation response did not contain a valid order.", 502);
      setOrder(nextOrder);
      if (isCompletedStatus(nextOrder.status)) {
        setCompletedOrder(nextOrder);
        setNotice("The swap is confirmed on Solana Devnet and balances are being refreshed.");
        void devnet.refreshPortfolio();
        onTradeConfirmed?.();
      } else if (isFailureStatus(nextOrder.status)) {
        throw new DemoApiError(`The swap finished with status ${nextOrder.status}.`, 409);
      } else {
        setNotice("The transaction was submitted. Check confirmation before sending anything again.");
      }
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Could not verify the Devnet transaction yet."), retryStage: "confirm" });
    } finally {
      setBusy(null);
    }
  }, [devnet, onTradeConfirmed]);

  const signAndSubmit = async () => {
    if (!demoReady || !asset || !quote || !wallet || !walletAddress || busy) return;
    if (quoteExpired) {
      setError({ message: "This quote has expired. Request a fresh quote before signing.", retryStage: "quote" });
      return;
    }
    if (order && pendingSignature) {
      await confirmExistingOrder(order.id, pendingSignature);
      return;
    }

    let currentOrder = order;
    // React state updates are asynchronous. Keep a local copy so an RPC
    // confirmation timeout after a successful wallet submission can only be
    // retried as reconciliation — never as another signed swap.
    let submittedSignature: string | null = null;
    try {
      setError(null);
      setNotice(null);
      if (!currentOrder) {
        setBusy("building");
        const payload = await requestJson("/api/demo/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId: quote.id }),
        });
        const response = asRecord(payload);
        currentOrder = normalizeOrder(response?.order);
        if (!currentOrder) throw new DemoApiError("The order response did not contain a valid order.", 502);
        setOrder(currentOrder);
      }

      setBusy("building");
      // Preparing a serialized transaction advances the server-side order state,
      // so it is deliberately a POST rather than a prefetchable GET.
      const transactionPayload = await requestJson(`/api/demo/orders/${encodeURIComponent(currentOrder.id)}/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const transactionResponse = asRecord(transactionPayload);
      const serializedTransaction = readString(transactionResponse?.serializedTransaction);
      const transactionOrder = normalizeOrder(transactionResponse?.order);
      if (!serializedTransaction || !transactionOrder) {
        throw new DemoApiError("The server could not prepare a current transaction for this order.", 502);
      }
      if (isFailureStatus(transactionOrder.status)) {
        throw new DemoApiError(`The order cannot be signed because its status is ${transactionOrder.status}.`, 409);
      }
      setOrder(transactionOrder);

      setBusy("signing");
      const result = await SolanaWallet.from(wallet).sendTransaction({ serializedTransaction });
      if (!result.hash) throw new DemoApiError("The wallet did not return a transaction signature.", 502);
      submittedSignature = result.hash;
      setPendingSignature(result.hash);
      setOrder((current) => current ? { ...current, signature: result.hash } : current);
      await confirmExistingOrder(transactionOrder.id, result.hash);
    } catch (requestError) {
      setBusy(null);
      const message = userFacingError(requestError, "Could not prepare or sign the Meteora Devnet swap.");
      setError({
        message,
        retryStage: isLikelyUserRejection(requestError) ? null : (submittedSignature ?? pendingSignature) ? "confirm" : "quote",
      });
    }
  };

  const createPayout = async () => {
    if (!completedOrder || busy) return;
    setBusy("payout");
    setError(null);
    try {
      const payload = await requestJson("/api/demo/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: completedOrder.id }),
      });
      const response = asRecord(payload);
      const nextPayout = normalizePayout(response?.payout);
      if (!nextPayout) throw new DemoApiError("The payout response did not contain a valid simulated payout record.", 502);
      setPayout(nextPayout);
      setNotice(nextPayout.status === "SIMULATED_CONFIRMED"
        ? "The simulated payout receipt is complete. No bank transfer was sent."
        : "The simulated payout record was created. No bank transfer was sent.");
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Could not create the simulated payout record."), retryStage: "payout" });
    } finally {
      setBusy(null);
    }
  };

  const retry = () => {
    if (busy) return;
    if (error?.retryStage === "assets") void loadAssets();
    if (error?.retryStage === "funding") void createFunding();
    if (error?.retryStage === "quote") void requestQuote();
    if (error?.retryStage === "confirm" && order && pendingSignature) void confirmExistingOrder(order.id, pendingSignature);
    if (error?.retryStage === "payout") void createPayout();
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) resetForClose();
    onOpenChange(nextOpen);
  };

  const successfulBuy = completedOrder && side === "BUY";
  const successfulPayout = payout?.status === "SIMULATED_CONFIRMED";

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="RWA-DEMO · Devnet"
      description="A direct Meteora DLMM test-token swap. No real asset rights or fiat payment."
    >
      {successfulBuy ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`+ ${formatAtomic(completedOrder.actualOutputAmountAtomic ?? quote?.expectedOutputAtomic ?? "0", asset?.decimals ?? 0)} ${asset?.symbol ?? "RWA-DEMO"}`}
          sentence="RWA-DEMO buy confirmed on Solana Devnet via Meteora DLMM."
          note={DEVNET_SWAP_DISCLOSURE}
          explorerUrl={completedOrder.explorerUrl ?? explorerForSignature(completedOrder.signature)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Open portfolio"
        />
      ) : successfulPayout ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`${payout.simulatedKztAmount ?? "0"} ₸`}
          sentence="A simulated KZT payout record was created after the confirmed Devnet sale."
          note={payout.disclosure || SIMULATED_PAYOUT_DISCLOSURE}
          explorerUrl={completedOrder?.explorerUrl ?? explorerForSignature(completedOrder?.signature ?? null)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Open portfolio"
        />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">DEVNET DEMO</Badge>
            <Badge variant="outline">Solana Devnet</Badge>
            <Badge variant="outline">Direct Meteora DLMM</Badge>
          </div>

          <Disclosure>
            <p className="font-medium">{DEVNET_TOKEN_DISCLOSURE}</p>
            <p>{DEVNET_SWAP_DISCLOSURE}</p>
            <p>{assetsDisclosure ?? "This demo uses test tokens only and does not represent a financial product or legal right."}</p>
          </Disclosure>

          {busy === "assets" ? <LoadingLine label="Loading RWA-DEMO configuration…" /> : null}
          {!busy && !asset && !error ? <EmptyState onRetry={() => void loadAssets()} /> : null}

          {asset ? (
            <>
              <AssetCard asset={asset} configured={configured} />

              {!configured ? (
                <GuardAlert title="Demo configuration is incomplete">
                  Trading is disabled until the server validates the Devnet mints and Meteora pool.
                </GuardAlert>
              ) : null}
              {!isDevnet ? (
                <GuardAlert title="Wrong network">
                  This demo fails closed unless the API explicitly reports Solana Devnet. No transaction can be prepared.
                </GuardAlert>
              ) : null}
              {!asset.tradeEnabled ? (
                <GuardAlert title="Trading is disabled">
                  The configured RWA-DEMO pool is not currently available for trading.
                </GuardAlert>
              ) : null}
              {!wallet ? (
                <GuardAlert title="Wallet unavailable">
                  Sign in with the app wallet before creating a demo order. Your wallet signs every Devnet swap.
                </GuardAlert>
              ) : null}
              {walletMismatch ? (
                <GuardAlert title="Wallet session mismatch">
                  The connected wallet and the current Devnet portfolio do not match. Reopen the app and try again.
                </GuardAlert>
              ) : null}

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Trade direction">
                <Button
                  type="button"
                  variant={side === "BUY" ? "secondary" : "outline"}
                  onClick={() => selectSide("BUY")}
                  disabled={Boolean(busy)}
                >
                  Buy RWA-DEMO
                </Button>
                <Button
                  type="button"
                  variant={side === "SELL" ? "secondary" : "outline"}
                  onClick={() => selectSide("SELL")}
                  disabled={Boolean(busy)}
                >
                  Sell RWA-DEMO
                </Button>
              </div>

              {side === "BUY" ? (
                <FundingPanel
                  value={kztInput}
                  disabled={!demoReady || Boolean(busy)}
                  funding={funding}
                  quoteDecimals={asset.quoteDecimals}
                  onValueChange={(value) => {
                    setKztInput(value);
                    setFunding(null);
                    setFundingRequestId(null);
                    clearTrade();
                    setError(null);
                  }}
                  onFunding={() => void createFunding()}
                />
              ) : (
                <SellPanel
                  value={sellInput}
                  symbol={asset.symbol}
                  disabled={!demoReady || Boolean(busy)}
                  atomic={sellInputAtomic}
                  decimals={asset.decimals}
                  onValueChange={(value) => {
                    setSellInput(value);
                    clearTrade();
                    setError(null);
                  }}
                />
              )}

              {quote ? <QuoteCard quote={quote} asset={asset} /> : null}
              {quote && quoteExpired && !completedOrder ? (
                <Button className="w-full" variant="outline" onClick={() => void requestQuote()} disabled={Boolean(busy)}>
                  <RefreshCw />Refresh expired quote
                </Button>
              ) : null}

              {notice ? (
                <Alert>
                  <ShieldCheck />
                  <AlertTitle>Devnet status</AlertTitle>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Action required</AlertTitle>
                  <AlertDescription>
                    <span>{error.message}</span>
                    {error.retryStage ? (
                      <Button className="mt-3" size="sm" variant="outline" onClick={retry} disabled={Boolean(busy)}>
                        <RefreshCw />Retry
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {side === "BUY" && funding && !isFundingIssued ? (
                <GuardAlert title="QUOTE-DEMO has not been issued">
                  {funding.disclosure || SIMULATED_FUNDING_DISCLOSURE}. Follow the documented Devnet funding step or enable the guarded faucet; do not treat this as a fiat payment.
                </GuardAlert>
              ) : null}

              {!completedOrder ? (
                quote ? (
                  <Button
                    className="w-full"
                    onClick={() => void signAndSubmit()}
                    disabled={!demoReady || quoteExpired || Boolean(busy)}
                  >
                    {busy === "building" ? <><LoaderCircle className="animate-spin" />Preparing fresh transaction…</> : null}
                    {busy === "signing" ? <><LoaderCircle className="animate-spin" />Awaiting wallet signature…</> : null}
                    {busy === "confirming" ? <><LoaderCircle className="animate-spin" />Confirming on Devnet…</> : null}
                    {!busy && pendingSignature ? <><RefreshCw />Check confirmation</> : null}
                    {!busy && !pendingSignature ? <><ArrowDownUp />Review and sign Devnet swap</> : null}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => void requestQuote()}
                    disabled={!demoReady || Boolean(busy) || (side === "BUY" && !isFundingIssued) || (side === "SELL" && !isPositiveAtomic(sellInputAtomic))}
                  >
                    {busy === "quoting" ? <><LoaderCircle className="animate-spin" />Requesting fresh quote…</> : <><RefreshCw />Get fresh Meteora quote</>}
                  </Button>
                )
              ) : null}

              {completedOrder && side === "SELL" ? (
                <Card className="gap-3 rounded-2xl p-4">
                  <div>
                    <p className="font-medium">Devnet sale confirmed</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Create an explicitly simulated payout receipt. This does not send KZT or start a bank transfer.</p>
                  </div>
                  <Button className="w-full" onClick={() => void createPayout()} disabled={Boolean(busy)}>
                    {busy === "payout" ? <><LoaderCircle className="animate-spin" />Creating simulated payout…</> : "Create simulated KZT payout receipt"}
                  </Button>
                </Card>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </DrawerFrame>
  );
}

function FundingPanel({
  value,
  disabled,
  funding,
  quoteDecimals,
  onValueChange,
  onFunding,
}: {
  value: string;
  disabled: boolean;
  funding: Funding | null;
  quoteDecimals: number;
  onValueChange: (value: string) => void;
  onFunding: () => void;
}) {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="space-y-1">
        <p className="font-medium">1. Simulate a KZT top-up</p>
        <p className="text-xs leading-5 text-muted-foreground">{SIMULATED_FUNDING_DISCLOSURE}. The illustrative rate is not a live FX rate and no payment is collected.</p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Illustrative KZT amount</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(event.target.value.replace(/[^0-9]/g, ""))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label="Illustrative KZT amount"
          />
          <span className="text-sm font-medium">₸</span>
        </div>
      </label>
      <Button className="w-full" variant="outline" onClick={onFunding} disabled={disabled || Boolean(funding) || parseKztInput(value) === null}>
        Create simulated top-up and issue QUOTE-DEMO
      </Button>
      {funding ? (
        <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs leading-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Funding status</span>
            <Badge variant={funding.status === "TEST_TOKEN_ISSUED" ? "secondary" : "outline"}>{funding.status}</Badge>
          </div>
          <p>{SIMULATED_FUNDING_DISCLOSURE}</p>
          {funding.demoRate ? <p>Illustrative demo rate: {funding.demoRate} KZT per QUOTE-DEMO.</p> : null}
          <p>QUOTE-DEMO: {formatAtomic(funding.quoteTokenAmountAtomic, quoteDecimals)} (atomic: {funding.quoteTokenAmountAtomic})</p>
          {funding.mintExplorerUrl ? <ExplorerLink href={funding.mintExplorerUrl} label="View QUOTE-DEMO issue transaction" /> : null}
        </div>
      ) : null}
    </Card>
  );
}

function SellPanel({
  value,
  symbol,
  disabled,
  atomic,
  decimals,
  onValueChange,
}: {
  value: string;
  symbol: string;
  disabled: boolean;
  atomic: string | null;
  decimals: number;
  onValueChange: (value: string) => void;
}) {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="space-y-1">
        <p className="font-medium">1. Choose RWA-DEMO to sell</p>
        <p className="text-xs leading-5 text-muted-foreground">{DEVNET_SWAP_DISCLOSURE}</p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">RWA-DEMO amount</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(sanitizeDecimalInput(event.target.value))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label="RWA-DEMO amount to sell"
          />
          <span className="text-sm font-medium">{symbol}</span>
        </div>
      </label>
      <p className="text-xs text-muted-foreground">
        {atomic && isPositiveAtomic(atomic) ? `Atomic input: ${atomic} (${formatAtomic(atomic, decimals)} ${symbol})` : "Enter a positive amount; raw token units are calculated without floating-point arithmetic."}
      </p>
    </Card>
  );
}

function QuoteCard({ quote, asset }: { quote: DemoQuote; asset: DemoAsset }) {
  const inputSymbol = quote.side === "BUY" ? "QUOTE-DEMO" : asset.symbol;
  const outputSymbol = quote.side === "BUY" ? asset.symbol : "QUOTE-DEMO";
  const inputDecimals = quote.side === "BUY" ? asset.quoteDecimals : asset.decimals;
  const outputDecimals = quote.side === "BUY" ? asset.decimals : asset.quoteDecimals;
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">2. Fresh Meteora quote</p>
          <p className="mt-1 text-xs text-muted-foreground">{quote.route} · Devnet pool quote, not a real market price.</p>
        </div>
        <Badge variant="outline">{quote.side}</Badge>
      </div>
      <QuoteRow label="Input" value={`${formatAtomic(quote.inputAmountAtomic, inputDecimals)} ${inputSymbol}`} />
      <QuoteRow label="Expected output" value={`${formatAtomic(quote.expectedOutputAtomic, outputDecimals)} ${outputSymbol}`} />
      <QuoteRow label="Minimum output" value={`${formatAtomic(quote.minimumOutputAtomic, outputDecimals)} ${outputSymbol}`} />
      <QuoteRow label="Slippage" value={quote.slippageBps === null ? "—" : `${(quote.slippageBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} />
      <QuoteRow label="Fee" value={quote.feeAmountAtomic === null ? "—" : `${formatAtomic(quote.feeAmountAtomic, inputDecimals)} ${inputSymbol}`} />
      <QuoteRow label="Price impact" value={quote.priceImpactBps === null ? "—" : `${(quote.priceImpactBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} />
      <QuoteRow label="Expiry" value={formatExpiry(quote.expiresAt)} warning={isExpired(quote.expiresAt)} />
      <Disclosure compact>
        <p>{DEVNET_SWAP_DISCLOSURE}</p>
        <p>Review the expected output and minimum output before your wallet signs.</p>
      </Disclosure>
    </Card>
  );
}

function AssetCard({ asset, configured }: { asset: DemoAsset; configured: boolean }) {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{asset.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{asset.description ?? "Devnet-only RWA demonstration asset."}</p>
        </div>
        <Badge variant={configured && asset.tradeEnabled ? "secondary" : "outline"}>{asset.symbol}</Badge>
      </div>
      <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs">
        <QuoteRow label="Network" value={asset.network || "unknown"} />
        <QuoteRow label="Pool" value={asset.poolAddress ? shortenAddress(asset.poolAddress) : "Not configured"} />
        <QuoteRow label="Route" value="Direct Meteora DLMM Devnet" />
      </div>
      <div className="flex flex-wrap gap-2">
        {asset.explorerUrl ? <ExplorerLink href={asset.explorerUrl} label="RWA mint" /> : null}
        {asset.quoteMintExplorerUrl ? <ExplorerLink href={asset.quoteMintExplorerUrl} label="QUOTE mint" /> : null}
        {asset.poolExplorerUrl ? <ExplorerLink href={asset.poolExplorerUrl} label="Pool" /> : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{asset.rightsDisclosure}</p>
    </Card>
  );
}

function QuoteRow({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={warning ? "text-right font-medium text-destructive" : "text-right font-medium"}>{value}</span>
    </div>
  );
}

function Disclosure({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={`space-y-1 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-amber-950 dark:text-amber-100 ${compact ? "" : ""}`}>{children}</div>;
}

function GuardAlert({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function LoadingLine({ label }: { label: string }) {
  return <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{label}</p>;
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="items-center gap-3 rounded-2xl p-5 text-center">
      <AlertTriangle className="size-5 text-muted-foreground" />
      <div>
        <p className="font-medium">RWA-DEMO is not available</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">The Devnet demo asset has not been configured yet.</p>
      </div>
      <Button variant="outline" onClick={onRetry}><RefreshCw />Retry</Button>
    </Card>
  );
}

function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline underline-offset-4">
      <ExternalLink className="size-3" />{label}
    </a>
  );
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new DemoApiError(readApiError(payload, `Request failed (${response.status}).`), response.status);
  return payload;
}

function normalizeAsset(value: unknown): DemoAsset | null {
  const source = asRecord(value);
  const id = readString(source?.id);
  const name = readString(source?.name);
  const symbol = readString(source?.symbol) ?? readString(source?.ticker);
  const network = readString(source?.network);
  const decimals = readInteger(source?.decimals);
  const quoteDecimals = readInteger(source?.quoteDecimals);
  const rightsDisclosure = readString(source?.rightsDisclosure);
  if (!id || !name || !symbol || !network || decimals === null || quoteDecimals === null || !rightsDisclosure) return null;
  return {
    id,
    name,
    symbol,
    description: readString(source?.description),
    network,
    mintAddress: readString(source?.mintAddress),
    quoteMintAddress: readString(source?.quoteMintAddress),
    poolAddress: readString(source?.poolAddress),
    decimals,
    quoteDecimals,
    tradeEnabled: source?.tradeEnabled === true,
    rightsDisclosure,
    explorerUrl: readString(source?.explorerUrl),
    quoteMintExplorerUrl: readString(source?.quoteMintExplorerUrl),
    poolExplorerUrl: readString(source?.poolExplorerUrl),
  };
}

function normalizeFunding(value: unknown): Funding | null {
  const source = asRecord(value);
  const id = readString(source?.id);
  const status = readString(source?.status);
  const requestedKztAmount = readString(source?.requestedKztAmount);
  const quoteTokenAmountAtomic = readAtomic(source?.quoteTokenAmountAtomic);
  if (!id || !status || !requestedKztAmount || !quoteTokenAmountAtomic) return null;
  return {
    id,
    status,
    requestedKztAmount,
    demoRate: readString(source?.demoRate),
    quoteTokenAmountAtomic,
    mintSignature: readString(source?.mintSignature),
    mintExplorerUrl: readString(source?.mintExplorerUrl),
    disclosure: readString(source?.disclosure) ?? SIMULATED_FUNDING_DISCLOSURE,
  };
}

function normalizeQuote(value: unknown): DemoQuote | null {
  const source = asRecord(value);
  const id = readString(source?.id);
  const rawSide = readString(source?.side);
  const side = rawSide === "BUY" || rawSide === "SELL" ? rawSide : null;
  const inputAmountAtomic = readAtomic(source?.inputAmountAtomic);
  const expectedOutputAtomic = readAtomic(source?.expectedOutputAtomic);
  const minimumOutputAtomic = readAtomic(source?.minimumOutputAtomic);
  const route = readString(source?.route);
  const network = readString(source?.network);
  if (!id || !side || !inputAmountAtomic || !expectedOutputAtomic || !minimumOutputAtomic || !route || !network) return null;
  return {
    id,
    side,
    inputAmountAtomic,
    expectedOutputAtomic,
    minimumOutputAtomic,
    slippageBps: readNumber(source?.slippageBps),
    feeAmountAtomic: readAtomic(source?.feeAmountAtomic),
    priceImpactBps: readNumber(source?.priceImpactBps),
    expiresAt: readDateValue(source?.expiresAt),
    route,
    network,
    poolAddress: readString(source?.poolAddress),
  };
}

function normalizeOrder(value: unknown): DemoOrder | null {
  const source = asRecord(value);
  const id = readString(source?.id);
  const status = readString(source?.status);
  if (!id || !status) return null;
  return {
    id,
    status,
    signature: readString(source?.signature),
    explorerUrl: readString(source?.explorerUrl),
    actualInputAmountAtomic: readAtomic(source?.actualInputAmountAtomic),
    actualOutputAmountAtomic: readAtomic(source?.actualOutputAmountAtomic),
  };
}

function normalizePayout(value: unknown): Payout | null {
  const source = asRecord(value);
  const id = readString(source?.id);
  const status = readString(source?.status);
  if (!id || !status) return null;
  return {
    id,
    status,
    quoteTokenAmountAtomic: readAtomic(source?.quoteTokenAmountAtomic),
    simulatedKztAmount: readString(source?.simulatedKztAmount),
    disclosure: readString(source?.disclosure) ?? SIMULATED_PAYOUT_DISCLOSURE,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readAtomic(value: unknown): string | null {
  const string = readString(value);
  return string && /^\d+$/.test(string) ? string : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 18 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDateValue(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function readApiError(payload: unknown, fallback: string) {
  const record = asRecord(payload);
  return readString(record?.error) ?? readString(record?.message) ?? fallback;
}

function userFacingError(error: unknown, fallback: string) {
  if (error instanceof DemoApiError) return error.message;
  if (isLikelyUserRejection(error)) return "Wallet signature was rejected. No transaction was sent.";
  return error instanceof Error && error.message ? error.message : fallback;
}

function isLikelyUserRejection(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /reject|declin|cancel|denied|abort/i.test(message);
}

function isFailureStatus(status: string) {
  return ["QUOTE_EXPIRED", "USER_REJECTED", "TRANSACTION_FAILED", "CONFIRMATION_TIMEOUT", "NEEDS_REVIEW", "FAILED"].includes(status);
}

function isCompletedStatus(status: string) {
  // A server-confirmed receipt is the only state that can unlock the
  // simulated payout. ONCHAIN_CONFIRMED remains an internal intermediate
  // state until persistence completes.
  return status === "COMPLETED";
}

function isPositiveAtomic(value: string | null) {
  return Boolean(value && /^\d+$/.test(value) && BigInt(value) > BigInt(0));
}

function parseKztInput(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function sanitizeDecimalInput(value: string) {
  const normalized = value.replace(",", ".").replace(/[^0-9.]/g, "");
  const [whole = "", ...fractionParts] = normalized.split(".");
  return fractionParts.length ? `${whole}.${fractionParts.join("")}` : whole;
}

function decimalToAtomic(value: string, decimals: number): string | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;
  const raw = `${whole.replace(/^0+(?=\d)/, "") || "0"}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "") || "0";
  return raw;
}

function formatAtomic(value: string, decimals: number) {
  if (!/^\d+$/.test(value)) return "—";
  if (decimals === 0) return groupDigits(value);
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${groupDigits(whole)}.${fraction}` : groupDigits(whole);
}

function groupDigits(value: string) {
  const normalized = value.replace(/^0+(?=\d)/, "") || "0";
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function toDate(value: string | number | null) {
  if (value === null) return null;
  const timestamp = typeof value === "number"
    ? (value < 1_000_000_000_000 ? value * 1_000 : value)
    : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function isExpired(value: string | number | null) {
  const date = toDate(value);
  return date ? date.getTime() <= Date.now() : false;
}

function formatExpiry(value: string | number | null) {
  const date = toDate(value);
  if (!date) return "Not provided";
  if (date.getTime() <= Date.now()) return "Expired — refresh quote";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function shortenAddress(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function explorerForSignature(signature: string | null) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined;
}
