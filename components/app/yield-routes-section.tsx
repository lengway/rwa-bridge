"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { YieldRouteQuote } from "@/lib/yield-routes";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; routes: YieldRouteQuote[] }
  | { kind: "error" };

export function YieldRoutesSection() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/earn/routes", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { routes?: YieldRouteQuote[] }) => {
        if (!cancelled) setState({ kind: "ready", routes: Array.isArray(body.routes) ? body.routes : [] });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "error") return null;
  if (state.kind === "ready" && state.routes.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="yield-routes-title">
      <div className="space-y-1">
        <h2 id="yield-routes-title" className="text-base font-semibold">
          Other USDC routes
        </h2>
        <p className="text-xs text-muted-foreground">
          Live mainnet rates. Deposits through Plain are coming soon.
        </p>
      </div>
      <div className="space-y-2">
        {state.kind === "loading" ? (
          <Card className="rounded-2xl p-4 text-sm text-muted-foreground">Loading live rates…</Card>
        ) : (
          state.routes.map((route) => <YieldRouteCard key={route.id} route={route} />)
        )}
      </div>
    </section>
  );
}

function YieldRouteCard({ route }: { route: YieldRouteQuote }) {
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-medium">{route.protocol}</h3>
          <p className="text-xs text-muted-foreground">
            {route.asset} · {route.market} · {route.network}
          </p>
        </div>
        <span className="shrink-0 rounded-full border px-2 py-1 text-[10px] leading-none text-muted-foreground">
          Coming soon
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        {route.apyPercent !== null ? (
          <div>
            <p className="text-xl font-semibold tracking-tight tabular-nums text-emerald-700 dark:text-emerald-400">
              {route.apyPercent.toFixed(2)}%
            </p>
            <p className="text-xs text-muted-foreground">Current variable APY</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Live rate unavailable</p>
        )}
        <a
          href={route.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Source: {route.source.label}
          <ExternalLink className="size-3" />
        </a>
      </div>
    </Card>
  );
}
