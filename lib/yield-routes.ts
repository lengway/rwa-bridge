/**
 * Read-only USDC yield routes on Solana mainnet.
 *
 * These are NOT executable in Plain yet: deposits only run through Kamino Lend
 * on devnet. Each route shows a live APY fetched at request time from a public
 * source. If the source can't be reached or returns something unexpected, the
 * APY is null and the UI hides it — we never fall back to a hardcoded number.
 */

export type YieldRouteSource = Readonly<{
  label: string;
  url: string;
}>;

export type YieldRouteDefinition = Readonly<{
  id: string;
  protocol: string;
  market: string;
  asset: "USDC";
  network: "Solana Mainnet";
  protocolUrl: string;
  source: YieldRouteSource;
  fetchApyPercent: (fetcher: typeof fetch) => Promise<number | null>;
}>;

export type YieldRouteQuote = Readonly<{
  id: string;
  protocol: string;
  market: string;
  asset: "USDC";
  network: "Solana Mainnet";
  protocolUrl: string;
  status: "COMING_SOON";
  apyPercent: number | null;
  source: YieldRouteSource;
  fetchedAt: string;
}>;

const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAX_SANE_APY_PERCENT = 100;
const FETCH_TIMEOUT_MS = 6_000;

export function sanitizeApyPercent(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0 || n > MAX_SANE_APY_PERCENT) return null;
  return Math.round(n * 100) / 100;
}

/** Jupiter Lend earn token list: rates are in basis points. */
export function parseJupiterLendUsdcApy(payload: unknown): number | null {
  if (!Array.isArray(payload)) return null;
  const usdc = payload.find(
    (entry) =>
      entry
      && typeof entry === "object"
      && (entry as { assetAddress?: unknown }).assetAddress === MAINNET_USDC_MINT,
  ) as { totalRate?: unknown } | undefined;
  if (!usdc) return null;
  const bps = typeof usdc.totalRate === "string" ? Number(usdc.totalRate) : usdc.totalRate;
  if (typeof bps !== "number" || !Number.isFinite(bps)) return null;
  return sanitizeApyPercent(bps / 100);
}

/** DefiLlama pool chart: last data point carries the current APY in percent. */
export function parseDefiLlamaChartApy(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const { status, data } = payload as { status?: unknown; data?: unknown };
  if (status !== "success" || !Array.isArray(data) || data.length === 0) return null;
  const last = data[data.length - 1] as { apy?: unknown } | null;
  return sanitizeApyPercent(last?.apy);
}

async function fetchJson(fetcher: typeof fetch, url: string): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: 300 },
  } as RequestInit);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const JUPITER_LEND_TOKENS_URL = "https://lite-api.jup.ag/lend/v1/earn/tokens";
const SAVE_MAIN_POOL_USDC_LLAMA_POOL = "dde4c16c-504d-470b-9404-006287ce0906";

export const YIELD_ROUTES: readonly YieldRouteDefinition[] = [
  {
    id: "jupiter-lend-usdc",
    protocol: "Jupiter Lend",
    market: "Earn",
    asset: "USDC",
    network: "Solana Mainnet",
    protocolUrl: "https://jup.ag/lend/earn",
    source: { label: "Jupiter Lend API", url: JUPITER_LEND_TOKENS_URL },
    fetchApyPercent: async (fetcher) =>
      parseJupiterLendUsdcApy(await fetchJson(fetcher, JUPITER_LEND_TOKENS_URL)),
  },
  {
    id: "save-main-pool-usdc",
    protocol: "Save (ex-Solend)",
    market: "Main Pool",
    asset: "USDC",
    network: "Solana Mainnet",
    protocolUrl: "https://save.finance",
    source: {
      label: "DefiLlama Yields",
      url: `https://yields.llama.fi/chart/${SAVE_MAIN_POOL_USDC_LLAMA_POOL}`,
    },
    fetchApyPercent: async (fetcher) =>
      parseDefiLlamaChartApy(
        await fetchJson(fetcher, `https://yields.llama.fi/chart/${SAVE_MAIN_POOL_USDC_LLAMA_POOL}`),
      ),
  },
];

export async function quoteYieldRoutes(
  fetcher: typeof fetch = fetch,
  routes: readonly YieldRouteDefinition[] = YIELD_ROUTES,
  now: () => Date = () => new Date(),
): Promise<YieldRouteQuote[]> {
  return Promise.all(
    routes.map(async (route) => {
      let apyPercent: number | null = null;
      try {
        apyPercent = await route.fetchApyPercent(fetcher);
      } catch {
        apyPercent = null;
      }
      return {
        id: route.id,
        protocol: route.protocol,
        market: route.market,
        asset: route.asset,
        network: route.network,
        protocolUrl: route.protocolUrl,
        status: "COMING_SOON" as const,
        apyPercent,
        source: route.source,
        fetchedAt: now().toISOString(),
      };
    }),
  );
}
