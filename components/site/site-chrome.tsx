import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const primaryCta =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-[background-color,transform,box-shadow] duration-200 hover:bg-primary/85 hover:shadow-md active:translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none";
export const secondaryCta =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border bg-background px-6 text-sm font-medium transition-[background-color,transform] duration-200 hover:bg-muted active:translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none";

const sectionLinks = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#security", label: "Security" },
  { href: "/#partners", label: "For partners" },
  { href: "/#faq", label: "FAQ" },
];

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 rounded-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}>
      <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">P</span>
      <span>Plain</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <BrandMark />
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1 text-sm text-muted-foreground">
            {sectionLinks.map(({ href, label }) => (
              <li key={href}>
                <Link href={href} className="rounded-full px-3 py-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">{label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link href="/home" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-primary/85 active:translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none">
          Open app <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="space-y-3">
          <BrandMark />
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            A Web2-simple yield layer on Solana. Live on devnet; devnet USDC has no monetary value.
          </p>
        </div>
        <nav aria-label="Product">
          <h2 className="text-sm font-semibold">Product</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {sectionLinks.map(({ href, label }) => (
              <li key={href}><Link href={href} className="transition-colors hover:text-foreground">{label}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Get started">
          <h2 className="text-sm font-semibold">Get started</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li><Link href="/home" className="transition-colors hover:text-foreground">Open the app</Link></li>
            <li><Link href="/widget-demo" className="transition-colors hover:text-foreground">Bank embed</Link></li>
            <li><a href="https://github.com/lengway/rwa-bridge" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">Source on GitHub</a></li>
          </ul>
        </nav>
      </div>
      <div className="border-t">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs leading-5 text-muted-foreground sm:px-6 lg:px-8">
          © {new Date().getFullYear()} Plain · Not a bank deposit. Returns are variable and not guaranteed. Not investment advice.
        </p>
      </div>
    </footer>
  );
}
