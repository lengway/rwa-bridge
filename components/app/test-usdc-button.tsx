"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function TestUsdcButton({ onFunded }: { onFunded?: () => void }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const request = async () => {
    setState("sending");
    setMessage(null);
    try {
      const response = await fetch("/api/devnet/test-usdc", { method: "POST" });
      const result = await response.json().catch(() => null) as { explorerUrl?: string; error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Couldn't send test USDC.");
      setState("done");
      setMessage("1 test USDC sent to your wallet.");
      onFunded?.();
    } catch (cause) {
      setState("idle");
      setMessage(cause instanceof Error ? cause.message : "Couldn't send test USDC.");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={state !== "idle"} onClick={() => void request()}>
        {state === "sending" ? "Sending…" : "Get 1 test USDC"}
      </Button>
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  );
}
