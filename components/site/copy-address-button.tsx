"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyAddressButton({ address, label }: { address: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1_600);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label} address`}
      className="inline-flex h-9 min-w-24 items-center justify-center gap-1.5 rounded-full border bg-background px-3 text-sm font-medium transition-[background-color,transform] hover:bg-muted active:translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
    >
      {state === "copied" ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy"}</span>
    </button>
  );
}
