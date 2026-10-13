"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProviderSheet } from "@/components/app/provider-sheet";
import { ProviderQuote } from "@/components/app/provider-quote";
import { formatMoney } from "@/lib/format";
import { russianActionError } from "@/lib/action-errors";
import { useDevnet } from "@/lib/useDevnet";
import { useAuth } from "@/lib/useAuth";

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
  isBuyAllowed?: unknown;
  isSellAllowed?: unknown;
};

const SIGNING_MESSAGE = "Add MOONPAY_SECRET_KEY to .env.local to sign the MoonPay link.";
const IFRAME_ALLOW = "accelerometer; autoplay; camera; gyroscope; payment";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1_000;

async function getMoonPayIp(flow: "buy" | "sell" = "sell") {
  const apiKey = process.env.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY;
  if (!apiKey) throw new Error("Add NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY to .env.local to enable MoonPay.");

  const url = new URL("https://api.moonpay.com/v4/ip_address");
  url.searchParams.set("apiKey", apiKey);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Couldn't check MoonPay availability in your country.");

  const result = await response.json().catch(() => null) as MoonPayIpResponse | null;
  const allowed = flow === "buy" ? result?.isBuyAllowed : result?.isSellAllowed;
  if (typeof result?.ipAddress !== "string" || typeof allowed !== "boolean") {
    throw new Error("Couldn't check MoonPay availability in your country.");
  }
  return { ipAddress: result.ipAddress, allowed };
}

function TestCardDetails() {
  return (
    <ul className="list-inside list-disc space-y-0.5">
      <li>Email: use the test email from your MoonPay Sandbox account · code 123456</li>
      <li>Phone: if the number isn&apos;t accepted in the embedded window, open MoonPay in a new tab. Test number: +1 500 555 0000, code 123456.</li>
      <li>Card: Visa 4242 4242 4242 4242 · 12/2030 · CVC 123</li>
      <li>Address: any in the US or UK; the documents step can be skipped.</li>
      <li>Test payout card: Visa · 4000 0209 5159 5032 · expires 12/2030 · CVC 123.</li>
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

type MoonPayBuyCredit = { amountUsd: number; signature: string; explorerUrl: string };

export function MoonPayBuyPath({
  amount,
  onComplete,
  onSelectAnotherMethod,
}: {
  amount: number;
  onComplete: (credit: MoonPayBuyCredit) => void;
  onSelectAnotherMethod: () => void;
}) {
  const setup = useMoonPaySetup();
  if (!setup) return <p className="text-xs text-muted-foreground">Checking MoonPay configuration…</p>;
  if (!setup.configured) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Add NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY to .env.local to enable MoonPay.</p>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Choose another method</Button>
      </div>
    );
  }
  if (!setup.canSign) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{SIGNING_MESSAGE}</p>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Choose another method</Button>
      </div>
    );
  }

  return (
    <MoonPayBuyReady
      amount={amount}
      environment={setup.environment}
      onComplete={onComplete}
      onSelectAnotherMethod={onSelectAnotherMethod}
    />
  );
}

