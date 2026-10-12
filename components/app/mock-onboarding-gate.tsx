"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/useAuth";
import { useWidgetSession } from "@/lib/widget-context";
import { countries } from "@/lib/countries";
import { MockCapture } from "@/components/app/mock-capture";

type MockProfile = {
  status: "MOCK_COMPLETED";
  mode: "MOCK";
  country: string;
  adultAttested: true;
  mockAcknowledged: true;
  dataUsageAccepted: true;
  source: "SELF_MOCK" | "PARTNER_MOCK";
  partnerId?: string;
  updatedAt: number;
};

type OnboardingResponse = {
  mode: "MOCK";
  identityVerified: false;
  profile: MockProfile | null;
};

type OnboardingState = {
  owner: string | null;
  phase: "idle" | "loading" | "error" | "incomplete" | "complete";
  error: string | null;
  profile: MockProfile | null;
  saving: boolean;
};

type FormState = {
  owner: string | null;
  country: string;
  otherCountry: string;
  adultAttested: boolean;
  consentAccepted: boolean;
};

const EMPTY_FORM: Omit<FormState, "owner"> = {
  country: "",
  otherCountry: "",
  adultAttested: false,
  consentAccepted: false,
};

const GET_TIMEOUT_MS = 12_000;
const POST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIso2(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

function parseOnboardingResponse(value: unknown): OnboardingResponse | null {
  if (!isRecord(value) || value.mode !== "MOCK" || value.identityVerified !== false) return null;
  if (value.profile === null) return { mode: "MOCK", identityVerified: false, profile: null };
  if (!isRecord(value.profile)) return null;

  const profile = value.profile;
  if (
    profile.status !== "MOCK_COMPLETED" ||
    profile.mode !== "MOCK" ||
    !isIso2(profile.country) ||
    profile.adultAttested !== true ||
    profile.mockAcknowledged !== true ||
    profile.dataUsageAccepted !== true ||
    (profile.source !== "SELF_MOCK" && profile.source !== "PARTNER_MOCK") ||
    typeof profile.updatedAt !== "number" ||
    !Number.isFinite(profile.updatedAt) ||
    (profile.partnerId !== undefined && typeof profile.partnerId !== "string")
  ) {
    return null;
  }

  return {
    mode: "MOCK",
    identityVerified: false,
    profile: {
      status: "MOCK_COMPLETED",
      mode: "MOCK",
      country: profile.country,
      adultAttested: true,
      mockAcknowledged: true,
      dataUsageAccepted: true,
      source: profile.source,
      ...(typeof profile.partnerId === "string" ? { partnerId: profile.partnerId } : {}),
      updatedAt: profile.updatedAt,
    },
  };
}

function isUsableWidgetSession(
  session: ReturnType<typeof useWidgetSession>["session"],
  now = Date.now(),
): session is NonNullable<ReturnType<typeof useWidgetSession>["session"]> {
  if (!session || session.mode !== "SANDBOX" || session.mockAdult !== true) return false;
  if (!isIso2(session.mockCountry) || typeof session.token !== "string" || !session.token.trim()) return false;
  if (typeof session.partnerId !== "string" || !session.partnerId.trim()) return false;
  if (typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt) || session.expiresAt <= now) return false;
  try {
    const origin = new URL(session.parentOrigin);
    return (origin.protocol === "https:" || origin.protocol === "http:") && origin.origin === session.parentOrigin;
  } catch {
    return false;
  }
}

function timeoutController(milliseconds: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, milliseconds);
  return {
    controller,
    didTimeout: () => timedOut,
    clear: () => window.clearTimeout(timer),
  };
}

