"use client";

import { useEffect, useRef, useState } from "react";

type WidgetEvent = { type: "ready" | "initialized" | "close" | "error" | "action-confirmed"; message?: string; action?: "deposit" | "withdraw"; signature?: string };
type WidgetController = { retry: () => void; destroy: () => void };
type PlainWidgetSdk = {
  mount: (options: {
    container: HTMLElement;
    baseUrl: string;
    partnerId: "demo-bank";
    sessionToken: string;
    onEvent?: (event: WidgetEvent) => void;
  }) => WidgetController;
};

declare global {
  interface Window {
    PlainWidget?: PlainWidgetSdk;
  }
}

let sdkLoadPromise: Promise<void> | null = null;

function loadSdk() {
  if (window.PlainWidget) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;
  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/plain-widget.js";
    script.async = true;
    script.onload = () => window.PlainWidget ? resolve() : reject(new Error("Widget SDK did not initialize."));
    script.onerror = () => reject(new Error("Widget SDK could not be loaded."));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    sdkLoadPromise = null;
    throw error;
  });
  return sdkLoadPromise;
}

export default function WidgetDemoPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WidgetController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("No sandbox session is active.");

  useEffect(() => () => controllerRef.current?.destroy(), []);

  const startDemo = async () => {
    if (busy || !containerRef.current) return;
    setBusy(true);
    setError(null);
    setStatus("Requesting a sandbox session…");
    controllerRef.current?.destroy();
    controllerRef.current = null;

    try {
      const response = await fetch("/api/widget/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: "demo-bank", parentOrigin: window.location.origin }),
        signal: AbortSignal.timeout(15_000),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !result || typeof result !== "object") throw new Error("Sandbox bootstrap is unavailable. Please try again.");
      const bootstrap = result as Record<string, unknown>;
      if (bootstrap.mode !== "SANDBOX" || bootstrap.identityVerified !== false || typeof bootstrap.sessionToken !== "string" ||
        !bootstrap.sessionToken || typeof bootstrap.expiresAt !== "number" || bootstrap.expiresAt <= Date.now()) {
        throw new Error("The server returned an invalid sandbox session.");
      }

      await loadSdk();
      if (!containerRef.current || !window.PlainWidget) throw new Error("Widget mount is unavailable. Please retry.");
      controllerRef.current = window.PlainWidget.mount({
        container: containerRef.current,
        baseUrl: window.location.origin,
        partnerId: "demo-bank",
        sessionToken: bootstrap.sessionToken,
        onEvent: (event) => {
          if (event.type === "ready") setStatus("Widget ready; validating sandbox session…");
          if (event.type === "initialized") setStatus("Sandbox session connected. Mock identity only.");
          if (event.type === "error") setStatus("Sandbox connection failed. Retry below.");
          if (event.type === "close") setStatus("Sandbox widget closed.");
          if (event.type === "action-confirmed") setStatus(`Devnet ${event.action} confirmed in the widget. This is not bank settlement or real-money eligibility.`);
        },
      });
      setStatus("Sandbox session requested. Waiting for the widget…");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "We couldn't start the sandbox demo.");
      setStatus("No sandbox session is active.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-8 sm:py-12">
      <section className="mx-auto max-w-3xl space-y-6 rounded-3xl border bg-background p-5 shadow-sm sm:p-8">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Partner integration preview</p>
          <h1 className="text-2xl font-semibold tracking-tight">Demo Bank · sandbox widget</h1>
          <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <strong>Mock organization only.</strong> This demo is a sandbox integration preview. Identity attributes are simulated; no KYC, bank connection, real money, or production partner API is involved.
          </div>
          <p className="text-sm leading-6 text-muted-foreground">Click to request a short-lived sandbox session and mount the widget. The session token stays in memory and is never added to a URL or browser storage.</p>
        </header>

        <button type="button" onClick={() => void startDemo()} disabled={busy} className="min-h-12 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? "Starting sandbox…" : "Launch sandbox widget"}
        </button>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p>
        <div ref={containerRef} className="min-h-8 overflow-hidden rounded-xl border bg-muted/20" />
      </section>
    </main>
  );
}
