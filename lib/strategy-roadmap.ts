export type StrategyRoadmapGroup = "beginner" | "advanced";
export type StrategyRoadmapNetwork = "Solana Devnet" | "Solana Mainnet";
export type StrategyRoadmapRiskLevel = "Moderate" | "High" | "Very high";

export type StrategyRoadmapEntry = {
  id: string;
  name: string;
  group: StrategyRoadmapGroup;
  token: string;
  networks: readonly StrategyRoadmapNetwork[];
  riskLevel: StrategyRoadmapRiskLevel;
  risk: string;
  withdrawal: string;
  integrationStatus: string;
  sourceURL: string;
  /** This roadmap is informational. None of its entries can create a transaction. */
  executable: false;
};

/** Researched strategy concepts; this catalog is deliberately disconnected from execution. */
export const STRATEGY_ROADMAP: readonly StrategyRoadmapEntry[] = [
  {
    id: "native-sol-staking",
    name: "Native SOL staking",
    group: "beginner",
    token: "SOL",
    networks: ["Solana Devnet", "Solana Mainnet"],
    riskLevel: "Moderate",
    risk: "Validator performance and commission affect rewards. Stake remains delegated until deactivation completes; Solana does not currently implement in-protocol slashing.",
    withdrawal:
      "Deactivate the stake, wait for the epoch cooldown (duration can vary with network stake changes), then withdraw. This is not an instant exit.",
    integrationStatus:
      "Integration pending on Devnet; no deposits or withdrawals are enabled here.",
    sourceURL: "https://solana.com/docs/references/staking",
    executable: false,
  },
  {
    id: "marinade-msol",
    name: "Marinade liquid staking",
    group: "beginner",
    token: "SOL in; mSOL receipt out",
    networks: ["Solana Devnet", "Solana Mainnet"],
    riskLevel: "High",
    risk: "mSOL is a protocol-issued liquid staking token. Risks include smart-contract and stake-pool operation risk, plus mSOL/SOL market-price and liquidity differences when exiting through a swap.",
    withdrawal:
      "A swap can exit at the available market quote and may incur price impact. Delayed unstake burns mSOL and requires a later claim after the protocol’s epoch-based unlock; timing depends on when it is started.",
    integrationStatus:
      "Integration pending on Devnet; program and mint availability do not mean this app has a verified deposit/withdrawal roundtrip.",
    sourceURL:
      "https://docs.marinade.finance/marinade-protocol/protocol-overview/marinade-liquid/what-is-msol",
    executable: false,
  },
  {
    id: "jito-jitosol",
    name: "JitoSOL liquid staking",
    group: "advanced",
    token: "SOL in; JitoSOL receipt out",
    networks: ["Solana Mainnet"],
    riskLevel: "High",
    risk: "Liquid-staking protocol and validator-pool risks apply. Trading JitoSOL for SOL depends on market liquidity and price; a receipt token is not the same as immediately withdrawable SOL.",
    withdrawal:
      "A market swap may provide a faster exit at a quoted price. Direct unstaking requires a Solana epoch cooldown and a separate claim/withdrawal step.",
    integrationStatus: "Mainnet product; not available in this Devnet app.",
    sourceURL:
      "https://www.jito.network/docs/jitosol/get-started/unstaking-jitosol-flow/unstaking-overview/",
    executable: false,
  },
  {
    id: "kamino-curated-usdc-vaults",
    name: "Kamino curated USDC vaults",
    group: "advanced",
    token: "USDC",
    networks: ["Solana Mainnet"],
    riskLevel: "High",
    risk: "A curator sets reserve allocations, caps, fees, and risk parameters. Depositors take smart-contract, lending-market, curator, and reserve-liquidity risks; review the specific vault and curator before use.",
    withdrawal:
      "Vaults may use an unallocated buffer or a queued exit depending on their configuration and available reserve liquidity. Exit timing is vault-specific; it should not be assumed to be instant.",
    integrationStatus: "Mainnet product; not available in this Devnet app.",
    sourceURL: "https://kamino.com/docs/curators/vaults",
    executable: false,
  },
  {
    id: "meteora-liquidity",
    name: "Meteora liquidity positions",
    group: "advanced",
    token: "A selected token pair (pool-specific)",
    networks: ["Solana Mainnet"],
    riskLevel: "Very high",
    risk: "Pool choice and price-range selection matter. Token prices can move apart, creating impermanent loss; concentrated positions can become inactive outside their selected range, while fees and pool liquidity vary.",
    withdrawal:
      "Liquidity can be removed from a position, but its token mix depends on pool prices and position range. Converting to a desired token may require a separate swap and available liquidity.",
    integrationStatus: "Mainnet product; not available in this Devnet app.",
    sourceURL:
      "https://docs.meteora.ag/user-guides/becoming-a-liquidity-provider",
    executable: false,
  },
];