function MoonPayBuyReady({
  amount,
  environment,
  onComplete,
  onSelectAnotherMethod,
}: {
  amount: number;
  environment: "sandbox" | "production";
  onComplete: (credit: MoonPayBuyCredit) => void;
  onSelectAnotherMethod: () => void;
}) {
  const { status: authStatus, wallet } = useAuth();
  const { status: walletStatus } = useWallet();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [externalTransactionId, setExternalTransactionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderFailed, setOrderFailed] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [countryUnavailable, setCountryUnavailable] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openedExternally, setOpenedExternally] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const opening = useRef(false);
  const completed = useRef(false);

  const openWidget = async () => {
    if (widgetUrl) {
      setSheetOpen(true);
      return;
    }
    if (amount < 5 || !wallet?.address || opening.current) return;
    opening.current = true;
    completed.current = false;
    setLoading(true);
    setError(null);
    setCountryUnavailable(false);
    setOrderFailed(false);
    setPollTimedOut(false);
    try {
      const customer = await getMoonPayIp("buy");
      if (!customer.allowed) {
        setCountryUnavailable(true);
        return;
      }
      const response = await fetch("/api/moonpay/url", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "buy", walletAddress: wallet.address, amountUsd: amount, userIp: customer.ipAddress }),
      });
      const result = await response.json().catch(() => null) as WidgetResponse | null;
      if (!response.ok || typeof result?.url !== "string" || typeof result.externalTransactionId !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : "Couldn't open MoonPay.");
      }

      const parsedUrl = new URL(result.url);
      const expectedHost = environment === "sandbox" ? "buy-sandbox.moonpay.com" : "buy.moonpay.com";
      if (parsedUrl.hostname !== expectedHost) throw new Error("MoonPay returned a link for a different environment.");
      setExternalTransactionId(result.externalTransactionId);
      setWidgetUrl(parsedUrl.toString());
      setSheetOpen(true);
    } catch (requestError) {
      setError(russianActionError(requestError, "Couldn't open MoonPay. Check your connection and try again."));
    } finally {
      opening.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!widgetUrl || !externalTransactionId || !wallet?.address) return;
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
        const response = await fetch("/api/moonpay/complete", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalTransactionId, walletAddress: wallet.address, flow: "buy" }),
        });
        const result = await response.json().catch(() => null) as {
          pending?: unknown;
          amountUsd?: unknown;
          signature?: unknown;
          explorerUrl?: unknown;
          status?: unknown;
          failureReason?: unknown;
          error?: unknown;
        } | null;
        if (response.status === 202 || result?.pending === true) return;
        if (response.status === 409 || result?.status === "failed") {
          const failureReason = typeof result?.failureReason === "string" && result.failureReason.trim()
            ? result.failureReason.trim()
            : null;
          setOrderFailed(true);
          setError(failureReason
            ? `MoonPay declined the payment: ${failureReason}`
            : typeof result?.error === "string" ? result.error : "The MoonPay payment failed.");
          active = false;
          setWidgetUrl(null);
          setExternalTransactionId(null);
          setSheetOpen(false);
          setOpenedExternally(false);
          return;
        }
        if (!response.ok) {
          setError(typeof result?.error === "string" ? result.error : "Couldn't verify the MoonPay purchase.");
          return;
        }
        if (typeof result?.amountUsd !== "number" || completed.current) return;
        if (typeof result.signature !== "string" || typeof result.explorerUrl !== "string") {
          setError("Couldn't confirm the credit on Solana devnet.");
          return;
        }
        completed.current = true;
        active = false;
        setWidgetUrl(null);
        setExternalTransactionId(null);
        setSheetOpen(false);
        setOpenedExternally(false);
        onComplete({ amountUsd: result.amountUsd, signature: result.signature, explorerUrl: result.explorerUrl });
      } catch {
        // Network errors are transient while the provider flow is open.
      } finally {
        requestPending = false;
        if (active) timer = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(() => { void poll(); }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [externalTransactionId, onComplete, wallet?.address, widgetUrl]);

  if (authStatus !== "signed-in") {
    return <p className="text-xs text-muted-foreground">Finish signing in with email to open MoonPay.</p>;
  }
  if (!wallet?.address || walletStatus === "in-progress") {
    return <p className="text-xs text-muted-foreground">Preparing your wallet…</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {openedExternally && widgetUrl ? (
          <>
            <p className="text-xs text-muted-foreground">MoonPay is open in a new tab. Complete the payment there and come back — we&apos;ll verify it and credit the amount automatically.</p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {pollTimedOut ? <p className="text-xs text-muted-foreground">Checking stopped after 15 minutes. Keep the widget open and check again later.</p> : null}
            <Button className="w-full" onClick={() => window.open(widgetUrl, "_blank", "noopener,noreferrer")}>
              <ExternalLink />Open MoonPay again
            </Button>
            <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Choose another method</Button>
          </>
        ) : (
          <>
            {environment === "sandbox" ? <p className="text-xs text-muted-foreground">MoonPay test mode: test SOL is purchased, and test dollars are credited on Solana devnet.</p> : null}
            {widgetUrl && !sheetOpen ? <p className="text-xs text-muted-foreground">If you&apos;ve already paid, the amount will be credited after MoonPay is verified.</p> : null}
            {!widgetUrl ? (
              <p className="text-xs text-muted-foreground">
                {countryUnavailable
                  ? "MoonPay is not available in your country."
                  : amount < 5
                    ? "The minimum MoonPay purchase is $5."
                    : `MoonPay will open${environment === "sandbox" ? " in test mode" : ""} to buy ${environment === "sandbox" ? "SOL" : "USDC"}.`}
              </p>
            ) : null}
            {loading ? <p className="text-xs text-muted-foreground">Opening MoonPay…</p> : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {pollTimedOut ? <p className="text-xs text-muted-foreground">Checking stopped after 15 minutes. Keep the widget open and check again later.</p> : null}
            {orderFailed && !error ? <p className="text-xs text-destructive">The payment failed. Please try again.</p> : null}
            {((widgetUrl && !sheetOpen) || (!widgetUrl && amount >= 5 && !countryUnavailable)) && !loading ? (
              <Button className="w-full" onClick={openWidget} disabled={loading}>
                {widgetUrl ? "Open MoonPay again" : error ? "Retry" : `Open MoonPay · ${formatMoney(amount)}`}
              </Button>
            ) : null}
            {!widgetUrl ? (
              <ProviderQuote provider="moonpay" side="buy" amount={amount} valid={amount >= 5 && amount <= 1_000 && !countryUnavailable} />
            ) : null}
            {(!widgetUrl || !sheetOpen) ? (
              <Button variant="outline" className="w-full" onClick={() => {
                setSheetOpen(false);
                onSelectAnotherMethod();
              }}>
                Choose another method
              </Button>
            ) : null}
          </>
        )}
      </div>
      <ProviderSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="MoonPay"
        badge={environment === "sandbox" ? "Test mode" : undefined}
        testData={environment === "sandbox" ? <TestCardDetails /> : undefined}
        externalUrl={widgetUrl ?? undefined}
        onOpenExternal={() => {
          setSheetOpen(false);
          setOpenedExternally(true);
        }}
      >
        {widgetUrl ? (
          <div className="flex h-full min-h-0 flex-1 flex-col bg-white">
            <iframe
              ref={iframeRef}
              src={widgetUrl}
              title={`MoonPay — buy ${environment === "sandbox" ? "SOL" : "USDC"}`}
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
  if (!setup) return <p className="text-xs text-muted-foreground">Checking MoonPay configuration…</p>;

  const missingConfiguration = !setup.configured
    ? "Add NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY to .env.local to enable MoonPay."
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
  const { wallet } = useAuth();
  const { status: walletStatus } = useWallet();
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow: "sell", walletAddress: wallet.address, amountUsd: amount, userIp: customer.ipAddress }),
      });
      const result = await response.json().catch(() => null) as WidgetResponse | null;
      if (!response.ok || typeof result?.url !== "string" || typeof result.externalTransactionId !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : "Couldn't open MoonPay.");
      }
      const parsedUrl = new URL(result.url);
      const expectedHost = environment === "sandbox" ? "sell-sandbox.moonpay.com" : "sell.moonpay.com";
      if (parsedUrl.hostname !== expectedHost) throw new Error("MoonPay returned a link for a different environment.");
      setExternalTransactionId(result.externalTransactionId);
      setWidgetUrl(parsedUrl.toString());
      setStage("iframe");
      setSheetOpen(true);
    } catch (requestError) {
      setError(russianActionError(requestError, "Couldn't open MoonPay. Check your connection and try again."));
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
          setError(typeof result?.error === "string" ? result.error : "Couldn't verify the MoonPay withdrawal.");
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
      setError("Couldn't connect the Solana devnet wallet.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      let transfer = pendingTransfer;
      if (!transfer) {
        setSendProgress("Signing the transfer…");
        const transaction = await wallet.send(devnet.treasuryOwner, devnet.usdMint, String(amount));
        if (!transaction.hash) throw new Error("The wallet did not return a transfer signature.");
        transfer = { signature: transaction.hash, amountUsd: amount };
        setPendingTransfer(transfer);
      }
      setSendProgress("Confirming on-chain…");
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
        throw new Error(typeof result?.error === "string" ? result.error : "The transfer is not yet confirmed on Solana devnet.");
      }
      const explorerUrl = `https://explorer.solana.com/tx/${encodeURIComponent(transfer.signature)}?cluster=devnet`;
      const recorded = onWithdrawal(transfer.amountUsd, {
        signature: transfer.signature,
        explorerUrl,
        note: "Transfer to MoonPay on devnet.",
      });
      if (!recorded) throw new Error("Couldn't record the withdrawal in the transaction history.");
      setPendingTransfer(null);
      void devnet.refreshPortfolio();
      setExternalTransactionId(null);
    } catch (requestError) {
      setError(russianActionError(requestError, "Couldn't debit test dollars. Check your balance and try again."));
    } finally {
      setSending(false);
      setSendProgress(null);
    }
  };

  const copyDepositAddress = async () => {
    if (!depositAddress) return;
    try {
      await navigator.clipboard.writeText(depositAddress);
      toast.success("Deposit address copied");
    } catch {
      toast.error("Couldn't copy the address");
    }
  };

  if (!wallet?.address || walletStatus === "in-progress") {
    return <p className="text-xs text-muted-foreground">Preparing your wallet…</p>;
  }

  const currentCryptoAmount = cryptoAmount ?? (environment === "sandbox" ? null : amount);

  if (countryUnavailable) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">MoonPay is not available in your country.</p>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>
          Choose another method
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
              MoonPay is open in a new tab. Complete the withdrawal there and come back — when MoonPay asks for a transfer, a send button will appear here.
            </p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {pollTimedOut ? <p className="text-xs text-muted-foreground">Checking stopped after 15 minutes. You can try again.</p> : null}
            <Button className="w-full" onClick={() => window.open(widgetUrl, "_blank", "noopener,noreferrer")}>
              <ExternalLink />Open MoonPay again
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                onSelectAnotherMethod();
              }}
            >
              Choose another method
            </Button>
          </>
        ) : null}
        {stage === "deposit" ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-medium">
              {currentCryptoAmount === null
                ? "MoonPay is waiting for a transfer of the selected amount."
                : `MoonPay is waiting for a transfer of ${currentCryptoAmount.toFixed(2)} ${environment === "sandbox" ? "SOL" : "USDC"}.`}
            </p>
            {depositAddress ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate font-mono" title={depositAddress}>MoonPay deposit address: {`${depositAddress.slice(0, 7)}…${depositAddress.slice(-6)}`}</span>
                <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Copy MoonPay deposit address" onClick={() => void copyDepositAddress()}><Copy /></Button>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">Transfer to MoonPay on devnet.</p>
            <Button className="w-full" onClick={sendDevnetTransfer} disabled={sending || !validAmount}>
              {sending ? (sendProgress ?? "Sending…") : "Send test dollars"}
            </Button>
          </div>
        ) : null}
        {stage === "provider-complete" ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <p className="text-sm font-medium">MoonPay completed the operation.</p>
          </div>
        ) : null}
        {stage !== "opened-external" ? (
          <>
            {loading ? <p className="text-xs text-muted-foreground">Opening MoonPay…</p> : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {pollTimedOut ? <p className="text-xs text-muted-foreground">Checking stopped after 15 minutes. You can try again.</p> : null}
            {failed ? <p className="text-xs text-destructive">The withdrawal failed. Please try again.</p> : null}
          </>
        ) : null}
        {stage === "idle" && !widgetUrl && validAmount ? (
          <Button className="w-full" onClick={openWidget} disabled={loading}>
            {failed || error ? "Retry" : "Open MoonPay"}
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
            Open MoonPay again
          </Button>
        ) : null}
      </div>
      <ProviderSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="MoonPay"
        badge={environment === "sandbox" ? "Test mode" : undefined}
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
              title={`MoonPay — withdraw ${environment === "sandbox" ? "SOL" : "USDC"}`}
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
