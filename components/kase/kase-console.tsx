"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Entitlement = { owner: string; units: string; amountMicro: string };
type Action = {
  id: string;
  kind: "issue" | "record" | "coupon" | "buyback" | "redeem";
  at: string;
  memo: string;
  signatures: string[];
  snapshotHash?: string;
  entitlements?: Entitlement[];
  totalMicro?: string;
};
type Phase = "none" | "issued" | "recorded" | "coupon_paid" | "bought_back" | "redeemed";
type View = {
  configured: boolean;
  state: null | {
    issuer: string;
    bondMint: string;
    settlementMint: string;
    issuedAt: string;
    maturityDate: string;
    phase: Phase;
    holders: { label: string; owner: string }[];
    snapshot?: { recordDate: string; slot: number; hash: string; signature: string };
    actions: Action[];
  };
  registry: null | {
    slot: number;
    supply: string;
    holders: { label: string; owner: string; units: string; cashMicro: string }[];
  };
};

const STEPS: { command: Action["kind"]; label: string; after: Phase[]; detail: string }[] = [
  { command: "issue", label: "Issue & distribute", after: ["none"], detail: "Create the Token-2022 bond mint and distribute 100 bonds to five holders." },
  { command: "record", label: "Take record date", after: ["issued"], detail: "Snapshot the holder registry from chain, hash it, anchor the hash in a Memo." },
  { command: "coupon", label: "Pay coupon", after: ["recorded"], detail: "Pay units × $1,000 × 10% ÷ 2 to every holder on the record-date snapshot." },
  { command: "buyback", label: "Partial buyback (20%)", after: ["coupon_paid"], detail: "Redeem 20% of each position pro-rata at par: pay cash and burn the bonds atomically." },
  { command: "redeem", label: "Redeem at maturity", after: ["bought_back"], detail: "Pay principal + final coupon, burn all bonds, revoke the mint authority." },
];

const KIND_LABEL: Record<Action["kind"], string> = {
  issue: "Issuance & distribution",
  record: "Record date",
  coupon: "Coupon payment",
  buyback: "Partial early redemption",
  redeem: "Redemption at maturity",
};

