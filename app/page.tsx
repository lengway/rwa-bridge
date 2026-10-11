"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, ChartNoAxesCombined, CircleHelp, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type KaminoMarketStatus = {
  ready?: boolean;
  network?: string;
  market?: { address?: string; name?: string };
  reserve?: { address?: string; mint?: string; symbol?: string };
};

const KAMINO_DEVNET_MARKET = "8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa";
const KAMINO_DEVNET_USDC_RESERVE = "8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const questions = [
  { question: "How do I sign in?", answer: "Enter your email. A Solana wallet is created automatically." },
  { question: "How do I supply to Kamino Lend?", answer: "Choose an amount of Devnet USDC. The app prepares and checks the route; only your wallet can sign the transaction on Solana Devnet." },
  { question: "What rate applies?", answer: "The rate is set by the Kamino Lend protocol and may change. It is not a yield guarantee or a fixed APR." },
  { question: "Where can I verify activity?", answer: "After the transaction is confirmed, you can view it, the market, and the reserve in Solana Explorer." },
  { question: "Is this a financial product?", answer: "No. This is Solana Devnet: Devnet USDC and positions have no monetary value." },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-muted/40">
      <div className="mx-auto max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">Plain</Link>
        </header>

        <section className="grid gap-8 py-12 sm:grid-cols-[1.2fr_0.8fr] sm:items-center sm:py-20">
          <div className="space-y-6">
            <div className="space-y-4">
              <Badge variant="secondary">SOLANA DEVNET · Universal Earn Gateway</Badge>
              <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
                Kamino Lend on Solana Devnet
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Sign in with email, get an automatically created Solana wallet, and sign on-chain transactions yourself. The Kamino Lend route runs on Devnet, where the protocol rate can change.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" nativeButton={false} render={<Link href="/home" />}>
                Open app <ArrowRight />
              </Button>
              <Button variant="outline" size="lg" nativeButton={false} render={<Link href="/earn" />}>
                View Devnet strategy
              </Button>
            </div>
          </div>

          <Card className="gap-4 rounded-3xl p-5 sm:p-7">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Devnet status</span>
              <ChartNoAxesCombined className="size-4 text-emerald-700 dark:text-emerald-400" />
            </div>
            <div className="grid gap-3">
              <ProductMetric label="Route" value="KAMINO LEND · USER-SIGNED" />
              <ProductMetric label="Rate" value="VARIABLE PROTOCOL RATE" />
              <ProductMetric label="Environment" value="DEVNET · NO MONETARY VALUE" />
            </div>
          </Card>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="How it works" title="Your Kamino Lend flow" description="Sign in with email, get an automatically created Solana wallet, and verify your confirmed on-chain transaction." />
          <div className="grid gap-3 sm:grid-cols-3">
            <ValueCard icon={<ShieldCheck />} title="Sign in with email" text="A Solana wallet is created automatically; no seed phrase is needed." />
            <ValueCard icon={<ChartNoAxesCombined />} title="Get Devnet USDC" text="You also need SOL on Solana Devnet for transaction fees. No bank card, KZT transfer, or fiat payment is involved." />
            <ValueCard icon={<Building2 />} title="Sign the transaction" text="The app checks the market and reserve, then your wallet signs a supply or withdrawal on Kamino Lend." />
          </div>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="Strategy" title="One verifiable Devnet route" description="Kamino Lend uses a pinned market and reserve. Bank, KZT, and off-ramp transactions are not part of this route." />
          <div className="grid gap-3 sm:grid-cols-1">
            <ProductCard title="Kamino Lend" ticker="DEVNET USDC" label="SOLANA DEVNET" detail="User-signed on-chain supply and withdrawal in a pinned Kamino Lend reserve. The protocol rate can change; Devnet USDC has no monetary value." href="/earn/kamino-lend" />
          </div>
        </section>

        <NetworkAssets />

        <section className="my-8 grid gap-5 rounded-3xl border bg-card p-6 sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
          <div className="space-y-2">
            <Badge variant="secondary">Integration status</Badge>
            <h2 className="text-2xl font-semibold tracking-tight">Kamino Lend Devnet connected</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">The app builds and simulates a transaction for the pinned Kamino Lend market. Only your wallet signs and submits it. Bank, KZT, and off-ramp transactions are not part of this route.</p>
          </div>
          <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/earn" />}>View Devnet strategy <ArrowRight /></Button>
        </section>

        <section className="space-y-5 py-8">
          <SectionHeading eyebrow="FAQs" title="Frequently asked questions" description="Key information about products and transactions." />
          <div className="space-y-2">
            {questions.map(({ question, answer }) => (
              <Collapsible key={question}>
                <Card className="rounded-2xl p-0">
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left font-medium">
                    <span>{question}</span><CircleHelp className="size-4 text-muted-foreground" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-4 py-3 text-sm leading-5 text-muted-foreground">{answer}</CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        </section>

        <section className="my-8 flex flex-col gap-4 rounded-3xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="text-xl font-semibold">Open the app</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sign in with email and explore the Solana Devnet route. It has no monetary value.</p>
          </div>
          <Button size="lg" nativeButton={false} render={<Link href="/home" />}>Get started <ArrowRight /></Button>
        </section>

        <footer className="border-t py-5 text-xs leading-5 text-muted-foreground">
          Solana Devnet only. NO MONETARY VALUE. Not investment advice.
        </footer>
      </div>
    </main>
  );
}

function NetworkAssets() {
  const [status, setStatus] = useState<KaminoMarketStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/kamino/market", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<KaminoMarketStatus> : null)
      .then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
      })
      .catch(() => {
        if (active) setStatus(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const addresses = [
    { label: "Kamino Lend market", ticker: "SOLANA DEVNET", address: status?.market?.address ?? KAMINO_DEVNET_MARKET },
    { label: "Kamino Lend reserve", ticker: status?.reserve?.symbol ?? "DEVNET USDC", address: status?.reserve?.address ?? KAMINO_DEVNET_USDC_RESERVE },
    { label: "Devnet USDC mint", ticker: "DEVNET USDC", address: status?.reserve?.mint ?? DEVNET_USDC_MINT },
  ];

  return (
    <section className="space-y-5 py-8">
      <SectionHeading eyebrow="Verifiable infrastructure" title="Kamino Lend · Solana Devnet" description="Pinned market, reserve, and Devnet USDC mint addresses. View each on Solana Explorer." />
      <Card className="divide-y rounded-2xl p-0">
        {addresses.map((item) => <NetworkAddressRow key={item.label} {...item} loading={loading} />)}
      </Card>
      {!loading ? <p className="text-xs text-muted-foreground">{status?.ready ? "The server checks the route before preparing each transaction." : "The server checks route availability before preparing a transaction."}</p> : null}
    </section>
  );
}

function NetworkAddressRow({ label, ticker, address, loading }: { label: string; ticker: string; address?: string | null; loading: boolean }) {
  const shortAddress = address ? `${address.slice(0, 7)}…${address.slice(-6)}` : null;
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy address");
    }
  };

  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{ticker} · {loading ? "Loading address…" : shortAddress ?? "Not configured yet"}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={copy} disabled={!address} aria-label={`Copy ${ticker}`}><Copy />Copy</Button>
        {address ? <Button variant="ghost" size="sm" nativeButton={false} render={<a href={`https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`} target="_blank" rel="noopener noreferrer" />}><ExternalLink />Explorer</Button> : null}
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="space-y-1"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</p><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><p className="max-w-2xl text-sm leading-5 text-muted-foreground">{description}</p></div>;
}

function ValueCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <Card className="gap-3 rounded-2xl p-5"><span className="flex size-10 items-center justify-center rounded-full bg-muted [&_svg]:size-5">{icon}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{text}</p></div></Card>;
}

function ProductMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function ProductCard({ title, ticker, label, detail, href }: { title: string; ticker: string; label: string; detail: string; href: string }) {
  return (
    <Card className="h-full gap-3 rounded-2xl p-5 transition-colors hover:bg-muted/40">
      <Link href={href} className="block flex-1 space-y-3"><Badge variant="secondary" className="w-fit">{label}</Badge><h3 className="font-semibold">{title}</h3><p className="text-xs font-medium text-muted-foreground">{ticker}</p><p className="text-sm leading-5 text-muted-foreground">{detail}</p><span className="inline-flex items-center gap-1 text-sm font-medium">Learn more <ArrowRight className="size-4" /></span></Link>
    </Card>
  );
}
