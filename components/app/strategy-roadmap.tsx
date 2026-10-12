import {
  STRATEGY_ROADMAP,
  type StrategyRoadmapEntry,
  type StrategyRoadmapGroup,
} from "@/lib/strategy-roadmap";

const GROUPS: readonly {
  id: StrategyRoadmapGroup;
  title: string;
  description: string;
}[] = [
  {
    id: "beginner",
    title: "Beginner",
    description:
      "Staking concepts with simpler position mechanics; exits still take time or depend on liquidity.",
  },
  {
    id: "advanced",
    title: "Advanced",
    description:
      "Positions with additional curator, market, liquidity, or price-range decisions.",
  },
];

export function StrategyRoadmap() {
  return (
    <section className="space-y-4" aria-labelledby="strategy-roadmap-title">
      <div className="space-y-1">
        <h2 id="strategy-roadmap-title" className="text-base font-semibold">
          More ways to earn
        </h2>
        <p className="text-xs leading-5 text-muted-foreground">
          Coming next. Open a strategy to see its network, risks and exit terms.
          Deposits are not enabled yet.
        </p>
      </div>

      <div className="space-y-5">
        {GROUPS.map((group) => {
          const entries = STRATEGY_ROADMAP.filter(
            (entry) => entry.group === group.id,
          );
          return (
            <div key={group.id} className="space-y-2">
              <div>
                <h3 className="text-sm font-medium">{group.title}</h3>
                <p className="text-xs leading-5 text-muted-foreground">
                  {group.description}
                </p>
              </div>
              <div className="space-y-2">
                {entries.map((entry) => (
                  <RoadmapCard key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RoadmapCard({ entry }: { entry: StrategyRoadmapEntry }) {
  return (
    <details className="group rounded-2xl border bg-card px-4 py-3">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 space-y-1">
          <span className="block font-medium">{entry.name}</span>
          <span className="block text-xs text-muted-foreground">
            {entry.token} · {entry.networks.join(" · ")}
          </span>
        </span>
        <span className="shrink-0 rounded-full border px-2 py-1 text-[10px] leading-none text-muted-foreground">
          {entry.networks.includes("Solana Devnet")
            ? "Coming soon"
            : "Mainnet only"}
        </span>
      </summary>
      <div className="mt-3 space-y-2 border-t pt-3 text-xs leading-5">
        <p>{entry.integrationStatus}</p>
        <p>
          <span className="font-medium">Risk · {entry.riskLevel}.</span>{" "}
          {entry.risk}
        </p>
        <p>
          <span className="font-medium">Withdrawal.</span> {entry.withdrawal}
        </p>
        <a
          className="inline-flex text-primary underline underline-offset-4"
          href={entry.sourceURL}
          target="_blank"
          rel="noreferrer"
        >
          Official product documentation
          <span className="sr-only"> for {entry.name}</span>
        </a>
      </div>
    </details>
  );
}
