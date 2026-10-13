"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Download, FlaskConical, Link2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadText } from "@/lib/markets/csv";
import { formatDate, formatDateTime, formatSettlement, formatUnits, shortAddress } from "@/lib/markets/format";
import { KIND_LABEL, stageLabel } from "@/lib/markets/lifecycle";
import { isPaymentAction } from "@/lib/markets/math";
import type { PublishedSnapshot, VerificationReport } from "@/lib/markets/service";
import { canonicalSnapshotJson } from "@/lib/markets/snapshot";
import { MarketsProvider, useLedgerVersion, useMarkets } from "./markets-provider";
import { ChainRef, CheckIcon, Eyebrow, Panel, PanelHeader, Skeleton, StatusPill, focusRing, pillButton } from "./primitives";

export function ActionVerifier({ actionId }: { actionId: string }) {
  return (
    <MarketsProvider>
      <Verifier actionId={actionId} />
    </MarketsProvider>
  );
}

const PIPELINE = [
  "Read the CorporateAction account",
  "Fetch the published register snapshot",
  "Hash the snapshot with sha256",
  "Rebuild the Merkle tree from (holder, units) leaves",
  "Recompute every entitlement from the instrument terms",
  "Compare with on-chain totals, receipts and tally",
];

type RunState =
  | { phase: "running"; token: string }
  | { phase: "done"; token: string; report: VerificationReport; original: PublishedSnapshot | null }
  | { phase: "error"; token: string; error: Error };

function tamper(s: PublishedSnapshot): PublishedSnapshot {
  // Give the largest holder one extra unit in the local copy only.
  const top = s.holdings.reduce((best, h) => (h.units > best.units ? h : best), s.holdings[0]);
  return { ...s, holdings: s.holdings.map((h) => (h.holder === top.holder ? { ...h, units: h.units + BigInt(1) } : h)) };
}

