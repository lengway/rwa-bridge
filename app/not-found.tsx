import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark, primaryCta, secondaryCta } from "@/components/site/site-chrome";
import { noIndexMetadata } from "@/lib/noindex";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: "Page not found",
  description: "This page does not exist on Plain.",
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-16">
      <div className="w-full max-w-md space-y-6 rounded-[2rem] border bg-card p-8 text-center shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 sm:p-10">
        <BrandMark className="justify-center" />
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="text-sm leading-6 text-muted-foreground">The link may be outdated or mistyped. Head back to the start or open the app.</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/" className={secondaryCta}><ArrowLeft className="size-4" aria-hidden="true" /> Back to Plain</Link>
          <Link href="/home" className={primaryCta}>Open the app</Link>
        </div>
      </div>
    </main>
  );
}
