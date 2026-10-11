export function DemoBadge({ bank = false }: { bank?: boolean }) {
  return (
    <details className="fixed right-3 top-3 z-40 text-xs">
      <summary className="cursor-pointer list-none rounded-full border border-amber-500/30 bg-background/95 px-3 py-1.5 font-medium text-foreground shadow-sm backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500" />Demo · Devnet
      </summary>
      <div className="absolute right-0 mt-2 w-[min(19rem,calc(100vw-2rem))] space-y-2 rounded-xl border bg-background p-4 text-foreground shadow-lg">
        <p className="font-semibold">Demo environment · Solana Devnet</p>
        <p className="leading-5 text-muted-foreground">Tokens and positions have no monetary value. Transactions require your wallet approval. Returns are variable, not guaranteed.</p>
        <p className="leading-5 text-muted-foreground">Account setup is mock only, not verified KYC. Real bank payments are not connected.</p>
        {bank ? <p className="leading-5 text-muted-foreground">Forma Bank is fictional. Bank balances, cards and activity are sample data, separate from your Plain wallet.</p> : null}
      </div>
    </details>
  );
}
