"use client";

import { useEffect, useRef, useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProviderSheet } from "@/components/app/provider-sheet";
import { ProviderQuote } from "@/components/app/provider-quote";
import { russianActionError } from "@/lib/action-errors";
import { useDevnet } from "@/lib/useDevnet";

type MoonPaySetup = {
  configured: boolean;
  environment: "sandbox" | "production";
  canSign: boolean;
};

type WidgetResponse = {
  url?: unknown;
  externalTransactionId?: unknown;
  error?: unknown;
};

type MoonPayIpResponse = {
  ipAddress?: unknown;
  isSellAllowed?: unknown;
};

const SIGNING_MESSAGE = "Добавьте MOONPAY_SECRET_KEY в .env.local, чтобы подписывать ссылку MoonPay.";
const IFRAME_ALLOW = "accelerometer; autoplay; camera; gyroscope; payment";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;

async function getMoonPayIp() {
  const apiKey = process.env.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY;
  if (!apiKey) throw new Error("Добавьте NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY в .env.local для подключения MoonPay.");

  const url = new URL("https://api.moonpay.com/v4/ip_address");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось проверить доступность MoonPay в вашей стране.");

  const result = await response.json().catch(() => null) as MoonPayIpResponse | null;
  if (typeof result?.ipAddress !== "string" || typeof result.isSellAllowed !== "boolean") {
    throw new Error("Не удалось проверить доступность MoonPay в вашей стране.");
  }
  return { ipAddress: result.ipAddress, allowed: result.isSellAllowed };
}

function TestCardDetails() {
  return (
    <ul className="list-inside list-disc space-y-0.5">
      <li>Телефон: если номер не принимается во встроенном окне, откройте MoonPay в новой вкладке. Тестовый номер: +1 500 555 0000, код 123456.</li>
      <li>Карта: Visa 4242 4242 4242 4242 · 12/2030 · CVC 123</li>
      <li>Адрес: любой в США или Великобритании; шаг с документами можно пропустить.</li>
      <li>Карта для тестовой выплаты: Visa · 4000 0209 5159 5032 · срок 12/2030 · CVC 123.</li>
    </ul>
  );
}

function useMoonPaySetup() {
  const [setup, setSetup] = useState<MoonPaySetup | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/moonpay/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        return response.json() as Promise<MoonPaySetup>;
      })
      .then((value) => {
        if (!cancelled) setSetup(value);
      })
      .catch(() => {
        if (!cancelled) setSetup({ configured: false, environment: "sandbox", canSign: false });
      });
    return () => { cancelled = true; };
  }, []);

  return setup;
}

type WithdrawalDetails = {
  signature: string;
  explorerUrl: string;
  note: string;
};

export function MoonPaySellPath({
  amount,
  validAmount,
  onWithdrawal,
  onSelectAnotherMethod,
}: {
  amount: number;
  validAmount: boolean;
  onWithdrawal: (amount: number, details: WithdrawalDetails) => boolean;
  onSelectAnotherMethod: () => void;
}) {
  const setup = useMoonPaySetup();
  if (!setup) return <p className="text-xs text-muted-foreground">Проверяем настройки MoonPay…</p>;

  const missingConfiguration = !setup.configured
    ? "Добавьте NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY в .env.local, чтобы подключить MoonPay."
    : !setup.canSign
      ? SIGNING_MESSAGE
      : null;
  if (missingConfiguration) return <p className="text-xs text-muted-foreground">{missingConfiguration}</p>;

  return (
    <MoonPaySellReady
      amount={amount}
      validAmount={validAmount}
      environment={setup.environment}
      onWithdrawal={onWithdrawal}
      onSelectAnotherMethod={onSelectAnotherMethod}
    />
  );
}