const explorer = (kind: "tx" | "address", value: string) => `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
const short = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;
const usd = (micro: string | bigint) =>
  (Number(BigInt(micro) / BigInt(10_000)) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function KaseConsole() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/kase", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Failed to load");
    setView(body as View);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/kase", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!alive) return;
        if (response.ok) setView(body as View);
        else setError(body.error ?? "Failed to load");
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  async function run(command: string) {
    setBusy(command);
    setError(null);
    try {
      const response = await fetch("/api/kase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Action failed");
      setView(body as View);
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  const state = view?.state ?? null;
  const phase: Phase = state?.phase ?? "none";
  const labelOf = (owner: string) => state?.holders.find((h) => h.owner === owner)?.label ?? short(owner);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8 space-y-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Plain · built for the Superteam Kazakhstan x KASE side track
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Corporate actions on Solana</h1>
        <p className="max-w-3xl text-muted-foreground">
          A working tokenized-bond lifecycle on Solana devnet: issuance, a live holder registry, a hashed record-date
          snapshot, coupon payment, a pro-rata partial buyback and redemption at maturity. Every step is a real devnet
          transaction with an on-chain memo. The cash leg uses a test settlement token; fiat rails are simulated.
        </p>
      </header>

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-5">
          <h2 className="mb-3 font-medium">Instrument terms</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Instrument</dt><dd>Plain Test Bond 10% 2Y (PTB10)</dd>
            <dt className="text-muted-foreground">Face value</dt><dd>$1,000 per bond</dd>
            <dt className="text-muted-foreground">Coupon</dt><dd>10% annual, paid semi-annually ($50 / bond)</dd>
            <dt className="text-muted-foreground">Tenor</dt><dd>2 years · 4 coupon periods</dd>
            <dt className="text-muted-foreground">Maturity</dt><dd>{state?.maturityDate ?? "set at issuance"}</dd>
            <dt className="text-muted-foreground">Token standard</dt><dd>SPL Token-2022, 0 decimals</dd>
          </dl>
        </div>
        <div className="rounded-xl border p-5">
          <h2 className="mb-3 font-medium">On-chain accounts (devnet)</h2>
          {state ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Bond mint</dt>
              <dd><ExplorerLink kind="address" value={state.bondMint} /></dd>
              <dt className="text-muted-foreground">Settlement token</dt>
              <dd><ExplorerLink kind="address" value={state.settlementMint} /> <span className="text-xs text-muted-foreground">(test USD)</span></dd>
              <dt className="text-muted-foreground">Issuer / agent</dt>
              <dd><ExplorerLink kind="address" value={state.issuer} /></dd>
              <dt className="text-muted-foreground">Bonds outstanding</dt>
              <dd>{view?.registry?.supply ?? "—"}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{phase.replace("_", " ")}</dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              {view && !view.configured ? "Issuer key is not configured on this server." : "No instrument issued yet."}
            </p>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 font-medium">Lifecycle</h2>
        <ol className="grid gap-3 md:grid-cols-5">
          {STEPS.map((step, index) => {
            const done = state?.actions.some((a) => a.kind === step.command) ?? false;
            const enabled = step.after.includes(phase) && !busy;
            return (
              <li key={step.command} className={`flex flex-col gap-3 rounded-xl border p-4 ${done ? "bg-muted/40" : ""}`}>
                <div className="text-xs text-muted-foreground">Step {index + 1}{done ? " · done" : ""}</div>
                <div className="text-sm font-medium">{step.label}</div>
                <p className="flex-1 text-xs text-muted-foreground">{step.detail}</p>
                <Button size="sm" disabled={!enabled} onClick={() => run(step.command)}>
                  {busy === step.command ? <Loader2 className="animate-spin" /> : null}
                  {busy === step.command ? "Sending…" : done ? "Done" : "Run"}
                </Button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {state ? (
            <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => run("issue")}>
              {busy === "issue" && phase !== "none" ? <Loader2 className="animate-spin" /> : null}
              Reset: issue a fresh instrument
            </Button>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-medium">Holder registry</h2>
          {view?.registry ? <span className="text-xs text-muted-foreground">read from chain at slot {view.registry.slot}</span> : null}
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2">Holder</th><th className="px-4 py-2">Wallet</th><th className="px-4 py-2 text-right">Bonds</th><th className="px-4 py-2 text-right">Cash received (test USD)</th></tr>
            </thead>
            <tbody>
              {(view?.registry?.holders ?? []).map((h) => (
                <tr key={h.owner} className="border-t">
                  <td className="px-4 py-2">{h.label}</td>
                  <td className="px-4 py-2"><ExplorerLink kind="address" value={h.owner} /></td>
                  <td className="px-4 py-2 text-right tabular-nums">{h.units}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{usd(h.cashMicro)}</td>
                </tr>
              ))}
              {!view?.registry ? <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Issue the bond to populate the registry.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {state?.snapshot ? (
        <section className="mb-8 rounded-xl border p-5 text-sm">
          <h2 className="mb-2 font-medium">Latest record-date snapshot</h2>
          <p className="text-muted-foreground">
            {new Date(state.snapshot.recordDate).toUTCString()} · slot {state.snapshot.slot}
          </p>
          <p className="mt-1 font-mono text-xs break-all">sha256 {state.snapshot.hash}</p>
          <p className="mt-2"><ExplorerLink kind="tx" value={state.snapshot.signature} label="Anchoring memo transaction" /></p>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 font-medium">Corporate action log</h2>
        <div className="space-y-3">
          {[...(state?.actions ?? [])].reverse().map((action) => (
            <article key={action.id} className="rounded-xl border p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{KIND_LABEL[action.kind]}</h3>
                <span className="text-xs text-muted-foreground">{action.id} · {new Date(action.at).toUTCString()}</span>
              </div>
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground">memo: {action.memo}</p>
              {action.entitlements?.length && action.kind !== "record" ? (
                <table className="mt-3 w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr><th className="py-1">Holder</th><th className="py-1 text-right">{action.kind === "issue" ? "Bonds issued" : action.kind === "coupon" ? "Bonds on record" : "Bonds redeemed"}</th>{action.kind !== "issue" ? <th className="py-1 text-right">Entitlement</th> : null}</tr>
                  </thead>
                  <tbody>
                    {action.entitlements.map((e) => (
                      <tr key={e.owner} className="border-t">
                        <td className="py-1">{labelOf(e.owner)}</td>
                        <td className="py-1 text-right tabular-nums">{e.units}</td>
                        {action.kind !== "issue" ? <td className="py-1 text-right tabular-nums">{usd(e.amountMicro)}</td> : null}
                      </tr>
                    ))}
                    {action.totalMicro ? (
                      <tr className="border-t font-medium"><td className="py-1">Total</td><td /><td className="py-1 text-right tabular-nums">{usd(action.totalMicro)}</td></tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {action.signatures.map((signature) => (
                  <li key={signature}><ExplorerLink kind="tx" value={signature} /></li>
                ))}
              </ul>
            </article>
          ))}
          {!state?.actions.length ? <p className="text-sm text-muted-foreground">No actions yet.</p> : null}
        </div>
      </section>

      <footer className="border-t pt-6 text-xs text-muted-foreground">
        <p>
          Implemented on-chain: Token-2022 bond mint (permanent delegate, metadata), holder balances, record-date hash
          memos, coupon / buyback / redemption transfers and burns. Simulated: the fiat cash leg (a test settlement token
          minted by the issuer) and the issuer&apos;s custody of holder keys. Not affiliated with or endorsed by KASE.
        </p>
      </footer>
    </main>
  );
}

function ExplorerLink({ kind, value, label }: { kind: "tx" | "address"; value: string; label?: string }) {
  return (
    <a href={explorer(kind, value)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs underline-offset-2 hover:underline">
      {label ?? short(value)}
      <ExternalLink className="size-3" />
    </a>
  );
}
