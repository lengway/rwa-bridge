"use client";

import { useId, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Minus, Plus, Signature } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDate, formatSettlement, formatUnits, isoDate } from "@/lib/markets/format";
import { KIND_LABEL, actionTitle } from "@/lib/markets/lifecycle";
import { perUnitAmount, programTotal } from "@/lib/markets/math";
import type { ActionDraft, ActionKind, ActionParams, CorporateAction, EntitlementSheet, Instrument } from "@/lib/markets/service";
import { useLedgerQuery, useMarkets } from "./markets-provider";
import { EntitlementTable } from "./entitlement-table";
import { ErrorNote, KindIcon, Skeleton, focusRing, pillButton, primaryButton } from "./primitives";

const DAY = 86_400;
const toTs = (d: string) => Math.floor(Date.parse(`${d}T12:00:00Z`) / 1000);

function addMonths(t: number, months: number) {
  const d = new Date(t * 1000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return Math.floor(d.getTime() / 1000);
}

type Form = {
  kind: ActionKind;
  record: string;
  payment: string;
  deadline: string;
  couponPct: string;
  redeemPct: string;
  pricePct: string;
  includeCoupon: boolean;
  question: string;
  options: string[];
};

const KINDS: { kind: ActionKind; blurb: string }[] = [
  { kind: "Coupon", blurb: "Periodic interest to every holder at the record date." },
  { kind: "PartialRedemption", blurb: "Redeem a share of every holding pro rata; units burn on payment." },
  { kind: "FinalRedemption", blurb: "Repay principal at maturity, optionally with the last coupon." },
  { kind: "Vote", blurb: "Ask bondholders to consent; weight equals snapshot units." },
];

function defaults(kind: ActionKind, instrument: Instrument, actions: CorporateAction[], now: number): Form {
  const nextPeriod = actions.filter((a) => a.kind === "Coupon").length + 1;
  const periodMonths = 12 / instrument.frequency;
  let payment: number;
  if (kind === "Coupon") payment = addMonths(instrument.issueTs, nextPeriod * periodMonths);
  else if (kind === "FinalRedemption") payment = instrument.maturityTs;
  else if (kind === "Vote") payment = now + 21 * DAY;
  else payment = now + 30 * DAY;
  const record = payment - (kind === "Vote" ? 14 : 7) * DAY;
  const deadline = kind === "Vote" ? payment : payment + 90 * DAY;
  return {
    kind,
    record: isoDate(record),
    payment: isoDate(payment),
    deadline: isoDate(deadline),
    couponPct: String(instrument.couponBps / 100),
    redeemPct: "25",
    pricePct: "100",
    includeCoupon: true,
    question: "",
    options: ["For", "Against", "Abstain"],
  };
}

const pctToBps = (v: string) => Math.round(Number(v) * 100);

function toDraft(f: Form, period: number): { draft: ActionDraft | null; errors: Partial<Record<keyof Form, string>> } {
  const errors: Partial<Record<keyof Form, string>> = {};
  const recordTs = toTs(f.record);
  const paymentTs = toTs(f.payment);
  const deadlineTs = f.kind === "Vote" ? paymentTs : toTs(f.deadline);
  if (!Number.isFinite(recordTs)) errors.record = "Pick a record date.";
  if (!Number.isFinite(paymentTs)) errors.payment = "Pick a date.";
  else if (paymentTs <= recordTs) errors.payment = f.kind === "Vote" ? "Voting must close after the record date." : "Payment must come after the record date.";
  if (f.kind !== "Vote" && (!Number.isFinite(deadlineTs) || deadlineTs < paymentTs)) errors.deadline = "The claim deadline cannot precede payment.";
  let params: ActionParams;
  switch (f.kind) {
    case "Coupon": {
      const bps = pctToBps(f.couponPct);
      if (!(bps > 0 && bps <= 5_000)) errors.couponPct = "Between 0.01% and 50%.";
      params = { kind: "Coupon", period, couponBps: bps };
      break;
    }
    case "PartialRedemption": {
      const r = pctToBps(f.redeemPct);
      const p = pctToBps(f.pricePct);
      if (!(r > 0 && r < 10_000)) errors.redeemPct = "Between 0.01% and 99.99%.";
      if (!(p >= 5_000 && p <= 15_000)) errors.pricePct = "Between 50% and 150% of face.";
      params = { kind: "PartialRedemption", redeemBps: r, priceBps: p };
      break;
    }
    case "FinalRedemption": {
      const p = pctToBps(f.pricePct);
      if (!(p >= 5_000 && p <= 15_000)) errors.pricePct = "Between 50% and 150% of face.";
      params = { kind: "FinalRedemption", priceBps: p, includeCoupon: f.includeCoupon, couponBps: pctToBps(f.couponPct) };
      break;
    }
    case "Vote": {
      const options = f.options.map((o) => o.trim()).filter(Boolean);
      if (!f.question.trim()) errors.question = "Write the resolution holders vote on.";
      if (options.length < 2) errors.options = "At least two options.";
      params = { kind: "Vote", question: f.question.trim(), options };
      break;
    }
  }
  if (Object.keys(errors).length) return { draft: null, errors };
  return { draft: { kind: f.kind, recordTs, paymentTs, claimDeadlineTs: deadlineTs, params }, errors };
}

export function NewActionDialog({
  open,
  onOpenChange,
  instrument,
  actions,
  now,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  instrument: Instrument;
  actions: CorporateAction[];
  now: number;
  onCreated: (actionId: string) => void;
}) {
  const svc = useMarkets();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<Form>(() => defaults("Coupon", instrument, actions, now));
  const [submit, setSubmit] = useState<{ busy: boolean; error: Error | null }>({ busy: false, error: null });
  const period = actions.filter((a) => a.kind === "Coupon").length + 1;
  const { draft, errors } = useMemo(() => toDraft(form, period), [form, period]);
  const [touched, setTouched] = useState(false);

  const previewKey = draft ? `preview:${JSON.stringify({ ...draft, params: draft.params })}` : null;
  const preview = useLedgerQuery(previewKey, (s) => s.previewEntitlements(instrument.mint, draft!));

  const reset = () => {
    setStep(1);
    setForm(defaults("Coupon", instrument, actions, now));
    setTouched(false);
    setSubmit({ busy: false, error: null });
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const money = (v: bigint) => formatSettlement(v, instrument.settlementDecimals, instrument.settlementSymbol);

  const announce = async () => {
    if (!draft) return;
    setSubmit({ busy: true, error: null });
    try {
      const r = await svc.announce(instrument.mint, draft);
      onOpenChange(false);
      reset();
      onCreated(r.actionId);
    } catch (e) {
      setSubmit({ busy: false, error: e instanceof Error ? e : new Error(String(e)) });
    }
  };

  const showErrors = touched || step === 3;
  const title = draft ? actionTitle(instrument, draft) : KIND_LABEL[form.kind];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (submit.busy) return;
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-5xl" showCloseButton={!submit.busy}>
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="text-lg font-semibold tracking-tight">New corporate action</DialogTitle>
          <DialogDescription>
            {instrument.name} · {formatUnits(instrument.supply)} units outstanding
          </DialogDescription>
          <ol className="mt-3 flex items-center gap-2 text-xs" aria-label="Steps">
            {(["Type", "Terms and dates", "Review"] as const).map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3;
              return (
                <li key={label} className="flex items-center gap-2" aria-current={step === n ? "step" : undefined}>
                  <span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors", step > n ? "border-foreground bg-foreground text-background" : step === n ? "border-foreground" : "text-muted-foreground")}>
                    {step > n ? <Check className="size-3" aria-hidden="true" /> : n}
                  </span>
                  <span className={cn(step === n ? "font-medium" : "text-muted-foreground")}>{label}</span>
                  {i < 2 ? <span className="h-px w-6 bg-border" aria-hidden="true" /> : null}
                </li>
              );
            })}
          </ol>
        </DialogHeader>

        <div className={cn("grid", step !== 1 && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
          <div className="space-y-5 px-5 py-5 sm:px-6">
            {step === 1 ? (
              <fieldset>
                <legend className="text-sm font-medium">What are you announcing?</legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {KINDS.map(({ kind, blurb }) => {
                    const selected = form.kind === kind;
                    return (
                      <label
                        key={kind}
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-2xl border p-4 transition-[border-color,background-color,box-shadow] has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                          selected ? "border-foreground/60 bg-muted/60 shadow-sm" : "hover:border-foreground/25 hover:bg-muted/30",
                        )}
                      >
                        <input type="radio" name="kind" value={kind} checked={selected} onChange={() => setForm(defaults(kind, instrument, actions, now))} className="sr-only" />
                        <KindIcon kind={kind} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{KIND_LABEL[kind]}{kind === "Coupon" ? ` ${period}` : ""}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{blurb}</span>
                        </span>
                        <span className={cn("ml-auto mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected && "border-foreground bg-foreground")} aria-hidden="true">
                          {selected ? <span className="size-1.5 rounded-full bg-background" /> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {step === 2 ? (
              <TermsFields form={form} set={set} errors={showErrors ? errors : {}} instrument={instrument} period={period} onBlur={() => setTouched(true)} />
            ) : null}

            {step === 3 && draft ? (
              <div className="space-y-4">
                <div className="rounded-2xl border p-4">
                  <p className="text-xs text-muted-foreground">You are announcing</p>
                  <p className="mt-1 font-semibold tracking-tight">{title}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Record date</dt><dd className="font-medium">{formatDate(draft.recordTs)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{draft.kind === "Vote" ? "Voting closes" : "Payment date"}</dt><dd className="font-medium">{formatDate(draft.paymentTs)}</dd></div>
                    {draft.kind !== "Vote" ? <div><dt className="text-xs text-muted-foreground">Claim deadline</dt><dd className="font-medium">{formatDate(draft.claimDeadlineTs)}</dd></div> : null}
                    <div><dt className="text-xs text-muted-foreground">Ex-date lock</dt><dd className="font-medium">{Math.round((draft.paymentTs - draft.recordTs) / DAY)} days</dd></div>
                  </dl>
                </div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />Terms are written to a new CorporateAction account. They cannot be edited after announcement.</li>
                  <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />At the record date the transfer hook locks the register; the snapshot then fixes every holder&apos;s entitlement.</li>
                  {draft.kind !== "Vote" ? <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />You will fund the exact total the program computes before payments can start.</li> : null}
                </ul>
                {submit.error ? <ErrorNote error={submit.error} /> : null}
              </div>
            ) : null}
          </div>

          {step !== 1 ? (
            <aside className="border-t bg-muted/30 px-5 py-5 sm:px-6 lg:border-l lg:border-t-0" aria-label="Live preview" aria-live="polite">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Live preview · current register</p>
              {draft ? <PreviewFigures draft={draft} instrument={instrument} money={money} sheet={preview.data ?? null} /> : <p className="mt-3 text-sm text-muted-foreground">Fix the highlighted fields to see the math.</p>}
              <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
                {preview.data && draft ? (
                  <EntitlementTable instrument={instrument} params={draft.params} sheet={preview.data} showStatus={false} compact caption="Projected entitlements per holder" />
                ) : preview.error ? (
                  <div className="p-4"><ErrorNote error={preview.error} /></div>
                ) : (
                  <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
                )}
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">Projected from today&apos;s holders. Final entitlements are fixed by the snapshot at the record date.</p>
            </aside>
          ) : null}
        </div>

        <DialogFooter className="m-0 rounded-none rounded-b-xl px-5 sm:px-6">
          {step > 1 ? (
            <button type="button" className={cn(pillButton, "sm:mr-auto")} disabled={submit.busy} onClick={() => setStep((s) => (s - 1) as 1 | 2)}>
              <ArrowLeft className="size-4" aria-hidden="true" /> Back
            </button>
          ) : null}
          {step < 3 ? (
            <button
              type="button"
              className={primaryButton}
              onClick={() => {
                if (step === 2 && !draft) {
                  setTouched(true);
                  return;
                }
                setStep((s) => (s + 1) as 2 | 3);
              }}
            >
              Continue <ArrowRight className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className={primaryButton} disabled={!draft || submit.busy} onClick={announce}>
              {submit.busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Signature className="size-4" aria-hidden="true" />}
              Sign and announce
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewFigures({ draft, instrument, money, sheet }: { draft: ActionDraft; instrument: Instrument; money: (v: bigint) => string; sheet: EntitlementSheet | null }) {
  if (draft.params.kind === "Vote") {
    return (
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Fig label="Voting weight" value={`${formatUnits(instrument.supply)} units`} />
        <Fig label="Options" value={String(draft.params.options.length)} />
      </dl>
    );
  }
  const perUnit = perUnitAmount(instrument, draft.params);
  const total = programTotal(instrument, draft.params, instrument.supply);
  const residue = sheet ? total - sheet.totalAmount : BigInt(0);
  return (
    <dl className="mt-3 grid grid-cols-2 gap-3">
      <Fig label="Per unit" value={money(perUnit)} />
      <Fig label="Funding required" value={money(total)} />
      {draft.params.kind !== "Coupon" ? <Fig label="Units burned" value={sheet ? formatUnits(sheet.totalRedeemUnits) : "—"} /> : null}
      {residue > BigInt(0) ? <Fig label="Rounding residue to issuer" value={money(residue)} /> : null}
    </dl>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums tracking-tight transition-all">{value}</dd>
    </div>
  );
}

function TermsFields({
  form,
  set,
  errors,
  instrument,
  period,
  onBlur,
}: {
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  errors: Partial<Record<keyof Form, string>>;
  instrument: Instrument;
  period: number;
  onBlur: () => void;
}) {
  const vote = form.kind === "Vote";
  return (
    <div className="space-y-5" onBlur={onBlur}>
      {form.kind === "Coupon" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadOnly label="Coupon period" value={`${period} (scheduled ${formatDate(addMonths(instrument.issueTs, period * (12 / instrument.frequency)))})`} />
          <Field label="Annual coupon rate" suffix="%" value={form.couponPct} onChange={(v) => set("couponPct", v)} error={errors.couponPct} hint={`Terms: ${instrument.couponBps / 100}%, paid ${instrument.frequency}× a year`} inputMode="decimal" />
        </div>
      ) : null}
      {form.kind === "PartialRedemption" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Share of each holding" suffix="%" value={form.redeemPct} onChange={(v) => set("redeemPct", v)} error={errors.redeemPct} hint="Units round down per holder" inputMode="decimal" />
          <Field label="Price" suffix="% of face" value={form.pricePct} onChange={(v) => set("pricePct", v)} error={errors.pricePct} hint="100 = at par" inputMode="decimal" />
        </div>
      ) : null}
      {form.kind === "FinalRedemption" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price" suffix="% of face" value={form.pricePct} onChange={(v) => set("pricePct", v)} error={errors.pricePct} hint="100 = at par" inputMode="decimal" />
          <label className={cn("flex items-start gap-3 rounded-2xl border p-3 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50")}>
            <input type="checkbox" checked={form.includeCoupon} onChange={(e) => set("includeCoupon", e.target.checked)} className="mt-0.5 size-4 accent-current" />
            <span>
              <span className="font-medium">Include last coupon</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Pays principal and the final {form.couponPct}% ÷ {instrument.frequency} coupon together.</span>
            </span>
          </label>
        </div>
      ) : null}
      {vote ? (
        <div className="space-y-4">
          <Field label="Resolution" value={form.question} onChange={(v) => set("question", v)} error={errors.question} placeholder="e.g. Extend the audited-report deadline to 150 days" />
          <fieldset>
            <legend className="text-sm font-medium">Options</legend>
            <ul className="mt-2 space-y-2">
              {form.options.map((o, i) => (
                <li key={i} className="flex gap-2">
                  <input
                    aria-label={`Option ${i + 1}`}
                    value={o}
                    onChange={(e) => set("options", form.options.map((x, j) => (j === i ? e.target.value : x)))}
                    className={cn("h-10 flex-1 rounded-xl border bg-background px-3 text-sm", focusRing)}
                  />
                  <button type="button" className={cn(pillButton, "size-10 px-0")} disabled={form.options.length <= 2} onClick={() => set("options", form.options.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`}>
                    <Minus className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {form.options.length < 4 ? (
              <button type="button" className={cn(pillButton, "mt-2")} onClick={() => set("options", [...form.options, ""])}>
                <Plus className="size-4" aria-hidden="true" /> Add option
              </button>
            ) : null}
            {errors.options ? <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.options}</p> : null}
          </fieldset>
        </div>
      ) : null}
      <div className={cn("grid gap-4", vote ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
        <Field type="date" label="Record date" value={form.record} onChange={(v) => set("record", v)} error={errors.record} hint="Register locks at 12:00 UTC" />
        <Field type="date" label={vote ? "Voting closes" : "Payment date"} value={form.payment} onChange={(v) => set("payment", v)} error={errors.payment} hint={form.kind === "FinalRedemption" ? `Maturity ${formatDate(instrument.maturityTs)}` : "Lock lifts here"} />
        {!vote ? <Field type="date" label="Claim deadline" value={form.deadline} onChange={(v) => set("deadline", v)} error={errors.deadline} hint="Then residue returns to issuer" /> : null}
      </div>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1.5 flex h-10 items-center rounded-xl bg-muted/60 px-3 text-sm">{value}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  hint,
  suffix,
  type = "text",
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  suffix?: string;
  type?: "text" | "date";
  inputMode?: "decimal";
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={type}
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={`${id}-note`}
          className={cn("h-10 w-full rounded-xl border bg-background px-3 text-sm tabular-nums transition-colors [color-scheme:light] dark:[color-scheme:dark]", suffix && "pr-20", error && "border-red-500/60", focusRing)}
        />
        {suffix ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      <p id={`${id}-note`} className={cn("mt-1.5 text-xs", error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{error ?? hint}</p>
    </div>
  );
}
