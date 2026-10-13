"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { DemoBankScreen } from "@/components/app/demo-bank-screen";

type WidgetEvent = { type: "ready" | "initialized" | "close" | "error" | "action-confirmed"; message?: string; action?: "deposit" | "withdraw"; signature?: string };
type WidgetController = { iframe: HTMLIFrameElement; retry: () => void; destroy: () => void };
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
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error("Widget SDK timed out. Please retry.")); }, 15_000);
    script.onload = () => { window.clearTimeout(timeout); if (window.PlainWidget) resolve(); else reject(new Error("Widget SDK did not initialize.")); };
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Widget SDK could not be loaded.")); };
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const attemptRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to connect.");

  useEffect(() => () => { attemptRef.current++; controllerRef.current?.destroy(); }, []);

  const closePlain = () => {
    attemptRef.current++;
    controllerRef.current?.destroy();
    controllerRef.current = null;
    setBusy(false);
    setError(null);
    setStatus("Ready to connect.");
    dialogRef.current?.close();
  };

  const startDemo = async () => {
    if (busy || !containerRef.current) return;
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    const attempt = ++attemptRef.current;
    setBusy(true);
    setError(null);
    setStatus("Connecting to Plain…");
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
      if (attempt !== attemptRef.current) return;
      if (!response.ok || !result || typeof result !== "object") throw new Error("Sandbox bootstrap is unavailable. Please try again.");
      const bootstrap = result as Record<string, unknown>;
      if (bootstrap.mode !== "SANDBOX" || bootstrap.identityVerified !== false || typeof bootstrap.sessionToken !== "string" ||
        !bootstrap.sessionToken || typeof bootstrap.expiresAt !== "number" || bootstrap.expiresAt <= Date.now()) {
        throw new Error("The server returned an invalid sandbox session.");
      }

      await loadSdk();
      if (attempt !== attemptRef.current) return;
      if (!containerRef.current || !window.PlainWidget) throw new Error("Widget mount is unavailable. Please retry.");
      controllerRef.current = window.PlainWidget.mount({
        container: containerRef.current,
        baseUrl: window.location.origin,
        partnerId: "demo-bank",
        sessionToken: bootstrap.sessionToken,
        onEvent: (event) => {
          if (attempt !== attemptRef.current) return;
          if (event.type === "ready") setStatus("Connecting to Plain…");
          if (event.type === "initialized") setStatus("Connected to Plain.");
          if (event.type === "error") { setError(event.message ?? "Could not connect to Plain."); setStatus("Connection failed."); }
          if (event.type === "close") closePlain();
          if (event.type === "action-confirmed") setStatus(`Devnet ${event.action} confirmed in the widget. This is not bank settlement or real-money eligibility.`);
        },
      });
      controllerRef.current.iframe.style.minHeight = "0";
      controllerRef.current.iframe.style.height = "100%";
      controllerRef.current.iframe.title = "Plain Earn";
      setStatus("Connecting to Plain…");
    } catch (startError) {
      if (attempt !== attemptRef.current) return;
      setError(startError instanceof Error ? startError.message : "We couldn't start the bank embed. Please try again.");
      setStatus("Connection failed.");
    } finally {
      if (attempt === attemptRef.current) setBusy(false);
    }
  };

  return (
    <>
      <DemoBankScreen onOpenPlain={() => void startDemo()} />
      <dialog ref={dialogRef} aria-labelledby="plain-bank-dialog-title" onCancel={(event) => { event.preventDefault(); closePlain(); }}
        className="fixed inset-0 m-auto h-[min(900px,calc(100dvh-2rem))] max-h-none w-[min(480px,calc(100vw-1rem))] max-w-none overflow-hidden rounded-2xl border bg-background p-0 text-foreground shadow-2xl backdrop:bg-slate-950/50">
        <div className="flex h-full flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
            <div><h2 id="plain-bank-dialog-title" className="text-sm font-semibold">Plain</h2><p role="status" aria-live="polite" className="mt-0.5 text-[11px] text-muted-foreground">{status}</p></div>
            <button type="button" aria-label="Close Plain" onClick={closePlain} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /></button>
          </header>
          {error ? <div className="shrink-0 space-y-2 border-b p-4"><p role="alert" className="text-sm text-destructive">{error}</p><button type="button" disabled={busy} onClick={() => void startDemo()} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">Try again</button></div> : null}
          <div ref={containerRef} className="min-h-0 flex-1" />
          <p className="shrink-0 border-t px-4 py-2.5 text-center text-[11px] text-muted-foreground">Bank account balances are sample data. Plain uses your separate wallet.</p>
        </div>
      </dialog>
    </>
  );
}
