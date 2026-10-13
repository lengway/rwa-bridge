import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  FileText,
  Fingerprint,
  Landmark,
  LockKeyhole,
  Mail,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { CopyAddressButton } from "@/components/site/copy-address-button";
import { SiteFooter, SiteHeader, primaryCta, secondaryCta } from "@/components/site/site-chrome";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const KAMINO_DEVNET_MARKET = "8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa";
const KAMINO_DEVNET_USDC_RESERVE = "8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn";
const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const KLEND_PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

const steps = [
  {
    icon: Mail,
    title: "Sign in with email",
    text: "Enter your email and a one-time code. No extension, no seed phrase, no new password.",
  },
  {
    icon: Wallet,
    title: "Get a smart wallet",
    text: "A Crossmint smart wallet on Solana is created for your account automatically.",
  },
  {
    icon: Landmark,
    title: "Supply USDC to Kamino Lend",
    text: "Choose an amount, review the checks and approve. Withdraw whenever the reserve has liquidity.",
  },
];

const trust = [
  {
    icon: Fingerprint,
    title: "Your wallet, your approval",
    text: "Every supply or withdrawal is approved from your smart wallet. Plain prepares and simulates the transaction; it cannot move funds on its own.",
  },
  {
    icon: ReceiptText,
    title: "Verifiable on-chain",
    text: "Each confirmed action links to Solana Explorer, together with the pinned Kamino market and reserve addresses below.",
  },
  {
    icon: ShieldCheck,
    title: "Network fees paid by Plain",
    text: "You do not need to hold SOL to use Kamino Lend through Plain. The transaction fee is sponsored for you.",
  },
  {
    icon: LockKeyhole,
    title: "Honest about the rate",
    text: "The rate is variable and set by the Kamino Lend protocol. Plain never shows a fixed APR or promises returns.",
  },
];

const faq = [
  {
    question: "What is Plain?",
    answer:
      "Plain is a yield layer that makes on-chain lending feel like a normal app. You sign in with email, Plain creates a smart wallet for you, and you can supply USDC to Kamino Lend on Solana in a few taps.",
  },
  {
    question: "Do I need a crypto wallet or a seed phrase?",
    answer:
      "No. A Crossmint smart wallet is created automatically when you sign in with your email. There is no browser extension to install and no seed phrase to write down.",
  },
  {
    question: "Where does the yield come from?",
    answer:
      "From Kamino Lend, a lending protocol on Solana. Borrowers pay interest to the USDC reserve and suppliers earn a share of it. The rate is variable, set by the protocol and not guaranteed.",
  },
  {
    question: "Do I pay network fees?",
    answer:
      "No. Plain pays the Solana network fee for Kamino Lend actions made through your smart wallet, so you do not need to hold SOL.",
  },
  {
    question: "Is this real money?",
    answer:
      "Not yet. Plain currently runs on Solana devnet with devnet USDC, which has no monetary value. It lets you try the full flow — sign-in, wallet, supply and withdraw — end to end.",
  },
  {
    question: "Which countries is Plain for?",
    answer:
      "Plain is built as a global layer between everyday finance apps and on-chain yield. Kazakhstan is the first market we are designing for, with more to follow.",
  },
  {
    question: "Can banks and fintech apps embed Plain?",
    answer:
      "Yes. Plain ships as an embeddable widget, so a partner app can offer Earn inside its own interface. You can see it running inside a fictional sample bank.",
  },
];

const addresses = [
  { label: "Kamino Lend program", value: KLEND_PROGRAM },
  { label: "Kamino Lend market", value: KAMINO_DEVNET_MARKET },
  { label: "USDC reserve", value: KAMINO_DEVNET_USDC_RESERVE },
  { label: "Devnet USDC mint", value: DEVNET_USDC_MINT },
];

function jsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/icon2`,
        sameAs: ["https://github.com/lengway/rwa-bridge"],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "WebApplication",
        "@id": `${SITE_URL}/#app`,
        name: SITE_NAME,
        url: `${SITE_URL}/home`,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        browserRequirements: "Requires JavaScript",
        description: SITE_DESCRIPTION,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${SITE_URL}/#faq`,
        mainEntity: faq.map(({ question, answer }) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: answer },
        })),
      },
    ],
  };
}

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Escape "<" so the JSON payload can never close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()).replace(/</g, "\\u003c") }}
      />
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="relative isolate overflow-hidden border-b">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_85%_0%,rgb(16_185_129/0.14),transparent_70%),radial-gradient(50%_50%_at_0%_100%,rgb(14_165_233/0.10),transparent_70%)]" />
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:px-8 lg:py-28">
            <div className="space-y-7">
              <p className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                Live on Solana devnet
              </p>
              <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                On-chain yield, as simple as your banking app.
              </h1>
              <p className="max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Plain is a Web2-simple layer over on-chain lending. Sign in with email, get a smart wallet automatically and put USDC to work in Kamino Lend — no seed phrase, no SOL for fees.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/home" className={primaryCta}>
                  Open the app <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <a href="#how-it-works" className={secondaryCta}>How it works</a>
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><Mail className="size-4" aria-hidden="true" /> Email sign-in</li>
                <li className="flex items-center gap-2"><Wallet className="size-4" aria-hidden="true" /> Crossmint smart wallet</li>
                <li className="flex items-center gap-2"><Landmark className="size-4" aria-hidden="true" /> Kamino Lend</li>
              </ul>
            </div>
            <HeroPreview />
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              id="how-it-works-title"
              eyebrow="How it works"
              title="From email to earning in three steps"
              description="Plain hides the wallet plumbing, not the facts. Every step is a real Solana transaction you can verify."
            />
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {steps.map(({ icon: Icon, title, text }, index) => (
                <li key={title} className="rounded-3xl border bg-card p-6 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                  <div className="flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-foreground"><Icon className="size-5" aria-hidden="true" /></span>
                    <span className="font-mono text-xs text-muted-foreground" aria-hidden="true">0{index + 1}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="security" aria-labelledby="security-title" className="scroll-mt-20 border-y bg-muted/40 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <SectionHeading
              id="security-title"
              eyebrow="Security & transparency"
              title="Built so you can check, not just trust"
              description="Plain is non-custodial by design: the server prepares transactions, your smart wallet approves them."
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {trust.map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex gap-4 rounded-3xl border bg-card p-6">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"><Icon className="size-5" aria-hidden="true" /></span>
                  <div>
                    <h3 className="font-semibold tracking-tight">{title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{text}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-10 overflow-hidden rounded-3xl border bg-card">
              <div className="flex flex-col gap-1 border-b px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="font-semibold tracking-tight">Pinned addresses · Solana devnet</h3>
                <p className="text-sm text-muted-foreground">Open any address in Solana Explorer.</p>
              </div>
              <ul className="divide-y">
                {addresses.map(({ label, value }) => (
                  <li key={label} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground" title={value}>{value}</p>
                    </div>
                    <div className="flex gap-2">
                      <CopyAddressButton address={value} label={label} />
                      <a
                        href={`https://explorer.solana.com/address/${value}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        Explorer <ArrowUpRight className="size-4" aria-hidden="true" />
                        <span className="sr-only">: {label} (opens in a new tab)</span>
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="partners" aria-labelledby="partners-title" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 rounded-[2rem] border bg-card p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">For banks and fintech apps</p>
                <h2 id="partners-title" className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Plain, inside your app.</h2>
                <p className="max-w-2xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  Plain is a yield layer partners can embed: one script, one iframe, your interface around it. See Earn running inside a fictional sample bank — account balances stay separate from the user&apos;s wallet.
                </p>
              </div>
              <Link href="/widget-demo" className={secondaryCta}>
                <Building2 className="size-4" aria-hidden="true" /> See the bank embed
              </Link>
            </div>
          </div>
        </section>

        <section id="issuers" aria-labelledby="issuers-title" className="scroll-mt-20 border-t py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 rounded-[2rem] border bg-card p-6 sm:p-10 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">For issuers</p>
                <h2 id="issuers-title" className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Bond lifecycle on Solana.</h2>
                <p className="max-w-2xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  Yield needs instruments that are serviced end to end. Run a tokenized bond through issuance, record date, coupon, buyback and redemption on devnet, with every step verifiable on Solana Explorer.
                </p>
              </div>
              <Link href="/kase" className={secondaryCta}>
                <FileText className="size-4" aria-hidden="true" /> Explore corporate actions
              </Link>
            </div>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t bg-muted/40 py-16 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <SectionHeading
              id="faq-title"
              eyebrow="FAQ"
              title="Questions, answered plainly"
              description="Short answers about how Plain works today."
            />
            <div className="space-y-3">
              {faq.map(({ question, answer }) => (
                <details key={question} className="group rounded-2xl border bg-card transition-colors hover:border-foreground/20">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-5 font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                    <h3 className="text-base">{question}</h3>
                    <span aria-hidden="true" className="relative size-4 shrink-0 text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-current after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-current after:transition-transform group-open:after:rotate-90 motion-reduce:after:transition-none" />
                  </summary>
                  <p className="px-5 pb-5 text-sm leading-6 text-muted-foreground">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="relative isolate overflow-hidden rounded-[2rem] bg-primary px-6 py-12 text-primary-foreground sm:px-12 sm:py-16">
              <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 -z-10 size-72 rounded-full bg-emerald-400/20 blur-3xl" />
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-3">
                  <h2 id="cta-title" className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Try the whole flow in a minute.</h2>
                  <p className="max-w-xl text-pretty text-sm leading-6 text-primary-foreground/75 sm:text-base">Sign in with email, get your smart wallet and supply devnet USDC to Kamino Lend. Devnet funds have no monetary value.</p>
                </div>
                <Link href="/home" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary-foreground px-6 text-sm font-medium text-primary transition-[opacity,transform] hover:opacity-90 active:translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary-foreground/50 motion-reduce:transition-none">
                  Get started <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function HeroPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-md motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-700 lg:max-w-none">
      <div aria-hidden="true" className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-gradient-to-br from-emerald-500/15 via-transparent to-sky-500/15 blur-2xl" />
      <div className="rounded-[2rem] border bg-card p-5 shadow-xl sm:p-6" aria-hidden="true">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground">P</span>
            <div>
              <p className="text-sm font-semibold">Kamino Lend</p>
              <p className="text-xs text-muted-foreground">USDC reserve · Solana</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">Variable rate</span>
        </div>
        <div className="mt-6 rounded-2xl bg-muted/60 p-4">
          <p className="text-xs text-muted-foreground">You supply</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight">1.00 <span className="text-lg text-muted-foreground">USDC</span></p>
          <p className="mt-1 text-xs text-muted-foreground">You receive cUSDC representing your position</p>
        </div>
        <ul className="mt-4 space-y-2.5 text-sm">
          {[
            ["Wallet", "Crossmint smart wallet"],
            ["Network fee", "Paid by Plain"],
            ["Approval", "Your wallet"],
          ].map(([label, value]) => (
            <li key={label} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex h-11 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground">Supply USDC</div>
      </div>
      <figcaption className="sr-only">Preview of supplying USDC to Kamino Lend in Plain: smart wallet, network fee paid by Plain, approval from your wallet.</figcaption>
    </figure>
  );
}

function SectionHeading({ id, eyebrow, title, description }: { id: string; eyebrow: string; title: string; description: string }) {
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
      <h2 id={id} className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      <p className="text-pretty text-base leading-7 text-muted-foreground">{description}</p>
    </div>
  );
}
