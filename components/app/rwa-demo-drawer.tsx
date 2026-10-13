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

/** A small self-contained entry point for the Devnet asset screen or catalog. */
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
              <p className="font-semibold">RWA · Solana Devnet</p>
              <Badge variant="secondary">SOLANA DEVNET</Badge>
              <Badge variant="outline">NO MONETARY VALUE</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">A digital share in a Solana Devnet portfolio. Start with a small amount of the test settlement token.</p>
          </div>
          <ShieldCheck className="mt-0.5 size-5 text-muted-foreground" />
        </div>
        <Button className="w-full" onClick={() => setOpen(true)}>Buy a share</Button>
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
  quoteSymbol: string;
  externalQuoteMint: boolean;
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
  simulatedRate: string | null;
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

const SIMULATED_FUNDING_DISCLOSURE = "DEVNET TEST FUNDING · no fiat payment is made";
const SIMULATED_PAYOUT_DISCLOSURE = "DEVNET TEST PAYOUT · no bank transfer is created";
const DEVNET_TOKEN_DISCLOSURE = "SOLANA DEVNET · NO MONETARY VALUE · test funds are used, with no rights to a real asset.";
const DEVNET_SWAP_DISCLOSURE = "Solana Devnet operation · no real funds or asset rights";

function displayDevnetSymbol(symbol: string) {
  return symbol.endsWith("-DEMO") ? symbol.slice(0, -"-DEMO".length) : symbol;
}

