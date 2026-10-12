export function DemoBadge({ bank = false }: { bank?: boolean }) {
  return (
    <span
      aria-label={bank ? "Devnet · sample bank" : "Devnet"}
      className="fixed right-3 top-3 z-40 rounded-full border border-amber-500/30 bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur"
    >
      <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500" />
      Devnet
    </span>
  );
}
