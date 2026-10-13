"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { Coins, CreditCard, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CrossmintOnramp } from "@/components/CrossmintOnramp";
import { ProviderSheet } from "@/components/app/provider-sheet";
import { ProviderQuote } from "@/components/app/provider-quote";
import { formatMoney } from "@/lib/format";
import { russianActionError } from "@/lib/action-errors";
import { useAuth } from "@/lib/useAuth";
import {
  ONRAMP_OPTIONS,
  TRANSAK_MIN_USD,
  TRANSAK_STAGING_WIDGET_ORIGIN,
} from "@/lib/onramps";

export function MethodOption({
  id,
  selected,
  onSelect,
  disabled = false,
}: {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const labels: Record<string, string> = {
    "bank-embed": "From a bank account",
  };
  const label = labels[id] ?? ONRAMP_OPTIONS.find((option) => option.id === id)?.name ?? id;
  const hint = ONRAMP_OPTIONS.find((option) => option.id === id)?.hint;
  const MethodIcon = id === "bank-embed" ? Landmark : id === "devnet-faucet" || id === "kzte-intebix" ? Coins : CreditCard;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${selected ? "border-foreground bg-muted/60" : "hover:bg-muted/40"}`}
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <MethodIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {label}
          {id === "transak" ? <Badge variant="secondary">Recommended</Badge> : null}
        </span>
        {id === "bank-embed" ? (
          <span className="mt-1 block text-xs text-muted-foreground">Payment is confirmed in your bank app</span>
        ) : hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={`mt-1 size-4 rounded-full border ${selected ? "border-foreground bg-foreground ring-2 ring-background ring-offset-1 ring-offset-foreground" : "border-muted-foreground/40"}`} />
    </button>
  );
}

type TransakSetup = { configured: boolean; message?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPositiveAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;

  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

function getTransakOrderId(eventData: unknown): string | null {
  if (!isRecord(eventData) || !isRecord(eventData.data)) return null;
  const payload = eventData.data;
  const status = isRecord(payload.status) ? payload.status : null;
  const candidates = [payload.id, status?.id, payload.orderId];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && candidate.length <= 128) {
      return candidate.trim();
    }
  }
  return null;
}

const TRANSAK_POLL_INTERVAL_MS = 5_000;
const TRANSAK_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

type TransakOnchainCompletion = { amountUsd: number; signature: string; explorerUrl: string };

export function TransakPath({
  amount,
  onCompleteOnchain,
  onSelectAnotherMethod,
}: {
  amount: number;
  onCompleteOnchain: (credit: TransakOnchainCompletion) => void;
  onSelectAnotherMethod: () => void;
}) {
  const [setup, setSetup] = useState<TransakSetup | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/transak-session")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error("Couldn't check the Transak configuration.");
        return result as TransakSetup;
      })
      .then((result) => {
        if (!cancelled) setSetup(result);
      })
      .catch(() => {
        if (!cancelled) setSetup({
          configured: false,
          message: "Couldn't check the Transak configuration.",
        });
      });
    return () => { cancelled = true; };
  }, []);

  if (!setup) {
    return <p className="text-xs text-muted-foreground">Checking Transak configuration…</p>;
  }
  if (!setup.configured) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{setup.message ?? "Transak is not configured yet."}</p>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>Choose another method</Button>
      </div>
    );
  }

  return (
    <TransakSessionPath
      amount={amount}
      onCompleteOnchain={onCompleteOnchain}
      onSelectAnotherMethod={onSelectAnotherMethod}
    />
  );
}

function TransakSessionPath({
  amount,
  onCompleteOnchain,
  onSelectAnotherMethod,
}: {
  amount: number;
  onCompleteOnchain: (credit: TransakOnchainCompletion) => void;
  onSelectAnotherMethod: () => void;
}) {
  const { status: authStatus, email, wallet } = useAuth();
  const { status: walletStatus } = useWallet();
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderFailed, setOrderFailed] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hasOpenedSession, setHasOpenedSession] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const completed = useRef(false);
  const reportedCredit = useRef(false);
  const orderIdRef = useRef<string | null>(null);
  const opening = useRef(false);
  const mounted = useRef(false);

  const closeWidget = useCallback(() => {
    setWidgetUrl(null);
    setSheetOpen(false);
    setHasOpenedSession(true);
  }, []);

  const handleSheetOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setSheetOpen(true);
    } else {
      closeWidget();
    }
  }, [closeWidget]);

  const captureOrderId = useCallback((eventData: unknown) => {
    const id = getTransakOrderId(eventData);
    if (!id || orderIdRef.current === id) return id;
    orderIdRef.current = id;
    setOrderId(id);
    setOrderFailed(false);
    setError(null);
    setPollTimedOut(false);
    setVerificationPending(true);
    return id;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const openWidget = async () => {
    if (amount < TRANSAK_MIN_USD || opening.current || widgetUrl || !wallet?.address) return;

    opening.current = true;
    completed.current = false;
    reportedCredit.current = false;
    setLoading(true);
    setError(null);
    setOrderFailed(false);

    try {
      const response = await fetch("/api/transak-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet.address, amountUsd: amount, email }),
      });
      const result = await response.json().catch(() => null) as {
        widgetUrl?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || typeof result?.widgetUrl !== "string") {
        throw new Error(typeof result?.error === "string"
          ? result.error
          : "Couldn't open the Transak widget.");
      }

      const parsedUrl = new URL(result.widgetUrl);
      if (parsedUrl.origin !== TRANSAK_STAGING_WIDGET_ORIGIN) {
        throw new Error("Transak returned a non-test-environment link.");
      }
      if (!mounted.current) return;

      setWidgetUrl(parsedUrl.toString());
      setHasOpenedSession(true);
      setSheetOpen(true);
    } catch (requestError: unknown) {
      if (mounted.current) {
        setError(russianActionError(requestError, "Couldn't open Transak. Check your connection and try again."));
      }
    } finally {
      opening.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!orderId || !wallet?.address || reportedCredit.current) return;
    let active = true;
    let timer: number | undefined;
    let requestPending = false;
    const deadline = Date.now() + TRANSAK_POLL_TIMEOUT_MS;

    const poll = async () => {
      if (!active || requestPending || reportedCredit.current) return;
      if (Date.now() >= deadline) {
        setPollTimedOut(true);
        setVerificationPending(false);
        return;
      }

      requestPending = true;
      try {
        const response = await fetch("/api/transak/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, walletAddress: wallet.address }),
        });
        const result = await response.json().catch(() => null) as {
          status?: unknown;
          amountUsd?: unknown;
          signature?: unknown;
          explorerUrl?: unknown;
          error?: unknown;
        } | null;
        if (!active) return;

        if (result?.status === "pending" || response.status === 202) {
          setVerificationPending(true);
          setError(null);
        } else if (result?.status === "failed") {
          reportedCredit.current = true;
          orderIdRef.current = null;
          setOrderId(null);
          setVerificationPending(false);
          setOrderFailed(true);
          closeWidget();
          return;
        } else if (response.ok && result?.status === "completed") {
          const amountUsd = toPositiveAmount(result.amountUsd);
          if (amountUsd === null) {
            throw new Error("Transak did not return a valid purchase amount.");
          }
          if (typeof result.signature !== "string" || typeof result.explorerUrl !== "string") {
            throw new Error("Couldn't confirm the credit on Solana devnet.");
          }
          reportedCredit.current = true;
          orderIdRef.current = null;
          setOrderId(null);
          setVerificationPending(false);
          setPollTimedOut(false);
          setError(null);
          closeWidget();
          onCompleteOnchain({ amountUsd, signature: result.signature, explorerUrl: result.explorerUrl });
          return;
        } else if (response.status >= 400 && response.status < 500) {
          orderIdRef.current = null;
          setOrderId(null);
          setVerificationPending(false);
          setError(typeof result?.error === "string"
            ? result.error
            : "Couldn't verify the Transak purchase.");
          return;
        } else {
          setVerificationPending(true);
          if (typeof result?.error === "string") setError(result.error);
        }
      } catch (requestError) {
        if (active) {
          setVerificationPending(true);
          setError(russianActionError(requestError, "Couldn't verify the Transak payment. The check will retry automatically."));
        }
      } finally {
        requestPending = false;
        if (active && !reportedCredit.current) {
          timer = window.setTimeout(() => { void poll(); }, TRANSAK_POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [closeWidget, onCompleteOnchain, orderId, wallet?.address]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== TRANSAK_STAGING_WIDGET_ORIGIN
        || event.source !== iframeRef.current?.contentWindow
        || !event.data
        || typeof event.data !== "object"
      ) return;

      const eventId = event.data.event_id;
      if (eventId === "TRANSAK_ORDER_CREATED") {
        captureOrderId(event.data);
      }
      if (eventId === "TRANSAK_ORDER_SUCCESSFUL" && !completed.current) {
        if (!captureOrderId(event.data)) {
          setError("Couldn't get the Transak order ID to verify.");
        }
        completed.current = true;
        closeWidget();
      }
      if (eventId === "TRANSAK_ORDER_FAILED" && !completed.current) {
        if (!captureOrderId(event.data) && !orderIdRef.current) setOrderFailed(true);
        closeWidget();
      }
      if (eventId === "TRANSAK_WIDGET_CLOSE" && !completed.current) {
        closeWidget();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [captureOrderId, closeWidget]);

  if (authStatus !== "signed-in") return <p className="text-xs text-muted-foreground">Finish signing in with email to open Transak.</p>;

  if (!wallet?.address || walletStatus === "in-progress") {
    return <p className="text-xs text-muted-foreground">Preparing your wallet…</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {!widgetUrl && !orderId ? (
          <p className="text-xs text-muted-foreground">
            {amount < TRANSAK_MIN_USD
              ? "The minimum amount for Transak is $30. Increase the amount or choose another method."
              : "The Transak widget will open."}
          </p>
        ) : widgetUrl && !sheetOpen ? (
          <p className="text-xs text-muted-foreground">Close the widget to return to top-up methods.</p>
        ) : null}
        {loading ? <p className="text-xs text-muted-foreground">Opening the Transak widget…</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {orderId && verificationPending ? <p className="text-xs text-muted-foreground">Verifying the Transak payment…</p> : null}
        {pollTimedOut && orderId ? <p className="text-xs text-muted-foreground">Confirmation is delayed. Try checking the payment again later.</p> : null}
        {orderFailed && !widgetUrl ? <p className="text-xs text-destructive">The payment failed. Please try again.</p> : null}
        {!widgetUrl && amount >= TRANSAK_MIN_USD ? (
          <Button className="w-full" onClick={openWidget} disabled={loading || verificationPending}>
            {verificationPending ? "Verifying payment…" : loading ? "Opening Transak…" : hasOpenedSession ? "Open Transak again" : error ? "Retry" : `Open Transak · ${formatMoney(amount)}`}
          </Button>
        ) : null}
        {!widgetUrl ? (
          <ProviderQuote
            provider="transak"
            side="buy"
            amount={amount}
            valid={amount >= TRANSAK_MIN_USD && amount <= 1_000}
          />
        ) : null}
        {!sheetOpen ? (
          <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>
            Choose another method
          </Button>
        ) : null}
      </div>
      <ProviderSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        title="Transak"
        badge="devnet"
        testData={<p>Test identity details fill in automatically — you only need the emailed code and the test card.</p>}
      >
        {widgetUrl ? (
          <div className="flex h-full min-h-0 flex-col bg-white">
            <iframe
              ref={iframeRef}
              src={widgetUrl}
              title="Transak — buy USDC"
              className="min-h-0 flex-1 border-0 bg-white"
              allow="camera; microphone; payment"
              referrerPolicy="strict-origin-when-cross-origin"
            />
            {orderFailed ? (
              <p className="shrink-0 px-4 py-2 text-xs text-red-700">The payment failed. Please try again.</p>
            ) : null}
          </div>
        ) : null}
      </ProviderSheet>
    </>
  );
}

export function CrossmintPath({
  amount,
  onComplete,
  onSelectAnotherMethod,
}: {
  amount: number;
  onComplete: (amount: number) => void;
  onSelectAnotherMethod: () => void;
}) {
  const { email, status, wallet } = useAuth();
  const { status: walletStatus } = useWallet();
  if (status === "signed-in" && email && wallet?.address) {
    return (
      <div className="space-y-3">
        <CrossmintOnramp
          walletAddress={wallet.address}
          email={email}
          amountUsd={amount}
          onCompleted={onComplete}
        />
        <p className="text-xs text-muted-foreground">
          If card payment isn&apos;t available in your country, choose another method.
        </p>
        <Button variant="outline" className="w-full" onClick={onSelectAnotherMethod}>
          Choose another method
        </Button>
      </div>
    );
  }

  return <p className="text-xs text-muted-foreground">{status === "signed-in" && walletStatus === "in-progress" ? "Preparing your wallet…" : "Finish signing in with email to open card payment."}</p>;
}
