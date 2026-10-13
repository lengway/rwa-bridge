# Yield routes report (branch `claude/yield-routes`)

## Outcome

| Route | Network | Status in Plain | APY source |
|---|---|---|---|
| Kamino Lend USDC | Solana devnet | **Executable** (unchanged) | existing Kamino path |
| Jupiter Lend Earn USDC | Solana mainnet | Read-only, "Coming soon" | `https://lite-api.jup.ag/lend/v1/earn/tokens` (`totalRate` bps for mint `EPjF…Dt1v`) |
| Save (ex-Solend) Main Pool USDC | Solana mainnet | Read-only, "Coming soon" | DefiLlama Yields `https://yields.llama.fi/chart/dde4c16c-504d-470b-9404-006287ce0906` (latest point) |

No new executable route was added. On devnet, none of the candidates has a usable USDC market for the Circle mint (details below).

## What changed (all additive)

- `lib/yield-routes.ts`: route definitions, strict parsers for both APIs, and `quoteYieldRoutes()`. Each source is fetched at request time with a 6 s timeout and 300 s revalidate. A failed fetch, a non-OK HTTP status, a malformed payload, or a value that is non-finite, negative or above 100 % gives `apyPercent: null`. There is no fallback number.
- `app/api/earn/routes/route.ts`: `GET /api/earn/routes`. It is public, takes no input and is never executable.
- `components/app/yield-routes-section.tsx`: an "Other USDC routes" section that shows the live APY with a link to its source and a "Coming soon" badge. It shows "Live rate unavailable" if a source fails, and hides the whole section if the endpoint fails.
- `components/app/earn-list-screen.tsx`: two lines that mount the section under the Kamino card. Kamino stays first and is the default. No Kamino, auth or approval code was touched.
- `tests/yield-routes.test.ts`: 6 tests covering the parsers, sanitizing, the failure → null path, non-OK HTTP and the happy path. The suite went from 136 to 142 tests, all passing.

Checks: lint, `tsc --noEmit`, `npm test` (142/142) and `npm run build` are all green. A live smoke test of `quoteYieldRoutes()` returned Jupiter 5.76 % and Save 3.13 %, which matches the raw APIs at 2026-10-13 ~05:35 UTC.

## Devnet verification (queried, not assumed)

The checks were `getAccountInfo` on program IDs, plus `getProgramAccounts` with a memcmp filter on the Circle devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

- **marginfi v2** (`neetcne3…MVcBQ` devnet): the program is deployed, but there are 0 banks with the Circle USDC mint at offset 8.
- **Drift** (`dRiftyHA…cn33UH`): deployed, but spot market 0 uses Drift's own devnet USDC `8zGuJQqw…6PHe2`, not Circle's.
- **Save/Solend devnet** (`ALend7Ke…6aPLgx`): there are 2 reserves with the Circle USDC mint, `3zY6sisi…dCSq` and `AMfz4pxL…Sg2hx`. Both are abandoned:
  - last refreshed ~58M and ~372M slots ago
  - available liquidity is 2.99 USDC and 0.8 USDC
  - they use a legacy Pyth devnet oracle (`5SSkXsEK…gy7`), so `RefreshReserve` would almost certainly fail on staleness

  They are not a responsible executable route.
- **Solend mainnet program ID, marginfi mainnet ID, Jupiter Lend** (`jup3YeL8…`): not deployed on devnet.

## Left / next

1. An executable second route needs a devnet market that someone maintains for the Circle mint. The most realistic options are deploying a Plain-controlled Save/Kamino devnet market, or waiting for Jupiter Lend devnet. It would then go through the same Kamino bar: server-built instructions, intent validation, the Crossmint executor and a finalized receipt.
2. More read-only routes (e.g. marginfi, Drift) can be added once a stable public APY source is confirmed. The DefiLlama entries for those projects didn't come up in the quick scan.
3. After deploy, check that `GET /api/earn/routes` returns non-null `apyPercent` from Vercel's egress (both APIs are keyless).
