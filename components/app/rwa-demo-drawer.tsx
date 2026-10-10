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
              <p className="font-semibold">RWA · Solana Devnet</p>
              <Badge variant="secondary">SOLANA DEVNET</Badge>
              <Badge variant="outline">NO MONETARY VALUE</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Цифровая доля в портфеле Solana Devnet. Начните с небольшой суммы тестового токена расчёта.</p>
          </div>
          <ShieldCheck className="mt-0.5 size-5 text-muted-foreground" />
        </div>
        <Button className="w-full" onClick={() => setOpen(true)}>Купить долю</Button>
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

const SIMULATED_FUNDING_DISCLOSURE = "SIMULATED FUNDING · тестовое пополнение, реальный платёж не проводится";
const SIMULATED_PAYOUT_DISCLOSURE = "SIMULATED PAYOUT · банковский перевод не создаётся";
const DEVNET_TOKEN_DISCLOSURE = "SOLANA DEVNET · NO MONETARY VALUE · используются тестовые средства, без прав на реальный актив.";
const DEVNET_SWAP_DISCLOSURE = "Операция Solana Devnet · без реальных средств и прав на актив";

function displayDevnetSymbol(symbol: string) {
  return symbol.endsWith("-DEMO") ? symbol.slice(0, -"-DEMO".length) : symbol;
}

