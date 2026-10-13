"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-16">
      <title>Something went wrong · Plain</title>
      <div role="alert" className="w-full max-w-md space-y-6 rounded-[2rem] border bg-card p-8 text-center shadow-sm sm:p-10">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">P</span>
          Plain
        </Link>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          This page couldn&apos;t load. Your wallet and positions are not affected — try again, or go back to the start.
        </p>
        {error.digest ? <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button type="button" onClick={() => retry()} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-[background-color,transform] hover:bg-primary/85 active:translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <RotateCcw className="size-4" aria-hidden="true" /> Try again
          </button>
          <Link href="/" className="inline-flex h-11 items-center justify-center rounded-full border bg-background px-6 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            Back to Plain
          </Link>
        </div>
      </div>
    </main>
  );
}