function MoonPaySellReady({
  amount,
  validAmount,
  environment,
  onWithdrawal,
  onSelectAnotherMethod,
}: {
  amount: number;
  validAmount: boolean;
  environment: "sandbox" | "production";
  onWithdrawal: (amount: number, details: WithdrawalDetails) => boolean;
  onSelectAnotherMethod: () => void;
}) {
  const { jwt } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();
  const devnet = useDevnet();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [externalTransactionId, setExternalTransactionId] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "iframe" | "opened-external" | "deposit" | "provider-complete">("idle");
  const [cryptoAmount, setCryptoAmount] = useState<number | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [countryUnavailable, setCountryUnavailable] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sendProgress, setSendProgress] = useState<string | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<{ signature: string; amountUsd: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const opening = useRef(false);

  const openWidget = async () => {
    if (widgetUrl) {
      setSheetOpen(true);
      return;
    }
    if (!validAmount || !wallet?.address || opening.current) return;
    opening.current = true;
    setLoading(true);
    setError(null);
    setCountryUnavailable(false);
    setFailed(false);
    setPollTimedOut(false);
    setStage("idle");
    setExternalTransactionId(null);
    try {
      const customer = await getMoonPayIp();
      if (!customer.allowed) {
        setCountryUnavailable(true);
        return;
      }
      const response = await fetch("/api/moonpay/url", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({ flow: "sell", walletAddress: wallet.address, amountUsd: amount, userIp: customer.ipAddress }),
      });
      const result = await response.json().catch(() => null) as WidgetResponse | null;
      if (!response.ok || typeof result?.url !== "string" || typeof result.externalTransactionId !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : "Не удалось открыть MoonPay.");
      }
      const parsedUrl = new URL(result.url);
      const expectedHost = environment === "sandbox" ? "sell-sandbox.moonpay.com" : "sell.moonpay.com";
      if (parsedUrl.hostname !== expectedHost) throw new Error("MoonPay вернул ссылку для другой среды.");
      setExternalTransactionId(result.externalTransactionId);
      setWidgetUrl(parsedUrl.toString());
      setStage("iframe");
      setSheetOpen(true);
    } catch (requestError) {
      setError(russianActionError(requestError, "Не удалось открыть MoonPay. Проверьте соединение и повторите попытку."));
    } finally {
      opening.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!externalTransactionId || !wallet?.address) return;
    let active = true;
    let timer: number | undefined;
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let requestPending = false;

    const poll = async () => {
      if (!active || requestPending) return;
      if (Date.now() >= deadline) {
        setPollTimedOut(true);
        return;
      }
      requestPending = true;
      try {
        const response = await fetch("/api/moonpay/sell-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalTransactionId }),
        });
        const result = await response.json().catch(() => null) as {
          pending?: unknown;
          status?: unknown;
          cryptoAmount?: unknown;
          depositAddress?: unknown;
          error?: unknown;
        } | null;
        if (response.status === 202 || result?.pending === true) return;
        if (!response.ok) {
          setError(typeof result?.error === "string" ? result.error : "Не удалось проверить вывод MoonPay.");
          return;
        }
        if (typeof result?.cryptoAmount === "number" && result.cryptoAmount > 0) setCryptoAmount(result.cryptoAmount);
        if (typeof result?.depositAddress === "string") setDepositAddress(result.depositAddress);
        if (result?.status === "waitingForDeposit") {
          setStage("deposit");
          setWidgetUrl(null);
          setSheetOpen(false);
        } else if (result?.status === "failed") {
          setFailed(true);
          setStage("idle");
          setWidgetUrl(null);
          setExternalTransactionId(null);
          setSheetOpen(false);
        } else if (result?.status === "completed") {
          setStage("provider-complete");
          setWidgetUrl(null);
          setSheetOpen(false);
        }
      } catch {
        // Keep polling while the sell flow is active; transient status API failures do not cancel it.
      } finally {
        requestPending = false;
        if (active) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [externalTransactionId, wallet?.address]);

  const sendDevnetTransfer = async () => {
    if (!wallet || !devnet.walletAddress || !devnet.treasuryOwner || !devnet.usdMint || sending) {
      setError("Не удалось подключить Solana devnet-кошелёк.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      let transfer = pendingTransfer;
      if (!transfer) {
        setSendProgress("Подписываем перевод…");
        const transaction = await wallet.send(devnet.treasuryOwner, devnet.usdMint, String(amount));
        if (!transaction.hash) throw new Error("Кошелёк не вернул подпись перевода.");
        transfer = { signature: transaction.hash, amountUsd: amount };
        setPendingTransfer(transfer);
      }
      setSendProgress("Подтверждаем в сети…");
      const response = await fetch("/api/devnet/wallet-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: devnet.walletAddress,
          recipientAddress: devnet.treasuryOwner,
          amountUsd: transfer.amountUsd,
          signature: transfer.signature,
        }),
      });
      const result = await response.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
      if (!response.ok || result?.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "Перевод пока не подтверждён в Solana devnet.");
      }
      const explorerUrl = `https://explorer.solana.com/tx/${encodeURIComponent(transfer.signature)}?cluster=devnet`;
      const recorded = onWithdrawal(transfer.amountUsd, {
        signature: transfer.signature,
        explorerUrl,
        note: "Перевод в MoonPay в сети devnet.",
      });
      if (!recorded) throw new Error("Не удалось записать вывод в историю операций.");
      setPendingTransfer(null);
      void devnet.refreshPortfolio();
      setExternalTransactionId(null);
    } catch (requestError) {
      setError(russianActionError(requestError, "Не удалось списать тестовые доллары. Проверьте баланс и повторите попытку."));
    } finally {
      setSending(false);
      setSendProgress(null);
    }
  };

  const copyDepositAddress = async () => {
    if (!depositAddress) return;
    try {
      await navigator.clipboard.writeText(depositAddress);
      toast.success("Адрес депозита скопирован");
    } catch {
      toast.error("Не удалось скопировать адрес");
    }
  };

  if (!wallet?.address || walletStatus === "in-progress") {
    return <p className="text-xs text-muted-foreground">Подготавливаем кошелёк…</p>;
  }

  const currentCryptoAmount = cryptoAmount ?? (environment === "sandbox" ? null : amount);

  if (countryUnavailable) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">MoonPay недоступен в вашей стране.</p>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>
          Выбрать другой способ
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {stage === "opened-external" && widgetUrl ? (
          <>
            <p className="text-xs text-muted-foreground">
              MoonPay открыт в новой вкладке. Завершите вывод там и вернитесь сюда — когда MoonPay попросит перевод, здесь появится кнопка отправки.
            </p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {pollTimedOut ? <p className="text-xs text-muted-foreground">Проверка остановлена через 15 минут. Можно повторить попытку.</p> : null}
            <Button className="w-full" onClick={() => window.open(widgetUrl, "_blank", "noopener,noreferrer")}>
              <ExternalLink />Открыть MoonPay снова
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onSelectAnotherMethod();
              }}
            >
              Выбрать другой способ
            </Button>
          </>
        ) : null}
        {stage === "deposit" ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-medium">
              {currentCryptoAmount === null
                ? "MoonPay ждёт перевод выбранной суммы."
                : `MoonPay ждёт перевод ${currentCryptoAmount.toFixed(2)} ${environment === "sandbox" ? "SOL" : "USDC"}.`}
            </p>
            {depositAddress ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-mono" title={depositAddress}>Адрес депозита MoonPay: {`${depositAddress.slice(0, 7)}…${depositAddress.slice(-6)}`}</span>
                <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Скопировать адрес депозита MoonPay" onClick={() => void copyDepositAddress()}><Copy /></Button>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">Перевод в MoonPay в сети devnet.</p>
            <Button className="w-full" onClick={sendDevnetTransfer} disabled={sending || !validAmount}>
              {sending ? (sendProgress ?? "Отправляем…") : "Отправить тестовые доллары"}
            </Button>
          </div>
        ) : null}
        {stage === "provider-complete" ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-medium">MoonPay завершил операцию.</p>
          </div>
        ) : null}
        {stage !== "opened-external" ? (
          <>
            {loading ? <p className="text-xs text-muted-foreground">Открываем MoonPay…</p> : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {pollTimedOut ? <p className="text-xs text-muted-foreground">Проверка остановлена через 15 минут. Можно повторить попытку.</p> : null}
            {failed ? <p className="text-xs text-destructive">Вывод не прошёл. Попробуйте ещё раз.</p> : null}
          </>
        ) : null}
        {stage === "idle" && !widgetUrl && validAmount ? (
          <Button className="w-full" onClick={openWidget} disabled={loading}>
            {failed || error ? "Повторить" : "Открыть MoonPay"}
          </Button>
        ) : null}
        {stage === "idle" && !widgetUrl ? (
          <ProviderQuote
            provider="moonpay"
            side="sell"
            amount={amount}
            valid={validAmount}
          />
        ) : null}
        {stage === "iframe" && widgetUrl && !sheetOpen ? (
          <Button className="w-full" onClick={openWidget}>
            Открыть MoonPay снова
          </Button>
        ) : null}
      </div>
      <ProviderSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="MoonPay"
        badge={environment === "sandbox" ? "Тестовый режим" : undefined}
        testData={environment === "sandbox" ? <TestCardDetails /> : undefined}
        externalUrl={widgetUrl ?? undefined}
        onOpenExternal={() => {
          setSheetOpen(false);
          setStage("opened-external");
        }}
      >
        {widgetUrl ? (
          <div className="flex h-full min-h-0 flex-1 flex-col bg-white">
            <iframe
              ref={iframeRef}
              src={widgetUrl}
              title={`MoonPay — вывод ${environment === "sandbox" ? "SOL" : "USDC"}`}
              className="min-h-0 flex-1 border-0 bg-white"
              allow={IFRAME_ALLOW}
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : null}
      </ProviderSheet>
    </>
  );
}