function displayRwaAssetName(asset: Pick<DemoAsset, "id" | "name">) {
  return asset.id === "rwa-demo" ? "RWA · Solana Devnet" : asset.name;
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
        : assets.find((item) => item.id === "rwa-demo") ?? assets[0];
      if (!selected) {
        throw new DemoApiError("Актив Solana Devnet пока недоступен.", 503);
      }
      if (assetId && selected.id !== assetId) {
        throw new DemoApiError("Этот актив сейчас недоступен.", 404);
      }
      setAsset(selected);
      setConfigured(response?.configured === true);
      setAssetsDisclosure(readString(response?.disclosure));
    } catch (requestError) {
      setAsset(null);
      setConfigured(false);
      setError({ message: userFacingError(requestError, "Не удалось загрузить данные актива."), retryStage: "assets" });
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
      setError({ message: "Укажите корректную сумму для тестового пополнения.", retryStage: null });
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
      if (!nextFunding) throw new DemoApiError("Не удалось подготовить тестовое пополнение.", 502);
      setFunding(nextFunding);
      clearTrade();
      setNotice(nextFunding.status === "TEST_TOKEN_ISSUED"
        ? `${quoteSymbol} зачислены. Теперь можно посмотреть условия покупки.`
        : `Пополнение записано, но ${quoteSymbol} ещё не зачислены.`);
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Не удалось подготовить пополнение."), retryStage: "funding" });
    } finally {
      setBusy(null);
    }
  };

  const requestQuote = async () => {
    if (!demoReady || busy || !asset || !walletAddress) return;
    if (side === "BUY" && !externalQuoteMint && !isFundingIssued) {
      setError({ message: `Сначала подготовьте ${quoteSymbol} для покупки.`, retryStage: null });
      return;
    }
    if (!quoteInputAtomic || !isPositiveAtomic(quoteInputAtomic)) {
      setError({
        message: side === "BUY"
          ? externalQuoteMint
            ? `Укажите корректную сумму в ${quoteSymbol}.`
            : `Для покупки пока нет доступных ${quoteSymbol}.`
          : "Укажите корректное количество долей для продажи.",
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
      if (!nextQuote) throw new DemoApiError("Не удалось рассчитать условия. Попробуйте ещё раз.", 502);
      if (nextQuote.network.toLowerCase() !== "devnet" || nextQuote.route !== "meteora-dlmm-devnet") {
        throw new DemoApiError("Операция временно недоступна. Обновите условия и попробуйте снова.", 409);
      }
      setQuote(nextQuote);
      setOrder(null);
      setPendingSignature(null);
      setCompletedOrder(null);
      setPayout(null);
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Не удалось рассчитать условия покупки."), retryStage: "quote" });
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
      if (!nextOrder) throw new DemoApiError("Не удалось проверить результат операции.", 502);
      setOrder(nextOrder);
      if (isCompletedStatus(nextOrder.status)) {
        setCompletedOrder(nextOrder);
        setNotice("Операция подтверждена. Обновляем баланс портфеля.");
        void devnet.refreshPortfolio();
        onTradeConfirmed?.();
      } else if (isFailureStatus(nextOrder.status)) {
        throw new DemoApiError("Операция не была завершена. Попробуйте рассчитать условия ещё раз.", 409);
      } else {
        setNotice("Операция отправлена. Проверяем подтверждение.");
      }
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Пока не удалось проверить результат. Попробуйте ещё раз."), retryStage: "confirm" });
    } finally {
      setBusy(null);
    }
  }, [devnet, onTradeConfirmed]);

  const signAndSubmit = async () => {
    if (!demoReady || !asset || !quote || !wallet || !walletAddress || busy) return;
    if (quoteExpired) {
      setError({ message: "Условия устарели. Пересчитайте их перед подтверждением.", retryStage: "quote" });
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
        if (!currentOrder) throw new DemoApiError("Не удалось подготовить операцию.", 502);
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
        throw new DemoApiError("Не удалось подготовить подтверждение операции.", 502);
      }
      if (isFailureStatus(transactionOrder.status)) {
        throw new DemoApiError("Эту операцию уже нельзя подтвердить. Пересчитайте условия.", 409);
      }
      setOrder(transactionOrder);

      setBusy("signing");
      const result = await SolanaWallet.from(wallet).sendTransaction({ serializedTransaction });
      if (!result.hash) throw new DemoApiError("Кошелёк не подтвердил операцию.", 502);
      submittedSignature = result.hash;
      setPendingSignature(result.hash);
      setOrder((current) => current ? { ...current, signature: result.hash } : current);
      await confirmExistingOrder(transactionOrder.id, result.hash);
    } catch (requestError) {
      setBusy(null);
      const message = userFacingError(requestError, "Не удалось подготовить или подтвердить операцию.");
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
      if (!nextPayout) throw new DemoApiError("Не удалось подготовить запись о симулируемой выплате.", 502);
      setPayout(nextPayout);
      setNotice(nextPayout.status === "SIMULATED_CONFIRMED"
        ? "Запись о симулируемой выплате готова. Банковский перевод не отправлялся."
        : "Запись о симулируемой выплате создана. Банковский перевод не отправлялся.");
    } catch (requestError) {
      setError({ message: userFacingError(requestError, "Не удалось подготовить запись о выплате."), retryStage: "payout" });
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
      description="SOLANA DEVNET · тестовый токен расчёта и доли не имеют денежной стоимости."
    >
      {successfulBuy ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`+ ${formatAtomic(completedOrder.actualOutputAmountAtomic ?? quote?.expectedOutputAtomic ?? "0", asset?.decimals ?? 0)} ${displayDevnetSymbol(asset?.symbol ?? "RWA-DEMO")}`}
          sentence="Покупка Devnet-доли подтверждена."
          note={DEVNET_SWAP_DISCLOSURE}
          explorerUrl={completedOrder.explorerUrl ?? explorerForSignature(completedOrder.signature)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Открыть портфель"
        />
      ) : successfulExternalSell ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`+ ${formatAtomic(completedOrder.actualOutputAmountAtomic ?? quote?.expectedOutputAtomic ?? "0", asset?.quoteDecimals ?? 0)} ${quoteSymbol}`}
          sentence={`Тестовые ${quoteSymbol} после продажи поступили в кошелёк.`}
          note="Это учебная операция — реальная выплата не создаётся."
          explorerUrl={completedOrder.explorerUrl ?? explorerForSignature(completedOrder.signature)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Открыть портфель"
        />
      ) : successfulPayout ? (
        <DrawerSuccess
          amount={0}
          amountLabel={`${payout.simulatedKztAmount ?? "0"} ₸`}
          sentence="После продажи создана запись о симулируемой выплате."
          note={SIMULATED_PAYOUT_DISCLOSURE}
          explorerUrl={completedOrder?.explorerUrl ?? explorerForSignature(completedOrder?.signature ?? null)}
          onDone={() => changeOpen(false)}
          secondaryHref="/portfolio"
          secondaryLabel="Открыть портфель"
        />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">SOLANA DEVNET</Badge>
            <Badge variant="outline">SIMULATED FUNDING</Badge>
            <Badge variant="outline">NO MONETARY VALUE</Badge>
          </div>

          {busy === "assets" ? <LoadingLine label="Готовим покупку в Solana Devnet…" /> : null}
          {!busy && !asset && !error ? <EmptyState onRetry={() => void loadAssets()} /> : null}

          {asset ? (
            <>
              <AssetCard asset={asset} configured={configured} disclosure={assetsDisclosure} />
              <p className="text-center text-xs leading-5 text-muted-foreground">{DEVNET_TOKEN_DISCLOSURE}</p>

              {!configured ? (
                <GuardAlert title="Solana Devnet пока недоступен">
                  Подготовка ещё не завершена. Попробуйте обновить страницу через минуту.
                </GuardAlert>
              ) : null}
              {!isDevnet ? (
                <GuardAlert title="Неподходящая тестовая сеть">
                  Для учебной покупки нужна тестовая сеть приложения. Операция не будет подготовлена, пока она не выбрана.
                </GuardAlert>
              ) : null}
              {!asset.tradeEnabled ? (
                <GuardAlert title="Покупка временно недоступна">
                  Тестовая ликвидность сейчас недоступна. Попробуйте чуть позже.
                </GuardAlert>
              ) : null}
              {!wallet ? (
                <GuardAlert title="Нужно войти в приложение">
                  Войдите, чтобы приложение могло сохранить результат учебной покупки в вашем кошельке.
                </GuardAlert>
              ) : null}
              {walletMismatch ? (
                <GuardAlert title="Кошелёк нужно обновить">
                  Закройте и снова откройте приложение — текущий кошелёк не совпадает с учебным портфелем.
                </GuardAlert>
              ) : null}

              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Направление операции">
                <Button
                  type="button"
                  variant={side === "BUY" ? "secondary" : "outline"}
                  onClick={() => selectSide("BUY")}
                  disabled={Boolean(busy)}
                >
                  Купить долю
                </Button>
                <Button
                  type="button"
                  variant={side === "SELL" ? "secondary" : "outline"}
                  onClick={() => selectSide("SELL")}
                  disabled={Boolean(busy)}
                >
                  Продать долю
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
                  <RefreshCw />Пересчитать сумму
                </Button>
              ) : null}

              {notice ? (
                <Alert>
                  <ShieldCheck />
                  <AlertTitle>Статус операции</AlertTitle>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}

              {error ? (
                <Alert variant="destructive">
                  <AlertTriangle />
                  <AlertTitle>Нужно действие</AlertTitle>
                  <AlertDescription>
                    <span>{error.message}</span>
                    {error.retryStage ? (
                      <Button className="mt-3" size="sm" variant="outline" onClick={retry} disabled={Boolean(busy)}>
                        <RefreshCw />Повторить
                      </Button>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ) : null}

              {side === "BUY" && !externalQuoteMint && funding && !isFundingIssued ? (
                <GuardAlert title={`${quoteSymbol} ещё не зачислены`}>
                  Пополнение подготовлено, но средства ещё не доступны для покупки. Попробуйте обновить статус чуть позже.
                </GuardAlert>
              ) : null}

              {!completedOrder ? (
                quote ? (
                  <Button
                    className="w-full"
                    onClick={() => void signAndSubmit()}
                    disabled={!demoReady || quoteExpired || Boolean(busy)}
                  >
                    {busy === "building" ? <><LoaderCircle className="animate-spin" />Готовим подтверждение…</> : null}
                    {busy === "signing" ? <><LoaderCircle className="animate-spin" />Подтвердите {side === "BUY" ? "покупку" : "продажу"} в кошельке…</> : null}
                    {busy === "confirming" ? <><LoaderCircle className="animate-spin" />Проверяем результат…</> : null}
                    {!busy && pendingSignature ? <><RefreshCw />Проверить результат</> : null}
                    {!busy && !pendingSignature ? <><ArrowDownUp />Подтвердить {side === "BUY" ? "покупку" : "продажу"}</> : null}
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => void requestQuote()}
                    disabled={!demoReady || Boolean(busy) || (side === "BUY" && !canRequestBuyQuote) || (side === "SELL" && !isPositiveAtomic(sellInputAtomic))}
                  >
                    {busy === "quoting" ? <><LoaderCircle className="animate-spin" />Считаем условия…</> : <><RefreshCw />Посмотреть условия {side === "BUY" ? "покупки" : "продажи"}</>}
                  </Button>
                )
              ) : null}

              {completedOrder && side === "SELL" ? (
                <Card className="gap-3 rounded-2xl p-4">
                  <div>
                    <p className="font-medium">Продажа подтверждена</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Можно создать запись о симулируемой выплате. Банковский перевод не будет отправлен.</p>
                  </div>
                  <Button className="w-full" onClick={() => void createPayout()} disabled={Boolean(busy)}>
                    {busy === "payout" ? <><LoaderCircle className="animate-spin" />Готовим запись о выплате…</> : "Создать запись о выплате"}
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
        <p className="font-medium">Сумма пополнения</p>
        <p className="text-xs leading-5 text-muted-foreground">Укажите сумму для тестового баланса Solana Devnet.</p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Сумма</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(event.target.value.replace(/[^0-9]/g, ""))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label="Сумма тестового пополнения"
          />
          <span className="text-sm font-medium">₸</span>
        </div>
      </label>
      <Button className="w-full" variant="outline" onClick={onFunding} disabled={disabled || Boolean(funding) || parseKztInput(value) === null}>
        Пополнить тестовый баланс
      </Button>
      {funding ? (
        <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs leading-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Статус</span>
            <Badge variant={funding.status === "TEST_TOKEN_ISSUED" ? "secondary" : "outline"}>{funding.status === "TEST_TOKEN_ISSUED" ? "Готово" : "В обработке"}</Badge>
          </div>
          <p>Доступно: {formatAtomic(funding.quoteTokenAmountAtomic, quoteDecimals)} {quoteSymbol}</p>
          <details className="rounded-lg bg-background/60 px-2.5 py-2 text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Подробнее</summary>
            <div className="space-y-2 pt-2">
              <p>{funding.disclosure || SIMULATED_FUNDING_DISCLOSURE}.</p>
              {funding.simulatedRate ? <p>Симулируемый курс: {funding.simulatedRate} KZT за {quoteSymbol}.</p> : null}
              {funding.mintExplorerUrl ? <ExplorerLink href={funding.mintExplorerUrl} label="Открыть технические сведения" /> : null}
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
        <p className="font-medium">Сумма покупки</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Выберите, сколько {symbol} использовать для покупки доли.
        </p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">К оплате</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(sanitizeDecimalInput(event.target.value))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label={`Сумма в ${symbol}`}
          />
          <span className="text-sm font-medium">{symbol}</span>
        </div>
      </label>
      <p className="text-xs text-muted-foreground">Начните с небольшой суммы — перед подтверждением покажем точный результат.</p>
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Что потребуется для покупки?</summary>
        <p className="pt-2">
          На кошельке нужны тестовые {symbol} и небольшая сумма тестового SOL на комиссию сети. Здесь используются только тестовые средства.
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
        <p className="font-medium">Сумма продажи</p>
        <p className="text-xs leading-5 text-muted-foreground">Укажите количество долей, которое хотите продать.</p>
      </div>
      <label className="space-y-1.5 text-sm">
        <span className="font-medium">Количество долей</span>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(sanitizeDecimalInput(event.target.value))}
            disabled={disabled}
            className="h-11 text-lg tabular-nums"
            aria-label="Количество долей для продажи"
          />
          <span className="text-sm font-medium">{symbol}</span>
        </div>
      </label>
      <p className="text-xs text-muted-foreground">Условия продажи появятся до подтверждения.</p>
    </Card>
  );
}

function QuoteCard({ quote, asset }: { quote: DemoQuote; asset: DemoAsset }) {
  const inputSymbol = displayDevnetSymbol(quote.side === "BUY" ? asset.quoteSymbol : asset.symbol);
  const outputSymbol = displayDevnetSymbol(quote.side === "BUY" ? asset.symbol : asset.quoteSymbol);
  const inputDecimals = quote.side === "BUY" ? asset.quoteDecimals : asset.decimals;
  const outputDecimals = quote.side === "BUY" ? asset.decimals : asset.quoteDecimals;
  const priceImpactPercent = quote.priceImpactBps === null ? null : quote.priceImpactBps / 100;
  const action = quote.side === "BUY" ? "Покупка" : "Продажа";
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Проверьте условия</p>
          <p className="mt-1 text-xs text-muted-foreground">Сумма фиксируется ненадолго перед подтверждением.</p>
        </div>
        <Badge variant="outline">{action}</Badge>
      </div>
      <QuoteRow label="К оплате" value={`${formatAtomic(quote.inputAmountAtomic, inputDecimals)} ${inputSymbol}`} />
      <QuoteRow label="Вы получите" value={`${formatAtomic(quote.expectedOutputAtomic, outputDecimals)} ${outputSymbol}`} />
      <QuoteRow label="Не менее" value={`${formatAtomic(quote.minimumOutputAtomic, outputDecimals)} ${outputSymbol}`} />
      {priceImpactPercent !== null && priceImpactPercent >= 2 ? (
        <Disclosure>
          <p className="font-medium">Эта сумма заметно влияет на цену в Devnet-пуле.</p>
          <p>Результат может быть ниже обычного. Рассмотрите меньшую сумму перед подтверждением.</p>
        </Disclosure>
      ) : null}
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Расчёт и технические данные</summary>
        <div className="space-y-2 pt-3">
          <QuoteRow label="Допустимое отклонение" value={quote.slippageBps === null ? "—" : `${(quote.slippageBps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} />
          <QuoteRow label="Комиссия пула" value={quote.feeAmountAtomic === null ? "—" : `${formatAtomic(quote.feeAmountAtomic, inputDecimals)} ${inputSymbol}`} />
          <QuoteRow label="Влияние на цену" value={priceImpactPercent === null ? "—" : `${priceImpactPercent.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`} />
          <QuoteRow label="Действует до" value={formatExpiry(quote.expiresAt)} warning={isExpired(quote.expiresAt)} />
          <QuoteRow label="Маршрут" value={quote.route} />
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
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Цифровая доля в портфеле Solana Devnet.</p>
        </div>
        <Badge variant={configured && asset.tradeEnabled ? "secondary" : "outline"}>{configured && asset.tradeEnabled ? "Доступно" : "Недоступно"}</Badge>
      </div>
      <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs">
        <QuoteRow label="Валюта расчёта" value={displayDevnetSymbol(asset.quoteSymbol)} />
        <QuoteRow label="Статус" value={configured && asset.tradeEnabled ? "Открыто для покупки в Solana Devnet" : "Временно недоступно"} />
      </div>
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Технические сведения</summary>
        <div className="space-y-2 pt-3">
          <QuoteRow label="Сеть" value={asset.network || "—"} />
          <QuoteRow label="Токен расчёта" value={displayDevnetSymbol(asset.quoteSymbol)} />
          <QuoteRow label="Пул" value={asset.poolAddress ? shortenAddress(asset.poolAddress) : "Не настроен"} />
          <QuoteRow label="Маршрут" value="Direct Meteora DLMM Devnet" />
          <div className="flex flex-wrap gap-2 pt-1">
            {asset.explorerUrl ? <ExplorerLink href={asset.explorerUrl} label="Токен RWA" /> : null}
            {asset.quoteMintExplorerUrl ? <ExplorerLink href={asset.quoteMintExplorerUrl} label={`Токен ${displayDevnetSymbol(asset.quoteSymbol)}`} /> : null}
            {asset.poolExplorerUrl ? <ExplorerLink href={asset.poolExplorerUrl} label="Пул" /> : null}
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
        <p className="font-medium">RWA Solana Devnet пока недоступен</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Попробуйте обновить данные через минуту.</p>
      </div>
      <Button variant="outline" onClick={onRetry}><RefreshCw />Обновить</Button>
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
  if (isLikelyUserRejection(error)) return "Подтверждение в кошельке отменено. Операция не отправлена.";
  if (error instanceof DemoApiError) {
    if (/insufficient|not enough|balance/i.test(error.message)) {
      return "Недостаточно средств на кошельке для этой операции.";
    }
    if (/expired|quote/i.test(error.message)) {
      return "Условия устарели. Пересчитайте их и попробуйте снова.";
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
  if (!date) return "Не указано";
  if (date.getTime() <= Date.now()) return "Истекло — пересчитайте условия";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function shortenAddress(value: string) {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function explorerForSignature(signature: string | null) {
  return signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined;
}