function displayRwaAssetName(asset: Pick<DemoAsset, "id" | "name">) {
  return asset.id === "rwa-devnet" || asset.id === "rwa-demo" ? "RWA · Solana Devnet" : asset.name;
}

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
  const [buyInput, setBuyInput] = useState("1");
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
  const externalQuoteMint = asset?.externalQuoteMint === true;
  const quoteSymbol = displayDevnetSymbol(asset?.quoteSymbol ?? "QUOTE-DEMO");
  const demoReady = Boolean(asset && configured && isDevnet && asset.tradeEnabled && wallet && walletAddress && !walletMismatch);
  const buyInputAtomic = useMemo(
    () => asset ? decimalToAtomic(buyInput, asset.quoteDecimals) : null,
    [asset, buyInput],
  );
  const sellInputAtomic = useMemo(
    () => asset ? decimalToAtomic(sellInput, asset.decimals) : null,
    [asset, sellInput],
  );
  const isFundingIssued = funding?.status === "TEST_TOKEN_ISSUED";
  const canRequestBuyQuote = externalQuoteMint
    ? isPositiveAtomic(buyInputAtomic)
    : isFundingIssued;
  const quoteInputAtomic = side === "BUY"
    ? externalQuoteMint ? buyInputAtomic : funding?.quoteTokenAmountAtomic ?? null
    : sellInputAtomic;
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
    setBuyInput("1");
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
        : assets.find((item) => item.id === "rwa-devnet" || item.id === "rwa-demo") ?? assets[0];
      if (!selected) {
        throw new DemoApiError("The Solana Devnet asset isn't available yet.", 503);
      }
      if (assetId && selected.id !== assetId) {
        throw new DemoApiError("This asset is currently unavailable.", 404);
      }
      setAsset(selected);
      setConfigured(response?.configured === true);
      setAssetsDisclosure(readString(response?.disclosure));
    } catch (requestError) {
      setAsset(null);
      setConfigured(false);
      setError({ message: userFacingError(requestError, "Couldn't load asset data."), retryStage: "assets" });
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
    if (!demoReady || busy || !walletAddress || funding || externalQuoteMint) return;
    const requestedKztAmount = parseKztInput(kztInput);
    if (requestedKztAmount === null) {
      setError({ message: "Enter a valid amount for the test top-up.", retryStage: null });
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
      if (!nextFunding) throw new DemoApiError("Couldn't prepare the test top-up.", 502);
      setFunding(nextFunding);
      clearTrade();
      setNotice(nextFunding.status === "TEST_TOKEN_ISSUED"
        ? `${quoteSymbol} credited. You can now review the purchase terms.`
        : `The top-up was recorded, but ${quoteSymbol} has not been credited yet.`);
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Couldn't prepare the top-up."), retryStage: "funding" });
    } finally {
      setBusy(null);
    }
  };

  const requestQuote = async () => {
    if (!demoReady || busy || !asset || !walletAddress) return;
    if (side === "BUY" && !externalQuoteMint && !isFundingIssued) {
      setError({ message: `First prepare ${quoteSymbol} for the purchase.`, retryStage: null });
      return;
    }
    if (!quoteInputAtomic || !isPositiveAtomic(quoteInputAtomic)) {
      setError({
        message: side === "BUY"
          ? externalQuoteMint
            ? `Enter a valid amount in ${quoteSymbol}.`
            : `No ${quoteSymbol} available to buy with yet.`
          : "Enter a valid number of shares to sell.",
        retryStage: null,
      });
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
      if (!nextQuote) throw new DemoApiError("Couldn't calculate the terms. Please try again.", 502);
      if (nextQuote.network.toLowerCase() !== "devnet" || nextQuote.route !== "meteora-dlmm-devnet") {
        throw new DemoApiError("The operation is temporarily unavailable. Refresh the terms and try again.", 409);
      }
      setQuote(nextQuote);
      setOrder(null);
      setPendingSignature(null);
      setCompletedOrder(null);
      setPayout(null);
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Couldn't calculate the purchase terms."), retryStage: "quote" });
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
      if (!nextOrder) throw new DemoApiError("Couldn't verify the operation result.", 502);
      setOrder(nextOrder);
      if (isCompletedStatus(nextOrder.status)) {
        setCompletedOrder(nextOrder);
        setNotice("Operation confirmed. Updating your portfolio balance.");
        void devnet.refreshPortfolio();
        onTradeConfirmed?.();
      } else if (isFailureStatus(nextOrder.status)) {
        throw new DemoApiError("The operation was not completed. Try recalculating the terms.", 409);
      } else {
        setNotice("Operation submitted. Checking for confirmation.");
      }
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Couldn't verify the result yet. Please try again."), retryStage: "confirm" });
    } finally {
      setBusy(null);
    }
  }, [devnet, onTradeConfirmed]);

  const signAndSubmit = async () => {
    if (!demoReady || !asset || !quote || !wallet || !walletAddress || busy) return;
    if (quoteExpired) {
      setError({ message: "The terms are out of date. Recalculate them before confirming.", retryStage: "quote" });
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
        if (!currentOrder) throw new DemoApiError("Couldn't prepare the operation.", 502);
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
        throw new DemoApiError("Couldn't prepare the operation confirmation.", 502);
      }
      if (isFailureStatus(transactionOrder.status)) {
        throw new DemoApiError("This operation can no longer be confirmed. Recalculate the terms.", 409);
      }
      setOrder(transactionOrder);

      setBusy("signing");
      const result = await SolanaWallet.from(wallet).sendTransaction({ serializedTransaction });
      if (!result.hash) throw new DemoApiError("The wallet did not confirm the operation.", 502);
      submittedSignature = result.hash;
      setPendingSignature(result.hash);
      setOrder((current) => current ? { ...current, signature: result.hash } : current);
      await confirmExistingOrder(transactionOrder.id, result.hash);
    } catch (requestError) {
      setBusy(null);
      const message = userFacingError(requestError, "Couldn't prepare or confirm the operation.");
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
      if (!nextPayout) throw new DemoApiError("Couldn't prepare the Devnet payout record.", 502);
      setPayout(nextPayout);
      setNotice(nextPayout.status === "SIMULATED_CONFIRMED"
        ? "The Devnet payout record is ready. No bank transfer was sent."
        : "The Devnet payout record was created. No bank transfer was sent.");
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Couldn't prepare the payout record."), retryStage: "payout" });
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
  const successfulExternalSell = completedOrder && side === "SELL" && externalQuoteMint;
  const successfulPayout = payout?.status === "SIMULATED_CONFIRMED";

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="RWA · Solana Devnet"
      description="SOLANA DEVNET · the test settlement token and shares have no monetary value."
    >
      {successfulBuy ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`+ ${formatAtomic(completedOrder.actualOutputAmountAtomic ?? quote?.expectedOutputAtomic ?? "0", asset?.decimals ?? 0)} ${displayDevnetSymbol(asset?.symbol ?? "RWA-DEMO")}`}
          sentence="Devnet share purchase confirmed."
          note={DEVNET_SWAP_DISCLOSURE}
          explorerUrl={completedOrder.explorerUrl ?? explorerForSignature(completedOrder.signature)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Open portfolio"
        />
      ) : successfulExternalSell ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`+ ${formatAtomic(completedOrder.actualOutputAmountAtomic ?? quote?.expectedOutputAtomic ?? "0", asset?.quoteDecimals ?? 0)} ${quoteSymbol}`}
          sentence={`Test ${quoteSymbol} from the sale arrived in your wallet.`}
          note="This is a Solana Devnet operation; no bank payout is created."
          explorerUrl={completedOrder.explorerUrl ?? explorerForSignature(completedOrder.signature)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Open portfolio"
        />
      ) : successfulPayout ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`${payout.simulatedKztAmount ?? "0"} ₸`}
          sentence="A Devnet payout record was created after the sale."
          note={SIMULATED_PAYOUT_DISCLOSURE}
          explorerUrl={completedOrder?.explorerUrl ?? explorerForSignature(completedOrder?.signature ?? null)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Open portfolio"
        />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">SOLANA DEVNET</Badge>
            <Badge variant="outline">DEVNET TEST UNITS</Badge>
            <Badge variant="outline">NO MONETARY VALUE</Badge>
          </div>

          {busy === "assets" ? <LoadingLine label="Preparing your Solana Devnet purchase…" /> : null}
          {!busy && !asset && !error ? <EmptyState onRetry={() => void loadAssets()} /> : null}

          {asset ? (
            <>
              <AssetCard asset={asset} configured={configured} disclosure={assetsDisclosure} />
              <p className="text-center text-xs leading-5 text-muted-foreground">{DEVNET_TOKEN_DISCLOSURE}</p>

              {!configured ? (
                <GuardAlert title="Solana Devnet is not available yet">
                  Setup isn&apos;t finished yet. Try refreshing the page in a minute.
                </GuardAlert>
              ) : null}
              {!isDevnet ? (
                <GuardAlert title="Wrong test network">
                  This operation requires Solana Devnet. It won&apos;t be prepared until the correct network is selected.
                </GuardAlert>
              ) : null}
              {!asset.tradeEnabled ? (
                <GuardAlert title="Buying is temporarily unavailable">
                  Test liquidity is currently unavailable. Please try again shortly.
                </GuardAlert>
              ) : null}
              {!wallet ? (
                <GuardAlert title="Sign-in required">
                  Sign in so the app can save the Devnet operation result to your wallet.
                </GuardAlert>
              ) : null}
              {walletMismatch ? (
                <GuardAlert title="Wallet needs refreshing">
                  Close and reopen the app — the current wallet does not match the Devnet portfolio.
                </GuardAlert>
              ) : null}

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Operation direction">
                <Button
                  type="button"
                  variant={side === "BUY" ? "secondary" : "outline"}
                  onClick={() => selectSide("BUY")}
                  disabled={Boolean(busy)}
                >
                  Buy a share
                </Button>
                <Button
                  type="button"
                  variant={side === "SELL" ? "secondary" : "outline"}
                  onClick={() => selectSide("SELL")}
                  disabled={Boolean(busy)}
                >
                  Sell a share
                </Button>
              </div>

              {side === "BUY" ? (
                externalQuoteMint ? (
                  <ExternalQuotePanel
                    value={buyInput}
                    symbol={quoteSymbol}
                    disabled={!demoReady || Boolean(busy)}
                    onValueChange={(value) => {
                      setBuyInput(value);
                      clearTrade();
                      setError(null);
                    }}
                  />
                ) : (
                  <FundingPanel
                    value={kztInput}
                    disabled={!demoReady || Boolean(busy)}
                    funding={funding}
                    quoteDecimals={asset.quoteDecimals}
                    quoteSymbol={quoteSymbol}
                    onValueChange={(value) => {
                      setKztInput(value);
                      setFunding(null);
                      setFundingRequestId(null);
                      clearTrade();
                      setError(null);
                    }}
                    onFunding={() => void createFunding()}
                  />
                )
              ) : (
                <SellPanel
                  value={sellInput}
                  symbol={displayDevnetSymbol(asset.symbol)}
                  disabled={!demoReady || Boolean(busy)}
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
                  <RefreshCw />Recalculate amount
                </Button>
              ) : null}

              {notice ? (
                <Alert>
                  <ShieldCheck />
                  <AlertTitle>Operation status</AlertTitle>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Action needed</AlertTitle>
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

              {side === "BUY" && !externalQuoteMint && funding && !isFundingIssued ? (
                <GuardAlert title={`${quoteSymbol} not credited yet`}>
                  The top-up is prepared, but the funds aren&apos;t available for purchase yet. Try refreshing the status shortly.
                </GuardAlert>
              ) : null}

              {!completedOrder ? (
                quote ? (
                  <Button
                    className="w-full"
                    onClick={() => void signAndSubmit()}
                    disabled={!demoReady || quoteExpired || Boolean(busy)}
                  >
                    {busy === "building" ? <><LoaderCircle className="animate-spin" />Preparing confirmation…</> : null}
                    {busy === "signing" ? <><LoaderCircle className="animate-spin" />Confirm {side === "BUY" ? "purchase" : "sale"} in your wallet…</> : null}
                    {busy === "confirming" ? <><LoaderCircle className="animate-spin" />Checking the result…</> : null}
                    {!busy && pendingSignature ? <><RefreshCw />Check result</> : null}
                    {!busy && !pendingSignature ? <><ArrowDownUp />Confirm {side === "BUY" ? "purchase" : "sale"}</> : null}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => void requestQuote()}
                    disabled={!demoReady || Boolean(busy) || (side === "BUY" && !canRequestBuyQuote) || (side === "SELL" && !isPositiveAtomic(sellInputAtomic))}
                  >
                    {busy === "quoting" ? <><LoaderCircle className="animate-spin" />Calculating terms…</> : <><RefreshCw />Review terms {side === "BUY" ? "purchase" : "sale"}</>}
                  </Button>
                )
              ) : null}

              {completedOrder && side === "SELL" ? (
                <Card className="gap-3 rounded-2xl p-4">
                  <div>
                    <p className="font-medium">Sale confirmed</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">You can create a Devnet payout record. No bank transfer will be sent.</p>
                  </div>
                  <Button className="w-full" onClick={() => void createPayout()} disabled={Boolean(busy)}>
                    {busy === "payout" ? <><LoaderCircle className="animate-spin" />Preparing the payout record…</> : "Create payout record"}
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
  quoteSymbol,
  onValueChange,
  onFunding,
}: {
  value: string;
  disabled: boolean;
  funding: Funding | null;
  quoteDecimals: number;
  quoteSymbol: string;
  onValueChange: (value: string) => void;
  onFunding: () => void;
}) {
  return (
    <Card className="gap-4 rounded-2xl p-4">
      <div className="space-y-1">
        <p className="font-medium">Top-up amount</p>
        <p className="text-xs leading-5 text-muted-foreground">Enter an amount for the Solana Devnet test balance.</p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Amount</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(event.target.value.replace(/[^0-9]/g, ""))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label="Test top-up amount"
          />
          <span className="text-sm font-medium">₸</span>
        </div>
      </label>
      <Button className="w-full" variant="outline" onClick={onFunding} disabled={disabled || Boolean(funding) || parseKztInput(value) === null}>
        Top up test balance
      </Button>
      {funding ? (
        <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs leading-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Status</span>
            <Badge variant={funding.status === "TEST_TOKEN_ISSUED" ? "secondary" : "outline"}>{funding.status === "TEST_TOKEN_ISSUED" ? "Done" : "Processing"}</Badge>
          </div>
          <p>Available: {formatAtomic(funding.quoteTokenAmountAtomic, quoteDecimals)} {quoteSymbol}</p>
          <details className="rounded-lg bg-background/60 px-2.5 py-2 text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Details</summary>
            <div className="space-y-2 pt-2">
              <p>{funding.disclosure || SIMULATED_FUNDING_DISCLOSURE}.</p>
              {funding.simulatedRate ? <p>Configured Devnet rate: {funding.simulatedRate} KZT per {quoteSymbol}.</p> : null}
              {funding.mintExplorerUrl ? <ExplorerLink href={funding.mintExplorerUrl} label="Show technical details" /> : null}
            </div>
          </details>
        </div>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">{SIMULATED_FUNDING_DISCLOSURE}.</p>
    </Card>
  );
}

function ExternalQuotePanel({
  value,
  symbol,
  disabled,
  onValueChange,
}: {
  value: string;
  symbol: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <Card className="gap-4 rounded-2xl p-4">
      <div className="space-y-1">
        <p className="font-medium">Purchase amount</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Choose how much {symbol} to use to buy a share.
        </p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">To pay</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(sanitizeDecimalInput(event.target.value))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label={`Amount in ${symbol}`}
          />
          <span className="text-sm font-medium">{symbol}</span>
        </div>
      </label>
      <p className="text-xs text-muted-foreground">Start with a small amount — we&apos;ll show the exact result before you confirm.</p>
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">What do you need to buy?</summary>
        <p className="pt-2">
          Your wallet needs test {symbol} and a small amount of test SOL for network fees. Only test funds are used here.
        </p>
      </details>
    </Card>
  );
}

function SellPanel({
  value,
  symbol,
  disabled,
  onValueChange,
}: {
  value: string;
  symbol: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <Card className="gap-4 rounded-2xl p-4">
      <div className="space-y-1">
        <p className="font-medium">Sale amount</p>
        <p className="text-xs leading-5 text-muted-foreground">Enter the number of shares you want to sell.</p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Number of shares</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(sanitizeDecimalInput(event.target.value))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label="Shares to sell"
          />
          <span className="text-sm font-medium">{symbol}</span>
        </div>
      </label>
      <p className="text-xs text-muted-foreground">The sale terms will appear before confirmation.</p>
    </Card>
  );
}

function QuoteCard({ quote, asset }: { quote: DemoQuote; asset: DemoAsset }) {
  const inputSymbol = displayDevnetSymbol(quote.side === "BUY" ? asset.quoteSymbol : asset.symbol);
  const outputSymbol = displayDevnetSymbol(quote.side === "BUY" ? asset.symbol : asset.quoteSymbol);
  const inputDecimals = quote.side === "BUY" ? asset.quoteDecimals : asset.decimals;
  const outputDecimals = quote.side === "BUY" ? asset.decimals : asset.quoteDecimals;
  const priceImpactPercent = quote.priceImpactBps === null ? null : quote.priceImpactBps / 100;
  const action = quote.side === "BUY" ? "Purchase" : "Sale";
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Review the terms</p>
          <p className="mt-1 text-xs text-muted-foreground">The amount is locked briefly before confirmation.</p>
        </div>
        <Badge variant="outline">{action}</Badge>
      </div>
      <QuoteRow label="To pay" value={`${formatAtomic(quote.inputAmountAtomic, inputDecimals)} ${inputSymbol}`} />
      <QuoteRow label="You'll receive" value={`${formatAtomic(quote.expectedOutputAtomic, outputDecimals)} ${outputSymbol}`} />
      <QuoteRow label="At least" value={`${formatAtomic(quote.minimumOutputAtomic, outputDecimals)} ${outputSymbol}`} />
      {priceImpactPercent !== null && priceImpactPercent >= 2 ? (
        <Disclosure>
          <p className="font-medium">This amount noticeably affects the price in the Devnet pool.</p>
          <p>The result may be lower than usual. Consider a smaller amount before confirming.</p>
        </Disclosure>
      ) : null}
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Calculation and technical details</summary>
        <div className="space-y-2 pt-3">
          <QuoteRow label="Allowed slippage" value={quote.slippageBps === null ? "—" : `${(quote.slippageBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} />
          <QuoteRow label="Pool fee" value={quote.feeAmountAtomic === null ? "—" : `${formatAtomic(quote.feeAmountAtomic, inputDecimals)} ${inputSymbol}`} />
          <QuoteRow label="Price impact" value={priceImpactPercent === null ? "—" : `${priceImpactPercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} />
          <QuoteRow label="Valid until" value={formatExpiry(quote.expiresAt)} warning={isExpired(quote.expiresAt)} />
          <QuoteRow label="Route" value={quote.route} />
          <p className="pt-1">{DEVNET_SWAP_DISCLOSURE}</p>
        </div>
      </details>
    </Card>
  );
}

function AssetCard({
  asset,
  configured,
  disclosure,
}: {
  asset: DemoAsset;
  configured: boolean;
  disclosure: string | null;
}) {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{displayRwaAssetName(asset)}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">A digital share in a Solana Devnet portfolio.</p>
        </div>
        <Badge variant={configured && asset.tradeEnabled ? "secondary" : "outline"}>{configured && asset.tradeEnabled ? "Available" : "Unavailable"}</Badge>
      </div>
      <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs">
        <QuoteRow label="Settlement currency" value={displayDevnetSymbol(asset.quoteSymbol)} />
        <QuoteRow label="Status" value={configured && asset.tradeEnabled ? "Open for purchase on Solana Devnet" : "Temporarily unavailable"} />
      </div>
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Technical details</summary>
        <div className="space-y-2 pt-3">
          <QuoteRow label="Network" value={asset.network || "—"} />
          <QuoteRow label="Settlement token" value={displayDevnetSymbol(asset.quoteSymbol)} />
          <QuoteRow label="Pool" value={asset.poolAddress ? shortenAddress(asset.poolAddress) : "Not configured"} />
          <QuoteRow label="Route" value="Direct Meteora DLMM Devnet" />
          <div className="flex flex-wrap gap-2 pt-1">
            {asset.explorerUrl ? <ExplorerLink href={asset.explorerUrl} label="RWA token" /> : null}
            {asset.quoteMintExplorerUrl ? <ExplorerLink href={asset.quoteMintExplorerUrl} label={`Token ${displayDevnetSymbol(asset.quoteSymbol)}`} /> : null}
            {asset.poolExplorerUrl ? <ExplorerLink href={asset.poolExplorerUrl} label="Pool" /> : null}
          </div>
          <p className="pt-1">{disclosure ?? asset.rightsDisclosure}</p>
        </div>
      </details>
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
        <p className="font-medium">RWA on Solana Devnet isn&apos;t available yet</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Try refreshing the data in a minute.</p>
      </div>
      <Button variant="outline" onClick={onRetry}><RefreshCw />Refresh</Button>
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
    quoteSymbol: readString(source?.quoteSymbol) ?? "QUOTE-DEMO",
    externalQuoteMint: source?.externalQuoteMint === true,
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
    simulatedRate: readString(source?.simulatedRate),
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
  if (isLikelyUserRejection(error)) return "Wallet confirmation was cancelled. The operation was not submitted.";
  if (error instanceof DemoApiError) {
    if (/insufficient|not enough|balance/i.test(error.message)) {
      return "Not enough funds in the wallet for this operation.";
    }
    if (/expired|quote/i.test(error.message)) {
      return "The terms are out of date. Recalculate them and try again.";
    }
    return error.message;
  }
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
  if (!date) return "Not specified";
  if (date.getTime() <= Date.now()) return "Expired — recalculate the terms";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function shortenAddress(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function explorerForSignature(signature: string | null) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined;
}