function Verifier({ actionId }: { actionId: string }) {
  const svc = useMarkets();
  const version = useLedgerVersion();
  const [tampered, setTampered] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const token = `${actionId}:${version}:${tampered}:${nonce}`;
  const [state, setState] = useState<RunState>({ phase: "running", token: "" });

  useEffect(() => {
    let alive = true;
    (async () => {
      const original = await svc.getSnapshot(actionId).catch(() => null);
      const report = await svc.verifyAction(actionId, tampered && original ? { snapshotOverride: tamper(original) } : undefined);
      if (alive) setState({ phase: "done", token, report, original });
    })().catch((error: unknown) => {
      if (alive) setState({ phase: "error", token, error: error instanceof Error ? error : new Error(String(error)) });
    });
    return () => {
      alive = false;
    };
  }, [svc, actionId, tampered, token]);

  const current = state.token === token ? state : ({ phase: "running", token } as RunState);
  const done = current.phase === "done" ? current : null;

  // Reveal pipeline steps one by one once the computation has finished.
  useEffect(() => {
    if (!done) return;
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setRevealed(i);
      if (i >= PIPELINE.length) window.clearInterval(timer);
    }, 110);
    return () => {
      window.clearInterval(timer);
      setRevealed(0);
    };
  }, [done]);

  if (current.phase === "error") {
    const notFound = /not found/i.test(current.error.message);
    return (
      <Wrap>
        <Panel className="mt-10 p-8 text-center">
          <ShieldQuestion className="mx-auto size-10 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{notFound ? "No corporate action at this address" : "Verification could not run"}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {notFound ? (
              <>
                <span className="font-mono">{shortAddress(actionId, 6)}</span> is not a Plain Markets action account on this ledger. Check the link, or pick an action from the issuer console.
              </>
            ) : (
              current.error.message
            )}
          </p>
          <Link href="/issuers" className={cn(pillButton, "mt-6")}>
            <ArrowLeft className="size-4" aria-hidden="true" /> Issuer console
          </Link>
        </Panel>
      </Wrap>
    );
  }

  const report = done?.report;
  const allRevealed = revealed >= PIPELINE.length;

  return (
    <>
      <section aria-labelledby="verify-title" className="relative isolate overflow-hidden border-b">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(55%_70%_at_85%_0%,rgb(16_185_129/0.10),transparent_70%)]" />
        <Wrap className="pb-8 pt-10 sm:pt-12">
          <Link href={report ? `/issuers?action=${report.action.id}` : "/issuers"} className={cn("-ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground", focusRing)}>
            <ArrowLeft className="size-4" aria-hidden="true" /> Issuer console
          </Link>
          <Eyebrow className="mt-4">Plain Markets · Public verifier</Eyebrow>
          {report ? (
            <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <h1 id="verify-title" className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  {report.action.title}
                </h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>{report.instrument.name} · action #{report.action.seq} · {KIND_LABEL[report.action.kind]}</span>
                  <StatusPill status={report.action.status} label={stageLabel(report.action)} />
                </p>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">Account <ChainRef value={report.action.id} kind="address" label="action account" size={6} /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ShareButton />
                {done?.original ? (
                  <button type="button" className={pillButton} onClick={() => downloadText(`snapshot-${report.instrument.symbol}-${report.action.seq}.json`, canonicalSnapshotJson(done.original!), "application/json")}>
                    <Download className="size-4" aria-hidden="true" /> Snapshot JSON
                  </button>
                ) : null}
                <button type="button" className={pillButton} onClick={() => setNonce((n) => n + 1)}>
                  <RefreshCw className="size-4" aria-hidden="true" /> Run again
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3" aria-hidden="true">
              <h1 id="verify-title" className="sr-only">Verifying corporate action</h1>
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-5 w-1/3" />
            </div>
          )}
        </Wrap>
      </section>

      <Wrap className="space-y-5 pb-16 pt-6">
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <Verdict report={allRevealed ? report : undefined} tampered={tampered} />
            <Panel aria-labelledby="checks-title">
              <PanelHeader id="checks-title" title="Checks" description="Each check compares a value recomputed in this browser with what the program stored." />
              <ul className="divide-y" aria-live="polite">
                {allRevealed && report
                  ? report.checks.map((c, i) => (
                      <li key={c.id} className="flex gap-3 px-5 py-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-1 sm:px-6" style={{ animationDelay: `${i * 50}ms`, animationFillMode: "both" }}>
                        <CheckIcon status={c.status} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{c.title}</p>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">{c.explanation}</p>
                          {c.expected && c.actual && c.expected.length > 20 ? (
                            <dl className="mt-2 grid gap-1 rounded-xl bg-muted/50 p-2.5 font-mono text-[11px] leading-5">
                              <div className="flex gap-2"><dt className="w-20 shrink-0 font-sans text-muted-foreground">On-chain</dt><dd className="break-all">{c.expected}</dd></div>
                              <div className="flex gap-2"><dt className="w-20 shrink-0 font-sans text-muted-foreground">Recomputed</dt><dd className={cn("break-all", c.status === "fail" && "text-red-600 dark:text-red-400")}>{c.actual}</dd></div>
                            </dl>
                          ) : null}
                        </div>
                      </li>
                    ))
                  : Array.from({ length: 6 }, (_, i) => (
                      <li key={i} className="flex gap-3 px-5 py-4 sm:px-6">
                        <Skeleton className="size-6 rounded-full" />
                        <div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-5/6" /></div>
                      </li>
                    ))}
              </ul>
            </Panel>
          </div>

          <div className="space-y-5 lg:sticky lg:top-20">
            <Panel className="px-5 py-5">
              <h2 className="font-semibold tracking-tight">What ran in your browser</h2>
              <ol className="mt-4 space-y-3">
                {PIPELINE.map((label, i) => {
                  const ok = revealed > i;
                  const active = !ok && (revealed === i || !done) && i === (done ? revealed : 0);
                  return (
                    <li key={label} className="flex items-start gap-3 text-sm">
                      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200", ok ? "border-emerald-500 bg-emerald-500 text-white dark:text-emerald-950" : "text-muted-foreground")}>
                        {ok ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : active ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <span className="size-1 rounded-full bg-current" aria-hidden="true" />}
                      </span>
                      <span className={cn("leading-5", !ok && "text-muted-foreground")}>
                        {label}
                        {i === 3 && report?.leaves ? ` (${report.leaves.length})` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">Hashing uses the Web Crypto API. No server computes the verdict.</p>
            </Panel>

            <Panel className="px-5 py-5">
              <div className="flex items-start gap-3">
                <FlaskConical className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="font-semibold tracking-tight">Tamper test</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">Add one unit to the largest holder in your local copy of the snapshot and re-run. Nothing on the ledger changes.</p>
                </div>
              </div>
              <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
                <span className="font-medium">Tamper with snapshot</span>
                <input type="checkbox" role="switch" className="peer sr-only" checked={tampered} disabled={!done?.original && !tampered} onChange={(e) => setTampered(e.target.checked)} aria-checked={tampered} />
                <span aria-hidden="true" className="relative h-6 w-10 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-red-500/80 peer-disabled:opacity-50 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-background after:shadow after:transition-transform peer-checked:after:translate-x-4 motion-reduce:after:transition-none" />
              </label>
              {!done?.original && !tampered ? <p className="mt-2 text-xs text-muted-foreground">Available once a snapshot is posted.</p> : null}
            </Panel>
          </div>
        </div>

        {report && allRevealed ? <Reconciliation report={report} /> : null}
        {report && allRevealed && report.leaves ? <Leaves report={report} /> : null}
        <HowItWorks />
      </Wrap>
    </>
  );
}

function Wrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-6xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

function Verdict({ report, tampered }: { report?: VerificationReport; tampered: boolean }) {
  if (!report) {
    return (
      <div className="flex items-center gap-4 rounded-3xl border bg-card px-5 py-5 sm:px-6" aria-live="polite">
        <Loader2 className="size-8 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
        <div>
          <p className="font-semibold">Re-deriving the action…</p>
          <p className="text-sm text-muted-foreground">Fetching accounts and recomputing in your browser.</p>
        </div>
      </div>
    );
  }
  const passed = report.checks.filter((c) => c.status === "pass").length;
  const pending = report.checks.filter((c) => c.status === "pending").length;
  const failed = report.checks.filter((c) => c.status === "fail").length;
  const tone =
    report.verdict === "verified"
      ? { box: "border-emerald-500/30 bg-emerald-500/[0.07]", icon: <ShieldCheck className="size-9 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />, title: "Verified", text: `All ${passed} checks pass. Everything the program stored for this action follows from public data.` }
      : report.verdict === "mismatch"
        ? { box: "border-red-500/30 bg-red-500/[0.07]", icon: <ShieldAlert className="size-9 text-red-600 dark:text-red-400" aria-hidden="true" />, title: tampered ? "Mismatch caught" : "Mismatch", text: tampered ? `${failed} checks fail on the altered snapshot, exactly as they should. Turn the tamper test off to see the real data verify.` : `${failed} of ${report.checks.length} checks fail. Do not rely on this action's figures until the discrepancy is explained.` }
        : { box: "border-amber-500/30 bg-amber-500/[0.07]", icon: <ShieldCheck className="size-9 text-amber-600 dark:text-amber-400" aria-hidden="true" />, title: "Consistent so far", text: `${passed} checks pass; ${pending} become checkable at later stages of the lifecycle.` };
  return (
    <div role="status" className={cn("flex items-start gap-4 rounded-3xl border px-5 py-5 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[0.98] sm:px-6", tone.box)}>
      {tone.icon}
      <div>
        <p className="text-lg font-semibold tracking-tight">{tone.title}</p>
        <p className="mt-0.5 text-sm leading-6 text-foreground/80">{tone.text}</p>
        <p className="mt-1 text-xs text-muted-foreground">Computed at ledger time {formatDateTime(report.computedAt)}</p>
      </div>
    </div>
  );
}

function Reconciliation({ report }: { report: VerificationReport }) {
  const { action, instrument, entitlements } = report;
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
  const short = (h: string | null) => (h ? `${h.slice(0, 10)}…${h.slice(-8)}` : "—");
  const receiptsTotal = entitlements ? entitlements.rows.reduce((n, r) => n + (r.receipt?.amount ?? BigInt(0)), BigInt(0)) : null;
  const rows: { label: string; onchain: string; recomputed: string; ok: boolean | null }[] = [
    { label: "Snapshot sha256", onchain: short(action.snapshotHash), recomputed: short(report.recomputedHash), ok: action.snapshotHash ? action.snapshotHash === report.recomputedHash : null },
    { label: "Merkle root", onchain: short(action.merkleRoot), recomputed: short(report.recomputedRoot), ok: action.merkleRoot ? action.merkleRoot === report.recomputedRoot : null },
    { label: "Total units", onchain: action.totalUnits != null ? formatUnits(action.totalUnits) : "—", recomputed: entitlements ? formatUnits(entitlements.totalUnits) : "—", ok: action.totalUnits != null && entitlements ? action.totalUnits === entitlements.totalUnits : null },
  ];
  if (isPaymentAction(action.params)) {
    rows.push(
      { label: "Σ entitlements", onchain: action.totalEntitlement != null ? money(action.totalEntitlement) : "—", recomputed: entitlements ? money(entitlements.totalAmount) : "—", ok: report.checks.find((c) => c.id === "entitlement-total")?.status === "pass" ? true : action.totalEntitlement == null ? null : false },
      { label: "Paid", onchain: money(action.paidAmount), recomputed: receiptsTotal != null ? money(receiptsTotal) : "—", ok: receiptsTotal != null ? receiptsTotal === action.paidAmount : null },
    );
  } else if (action.params.kind === "Vote" && action.tally) {
    const tallyCheck = report.checks.find((c) => c.id === "tally")?.status;
    action.params.options.forEach((o, i) => {
      const recomputed = entitlements ? entitlements.rows.reduce((n, r) => n + (r.vote?.choice === i ? r.weight : BigInt(0)), BigInt(0)) : null;
      rows.push({ label: `Tally · ${o}`, onchain: formatUnits(action.tally![i]), recomputed: recomputed != null ? formatUnits(recomputed) : "—", ok: tallyCheck === "pending" ? null : recomputed === action.tally![i] });
    });
  }
  return (
    <Panel aria-labelledby="recon-title">
      <PanelHeader id="recon-title" title="On-chain vs recomputed" description={`Record date ${formatDate(action.recordTs)} · snapshot slot ${action.snapshotSlot?.toLocaleString("en-US") ?? "not yet posted"}`} />
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Values stored by the program compared with values recomputed in this browser</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">Value</th>
              <th scope="col" className="px-3 py-2.5 font-medium">On-chain</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Recomputed here</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium sm:px-6">Match</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="px-5 py-3 text-left font-medium sm:px-6">{r.label}</th>
                <td className="px-3 py-3 font-mono text-xs tabular-nums">{r.onchain}</td>
                <td className={cn("px-3 py-3 font-mono text-xs tabular-nums", r.ok === false && "text-red-600 dark:text-red-400")}>{r.recomputed}</td>
                <td className="px-5 py-3 sm:px-6"><CheckIcon status={r.ok == null ? "pending" : r.ok ? "pass" : "fail"} className="ml-auto" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Leaves({ report }: { report: VerificationReport }) {
  const { instrument, entitlements, action } = report;
  const byHolder = new Map((entitlements?.rows ?? []).map((r) => [r.holder, r]));
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);
  const vote = action.kind === "Vote";
  return (
    <Panel aria-labelledby="leaves-title">
      <PanelHeader id="leaves-title" title="Snapshot leaves" description="Commitment order (by holder public key). leaf = sha256(0x00 ‖ holder ‖ units u64 LE)." />
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Merkle leaves of the record-date snapshot with recomputed entitlements</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">#</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Holder</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Units</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Leaf hash</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{vote ? "Weight" : "Entitlement"}</th>
              <th scope="col" className="px-5 py-2.5 font-medium sm:px-6">{vote ? "Vote" : "Receipt"}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.leaves!.map((l, i) => {
              const row = byHolder.get(l.holder);
              const options = action.params.kind === "Vote" ? action.params.options : [];
              return (
                <tr key={l.holder}>
                  <td className="px-5 py-3 tabular-nums text-muted-foreground sm:px-6">{i}</td>
                  <td className="px-3 py-3"><ChainRef value={l.holder} kind="address" label="holder" /></td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatUnits(l.units)}</td>
                  <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground" title={l.hash}>{l.hash.slice(0, 16)}…</td>
                  <td className="px-3 py-3 text-right tabular-nums">{row ? (vote ? formatUnits(row.weight) : money(row.amount)) : "—"}</td>
                  <td className="px-5 py-3 text-xs sm:px-6">
                    {row?.receipt ? (
                      <span className={cn("inline-flex items-center gap-1", row.receipt.amount === row.amount ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400")}>
                        {row.receipt.amount === row.amount ? <Check className="size-3.5" aria-hidden="true" /> : "×"} {money(row.receipt.amount)}
                      </span>
                    ) : row?.vote ? (
                      <span className="text-emerald-700 dark:text-emerald-300">{options[row.vote.choice]} · {formatUnits(row.vote.weight)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30">
              <th scope="row" colSpan={3} className="px-5 py-3 text-left text-xs font-medium sm:px-6">Root</th>
              <td colSpan={3} className="break-all px-3 py-3 font-mono text-[11px]">{report.recomputedRoot}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function HowItWorks() {
  const items = [
    {
      title: "What you trust",
      text: "Only the Solana ledger. The snapshot file comes from the issuer's indexer, but its sha256 is committed on-chain, so a changed file fails the first check.",
    },
    {
      title: "What the program enforced",
      text: "Record date lock through the transfer hook, snapshot units equal to supply, a fully funded vault before payment, one receipt per holder, and amounts recomputed from Merkle proofs.",
    },
    {
      title: "What this page adds",
      text: "Independent recomputation: the same integer math and Merkle construction, run here, so anyone can confirm totals, payments and tallies without asking the issuer.",
    },
  ];
  return (
    <section aria-labelledby="how-title" className="pt-4">
      <h2 id="how-title" className="text-lg font-semibold tracking-tight">How verification works</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {items.map((i) => (
          <div key={i.title} className="rounded-3xl border bg-card p-5">
            <h3 className="font-medium">{i.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{i.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={pillButton}
      onClick={async () => {
        const url = window.location.href;
        try {
          if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ title: document.title, url });
          else {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
          }
        } catch {
          // Share sheet dismissed.
        }
      }}
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Link copied" : "Share link"}</span>
    </button>
  );
}
