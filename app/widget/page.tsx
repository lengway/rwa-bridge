"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/app/shell";
import { EarnDetail } from "@/components/app/earn-screens";
import { KAMINO_LEND } from "@/lib/yields";
import { WidgetSessionProvider, type WidgetSession } from "@/lib/widget-context";
import type { KaminoLendConfirmation } from "@/components/app/kamino-lend-contract";
import { DemoBadge } from "@/components/app/demo-badge";

const NAMESPACE = "plain-widget";
const VERSION = 1;
const TOP_LEVEL = "top-level";
const EMBEDDED_WITHOUT_ORIGIN = "embedded-without-origin";

function subscribeToFrameState() {
  return () => {};
}

function getEmbedOrigin() {
  if (window.parent === window) return TOP_LEVEL;
  try {
    const origin = document.referrer ? new URL(document.referrer).origin : null;
    if (!origin) return EMBEDDED_WITHOUT_ORIGIN;
    const url = new URL(origin);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.origin : EMBEDDED_WITHOUT_ORIGIN;
  } catch {
    return EMBEDDED_WITHOUT_ORIGIN;
  }
}

type InitMessage = {
  namespace: typeof NAMESPACE;
  version: typeof VERSION;
  type: "init";
  partnerId: "demo-bank";
  sessionToken: string;
};

type ValidationResponse = {
  mode: "SANDBOX";
  identityVerified: false;
  partnerId: "demo-bank";
  parentOrigin: string;
  mockCountry: "KZ";
  mockAdult: true;
  expiresAt: number;
};

function isInitMessage(value: unknown): value is InitMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.namespace === NAMESPACE && message.version === VERSION && message.type === "init" &&
    message.partnerId === "demo-bank" && typeof message.sessionToken === "string" && message.sessionToken.length > 0 && message.sessionToken.length <= 4096;
}

function isValidationResponse(value: unknown, parentOrigin: string): value is ValidationResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return result.mode === "SANDBOX" && result.identityVerified === false && result.partnerId === "demo-bank" &&
    result.parentOrigin === parentOrigin && result.mockCountry === "KZ" && result.mockAdult === true &&
    typeof result.expiresAt === "number" && Number.isSafeInteger(result.expiresAt) && result.expiresAt > Date.now();
}

function envelope(type: "ready" | "initialized" | "error") {
  return { namespace: NAMESPACE, version: VERSION, type };
}

export default function WidgetPage() {
  const [session, setSession] = useState<WidgetSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const embedOrigin = useSyncExternalStore(subscribeToFrameState, getEmbedOrigin, () => TOP_LEVEL);
  const embedded = embedOrigin !== TOP_LEVEL;
  const parentOriginRef = useRef<string | null>(null);
  const processingRef = useRef(false);
  const initializedRef = useRef(false);

  const signalReady = useCallback(() => {
    const parentOrigin = parentOriginRef.current;
    if (parentOrigin && window.parent !== window) {
      window.parent.postMessage(envelope("ready"), parentOrigin);
    }
  }, []);

  useEffect(() => {
    if (!embedded || embedOrigin === EMBEDDED_WITHOUT_ORIGIN) return;
    parentOriginRef.current = embedOrigin;
    let active = true;
    const controller = new AbortController();

    const handleMessage = async (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || event.origin !== parentOriginRef.current || !isInitMessage(event.data)) return;
      if (initializedRef.current || processingRef.current) return;
      processingRef.current = true;
      setError(null);

      try {
        const response = await fetch("/api/widget/session/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken: event.data.sessionToken, parentOrigin: event.origin }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        const result: unknown = await response.json().catch(() => null);
        if (!response.ok || !isValidationResponse(result, event.origin)) {
          throw new Error("Sandbox session validation failed.");
        }
        if (!active) return;

        const nextSession: WidgetSession = {
          token: event.data.sessionToken,
          partnerId: result.partnerId,
          parentOrigin: result.parentOrigin,
          mode: result.mode,
          mockCountry: result.mockCountry,
          mockAdult: result.mockAdult,
          expiresAt: result.expiresAt,
        };
        initializedRef.current = true;
        setSession(nextSession);
        window.parent.postMessage(envelope("initialized"), event.origin);
      } catch {
        if (!active) return;
        setError("We couldn't validate this sandbox session. Retry the connection or open the first-party app.");
        window.parent.postMessage(envelope("error"), event.origin);
      } finally {
        processingRef.current = false;
      }
    };

    window.addEventListener("message", handleMessage);
    signalReady();
    return () => { active = false; controller.abort(); window.removeEventListener("message", handleMessage); };
  }, [embedOrigin, embedded, signalReady]);

  const onConfirmed = useCallback((confirmation: KaminoLendConfirmation) => {
    const origin = parentOriginRef.current;
    if (!origin || !session || session.expiresAt <= Date.now()) return;
    // Public Devnet result only. Host events are UI notifications, not a bank
    // settlement instruction, user authentication, or real KYC approval.
    window.parent.postMessage({ namespace: NAMESPACE, version: VERSION, type: "action-confirmed",
      network: "devnet", action: confirmation.action, actionId: confirmation.actionId, signature: confirmation.signature }, origin);
  }, [session]);

  if (!embedded) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-8">
        <section className="w-full max-w-lg space-y-3 rounded-3xl border bg-background p-7 text-center shadow-sm">
          <DemoBadge />
          <h1 className="text-xl font-semibold">Open Plain from your bank</h1>
          <p className="text-sm leading-6 text-muted-foreground">This screen opens inside a partner app. Try the <a className="underline" href="/widget-demo">bank demo</a> or connect the Plain Widget SDK.</p>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-muted/40">
      <WidgetSessionProvider session={session}>
        {session ? (
          <>
            <AppShell embedded><EarnDetail strategy={KAMINO_LEND} onConfirmed={onConfirmed} /></AppShell>
            <p className="mx-auto max-w-md px-4 pb-4 text-center text-xs leading-5 text-muted-foreground">Having trouble signing in? <a className="underline" href="/earn/kamino-lend" target="_blank" rel="noreferrer">Open Plain in a new tab</a>. Some browsers block embedded sign-in.</p>
          </>
        ) : (
          <main className="flex min-h-dvh items-center justify-center px-5 py-8">
            <DemoBadge />
            <section className="w-full max-w-md space-y-3 rounded-2xl border bg-background p-6 text-center shadow-sm">
              <h1 className="text-lg font-semibold">Connecting to Plain</h1>
              {error ? <p role="alert" className="text-sm leading-6 text-muted-foreground">{error}</p> : embedded && embedOrigin === EMBEDDED_WITHOUT_ORIGIN ? <p role="alert" className="text-sm leading-6 text-muted-foreground">This embed could not verify its parent page origin. Open the first-party app instead.</p> : <p className="text-sm leading-6 text-muted-foreground">Waiting for the host page to initialize this sandbox widget.</p>}
              {error && embedOrigin !== EMBEDDED_WITHOUT_ORIGIN ? <button type="button" className="min-h-11 rounded-lg border px-4 text-sm font-medium" onClick={() => { setError(null); signalReady(); }}>Retry connection</button> : null}
              {error || embedOrigin === EMBEDDED_WITHOUT_ORIGIN ? <a className="block text-sm underline" href="/earn/kamino-lend" target="_blank" rel="noreferrer">Open the first-party app</a> : null}
            </section>
          </main>
        )}
      </WidgetSessionProvider>
    </div>
  );
}