export function MockOnboardingGate({
  children,
  allowExit = false,
}: {
  children: React.ReactNode;
  allowExit?: boolean;
}) {
  const { email, status: authStatus } = useAuth();
  const { session: widgetSession } = useWidgetSession();
  const [onboarding, setOnboarding] = useState<OnboardingState>({
    owner: null,
    phase: "idle",
    error: null,
    profile: null,
    saving: false,
  });
  const [form, setForm] = useState<FormState>({ owner: null, ...EMPTY_FORM });
  const [retry, setRetry] = useState(0);
  const [captureOwner, setCaptureOwner] = useState<string | null>(null);
  const [expiredWidgetSession, setExpiredWidgetSession] = useState<string | null>(null);
  const postController = useRef<AbortController | null>(null);
  const countrySelectId = useId();
  const otherCountryId = useId();
  const adultId = useId();
  const consentId = useId();
  const widgetConsentId = useId();

  const owner = authStatus === "signed-in" && typeof email === "string" && email.trim()
    ? email.trim().toLowerCase()
    : null;
  const activeOnboarding = onboarding.owner === owner ? onboarding : null;
  const activeForm = form.owner === owner ? form : { owner, ...EMPTY_FORM };
  const widgetSessionKey = widgetSession
    ? `${widgetSession.partnerId}:${widgetSession.expiresAt}:${widgetSession.token}`
    : null;
  const widgetValid = expiredWidgetSession !== widgetSessionKey && isUsableWidgetSession(widgetSession);
  const isComplete = authStatus === "signed-in" && owner !== null && activeOnboarding?.phase === "complete";

  useEffect(() => {
    if (!widgetSession || !Number.isFinite(widgetSession.expiresAt)) return;
    const remaining = widgetSession.expiresAt - Date.now();
    if (remaining <= 0) return;
    const sessionKey = `${widgetSession.partnerId}:${widgetSession.expiresAt}:${widgetSession.token}`;
    const timer = window.setTimeout(() => setExpiredWidgetSession(sessionKey), remaining);
    return () => window.clearTimeout(timer);
  }, [widgetSession]);

  useEffect(() => {
    return () => postController.current?.abort();
  }, [authStatus, owner]);

  useEffect(() => {
    if (authStatus !== "signed-in" || !owner) return;

    let cancelled = false;
    const request = timeoutController(GET_TIMEOUT_MS);

    void (async () => {
      try {
        const response = await fetch("/api/me/onboarding", {
          method: "GET",
          cache: "no-store",
          signal: request.controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error("We couldn't load your demo setup.");
        const parsed = parseOnboardingResponse(body);
        if (!parsed) throw new Error("The demo setup response was invalid. Please retry.");
        if (cancelled || request.controller.signal.aborted) return;
        setOnboarding({
          owner,
          phase: parsed.profile ? "complete" : "incomplete",
          error: null,
          profile: parsed.profile,
          saving: false,
        });
      } catch {
        if (cancelled || (request.controller.signal.aborted && !request.didTimeout())) return;
        setOnboarding({
          owner,
          phase: "error",
          error: request.didTimeout()
            ? "Loading demo setup took too long. Check your connection and retry."
            : "We couldn't confirm your demo setup. Check your connection and retry.",
          profile: null,
          saving: false,
        });
      } finally {
        request.clear();
      }
    })();

    return () => {
      cancelled = true;
      request.controller.abort();
      request.clear();
    };
  }, [authStatus, owner, retry]);

  const updateForm = (patch: Partial<Omit<FormState, "owner">>) => {
    setForm({ ...activeForm, ...patch, owner });
  };

  const submit = async (captureFinished = false) => {
    if (!owner || activeOnboarding?.saving) return;
    const currentWidgetSession = isUsableWidgetSession(widgetSession) ? widgetSession : null;
    const country = currentWidgetSession
      ? currentWidgetSession.mockCountry
      : activeForm.country === "OTHER"
        ? activeForm.otherCountry.trim().toUpperCase()
        : activeForm.country;
    const adultAttested = currentWidgetSession ? true : activeForm.adultAttested;

    if (!isIso2(country)) {
      setOnboarding({ owner, phase: "incomplete", error: "Choose a country or enter its two-letter ISO country code.", profile: null, saving: false });
      return;
    }
    if (!adultAttested || !activeForm.consentAccepted) {
      setOnboarding({
        owner,
        phase: "incomplete",
        error: !adultAttested ? "Confirm that you are an adult to continue." : "Acknowledge the demo-only setup and data use to continue.",
        profile: null,
        saving: false,
      });
      return;
    }

    if (!captureFinished) { setCaptureOwner(owner); return; }
    const request = timeoutController(POST_TIMEOUT_MS);
    postController.current?.abort();
    postController.current = request.controller;
    setOnboarding({ owner, phase: "incomplete", error: null, profile: null, saving: true });
    try {
      const response = await fetch("/api/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: request.controller.signal,
        body: JSON.stringify({
          country,
          adultAttested: true,
          mockAcknowledged: true,
          dataUsageAccepted: true,
          ...(currentWidgetSession ? { widgetSessionToken: currentWidgetSession.token } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const error = isRecord(body) && typeof body.error === "string" ? body.error : "We couldn't save your demo setup. Please retry.";
        throw new Error(error);
      }
      const parsed = parseOnboardingResponse(body);
      if (
        !parsed?.profile ||
        parsed.profile.country !== country ||
        parsed.profile.adultAttested !== true ||
        parsed.profile.mockAcknowledged !== true ||
        parsed.profile.dataUsageAccepted !== true
      ) {
        throw new Error("We couldn't confirm that your demo setup was saved. Please retry.");
      }
      if (request.controller.signal.aborted) return;
      setOnboarding({ owner, phase: "complete", error: null, profile: parsed.profile, saving: false });
    } catch (error) {
      if (request.controller.signal.aborted && !request.didTimeout()) return;
      setOnboarding({
        owner,
        phase: "incomplete",
        error: request.didTimeout()
          ? "Saving demo setup took too long. Check your connection and retry."
          : error instanceof Error
            ? error.message
            : "We couldn't save your demo setup. Please retry.",
        profile: null,
        saving: false,
      });
    } finally {
      request.clear();
      if (postController.current === request.controller) postController.current = null;
    }
  };

  if (allowExit) {
    return (
      <>
        {!isComplete && activeOnboarding?.phase === "incomplete" ? (
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs leading-5 text-foreground sm:px-6">
            <span>Complete account setup before adding new funds.</span>
            <Link href="/home" className="inline-flex shrink-0 items-center gap-1 font-medium underline underline-offset-4">
              Complete setup <ArrowRight aria-hidden="true" className="size-3" />
            </Link>
          </div>
        ) : null}
        {children}
      </>
    );
  }

  if (isComplete) return <>{children}</>;
  if (captureOwner !== null && captureOwner === owner) return <MockCapture key={owner} onBack={() => setCaptureOwner(null)} onFinish={() => { setCaptureOwner(null); void submit(true); }} />;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-emerald-500/5 via-background to-sky-500/10 px-4 py-12 sm:px-6">
      <Card className="w-full max-w-lg rounded-3xl bg-background shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none">
        <CardHeader className="gap-3 px-5 pt-6 sm:px-7 sm:pt-7">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-xl">Set up your account</CardTitle>
            <CardDescription className="leading-5">
              A few details to get started. In this demo, no documents are checked and your identity is not verified.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 px-5 pb-6 sm:px-7 sm:pb-7">
          {authStatus !== "signed-in" ? (
            <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
              {authStatus === "loading" ? "Checking your sign-in…" : "Sign in with your email to continue."}
            </div>
          ) : !owner ? (
            <div className="space-y-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <p role="alert" className="text-sm leading-6">We couldn&apos;t confirm your signed-in email. Refresh the page and try again.</p>
              <Button variant="outline" className="w-full" onClick={() => window.location.reload()}>Refresh</Button>
            </div>
          ) : activeOnboarding?.phase === "loading" || !activeOnboarding ? (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground" role="status">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              Checking your account setup…
            </div>
          ) : activeOnboarding.phase === "error" ? (
            <div className="space-y-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <p role="alert" className="flex items-start gap-2 text-sm leading-6 text-foreground">
                <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-destructive" />
                {activeOnboarding.error ?? "We couldn't confirm your demo setup."}
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setOnboarding({ ...activeOnboarding, phase: "loading", error: null, profile: null });
                  setRetry((count) => count + 1);
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <>
              {widgetValid ? (
                <div className="space-y-4">
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <p className="text-sm font-medium">Bank profile ready</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">
                      The sample bank profile supplies Kazakhstan and an adult declaration. No repeated form is needed. These are mock attributes, not verified KYC.
                    </p>
                  </div>
                  <label htmlFor={widgetConsentId} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5">
                    <Checkbox
                      id={widgetConsentId}
                      checked={activeForm.consentAccepted}
                      onCheckedChange={(checked) => updateForm({ consentAccepted: checked === true })}
                      disabled={activeOnboarding.saving}
                      className="mt-0.5"
                    />
                    <span>I understand this is mock-only, not real KYC or real-money eligibility, and I consent to storing the demo country and declarations.</span>
                  </label>
                  <StoredDataNote />
                  {activeOnboarding.error ? <p role="alert" className="text-sm text-destructive">{activeOnboarding.error}</p> : null}
                  <Button className="w-full" onClick={() => void submit()} disabled={!activeForm.consentAccepted || activeOnboarding.saving}>
                    {activeOnboarding.saving ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
                    {activeOnboarding.saving ? "Saving…" : "Continue with bank profile"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {widgetSession && expiredWidgetSession === widgetSessionKey ? (
                    <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                      The partner demo session expired. Continue with the standard demo setup below.
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    <label htmlFor={countrySelectId} className="text-sm font-medium">Country or region</label>
                    <select
                      id={countrySelectId}
                      value={activeForm.country}
                      onChange={(event) => updateForm({ country: event.target.value, otherCountry: "" })}
                      disabled={activeOnboarding.saving}
                      className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      <option value="">Select a country</option>
                      {countries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                      <option value="OTHER">Other (enter ISO2 code)</option>
                    </select>
                  </div>
                  {activeForm.country === "OTHER" ? (
                    <div className="space-y-2">
                      <label htmlFor={otherCountryId} className="text-sm font-medium">Two-letter ISO country code</label>
                      <Input
                        id={otherCountryId}
                        value={activeForm.otherCountry}
                        onChange={(event) => updateForm({ otherCountry: event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) })}
                        placeholder="e.g. JP"
                        autoComplete="off"
                        maxLength={2}
                        disabled={activeOnboarding.saving}
                        aria-describedby={`${otherCountryId}-hint`}
                      />
                      <p id={`${otherCountryId}-hint`} className="text-xs text-muted-foreground">Enter the ISO 3166-1 alpha-2 code.</p>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    <label htmlFor={adultId} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5">
                      <Checkbox
                        id={adultId}
                        checked={activeForm.adultAttested}
                        onCheckedChange={(checked) => updateForm({ adultAttested: checked === true })}
                        disabled={activeOnboarding.saving}
                        className="mt-0.5"
                      />
                      <span>I confirm that I am an adult.</span>
                    </label>
                    <label htmlFor={consentId} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5">
                      <Checkbox
                        id={consentId}
                        checked={activeForm.consentAccepted}
                        onCheckedChange={(checked) => updateForm({ consentAccepted: checked === true })}
                        disabled={activeOnboarding.saving}
                        className="mt-0.5"
                      />
                      <span>I understand this is mock-only, not real KYC or real-money eligibility, and I consent to storing the demo country and declarations.</span>
                    </label>
                  </div>
                  <StoredDataNote />
                  {activeOnboarding.error ? <p role="alert" className="text-sm text-destructive">{activeOnboarding.error}</p> : null}
                  <Button
                    className="w-full"
                    onClick={() => void submit()}
                    disabled={
                      activeOnboarding.saving ||
                      !activeForm.country ||
                      (activeForm.country === "OTHER" && !isIso2(activeForm.otherCountry.toUpperCase())) ||
                      !activeForm.adultAttested ||
                      !activeForm.consentAccepted
                    }
                  >
                    {activeOnboarding.saving ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
                    {activeOnboarding.saving ? "Saving…" : "Continue"}
                  </Button>
                </div>
              )}
            </>
          )}
          <p className="text-center text-xs leading-5 text-muted-foreground">
            No full name, date of birth, ID, passport, photo, or address is requested.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

function StoredDataNote() {
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      We store your country, adult attestation, mock-only acknowledgement, and demo-data consent. We also record the demo source, completion time, and partner reference when applicable.
    </p>
  );
}
