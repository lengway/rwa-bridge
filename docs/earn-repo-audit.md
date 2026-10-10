# Universal Earn Gateway — repository audit

Audit date: 2026-10-10 (Asia/Almaty)
Repository snapshot: `main` at `951b4ba fix: refine RWA demo copy`

This is a reconnaissance report only. No application source, configuration, or user-owned files were changed while preparing it.

## Snapshot and instructions

- `git status --short --branch` was clean relative to `main...origin/main` except for the pre-existing untracked [RWA_GATEWAY_DEVNET_FIRST.md](../RWA_GATEWAY_DEVNET_FIRST.md). Preserve it; it is a detailed Devnet RWA implementation specification, not an audit artifact.
- `UNIVERSAL_EARN_GATEWAY_SPEC.md` was not present anywhere below the repository root at audit time. The implementation team should add/adapt the supplied specification deliberately rather than assume that this untracked RWA document is the authoritative Universal Earn spec.
- [AGENTS.md](../AGENTS.md) requires reading the installed Next.js 16 documentation before changing Next code because the version has breaking changes. [CLAUDE.md](../CLAUDE.md) points back to that same instruction.
- The repository uses npm: [package-lock.json](../package-lock.json) is lockfile version 3 and [package.json](../package.json) defines all supported commands. The audit host used Node `v26.9.0` and npm `11.19.1`.

## Architecture map

| Area | Existing implementation | Integration implication |
| --- | --- | --- |
| Application shell | Next.js 16 App Router. [app/layout.tsx](../app/layout.tsx) loads market data; [app/(app)/layout.tsx](../app/(app)/layout.tsx) wraps signed-in views in [components/app/shell.tsx](../components/app/shell.tsx). | Earn is already a first-class tab at `/earn`; do not create a second app or navigation system. |
| Earn UI | [app/(app)/earn/page.tsx](../app/(app)/earn/page.tsx), [app/(app)/earn/[id]/page.tsx](../app/(app)/earn/%5Bid%5D/page.tsx), [components/app/earn-list-screen.tsx](../components/app/earn-list-screen.tsx), [components/app/earn-detail-screen.tsx](../components/app/earn-detail-screen.tsx), [components/app/invest-drawer.tsx](../components/app/invest-drawer.tsx), and [components/app/withdraw-drawer.tsx](../components/app/withdraw-drawer.tsx). | Reuse these cards, detail screen, drawers, pending states, and responsive shell. |
| Strategy/catalog domain | [lib/yields.ts](../lib/yields.ts) contains two `YieldStrategy` entries (`ondo-usdy`, `kz-bond-demo`). [lib/vaults.ts](../lib/vaults.ts) maps them to app-issued share mints and produces a quote/price. | This is the narrowest catalog extension point, but its current fields are too sparse for provider/network/mode/capability disclosure. |
| Market data | [lib/market-server.ts](../lib/market-server.ts), [lib/market-data.ts](../lib/market-data.ts), and [app/api/yields/route.ts](../app/api/yields/route.ts) fetch/cache live reference data. | Preserve source/as-of behavior. A live APY reference must not be represented as on-chain earned yield. |
| Client state | [components/providers.tsx](../components/providers.tsx) installs theme, market, app-store, auth, and Devnet providers. [lib/store.tsx](../lib/store.tsx), [lib/devnet-provider.tsx](../lib/devnet-provider.tsx), and [lib/useDevnet.ts](../lib/useDevnet.ts) refresh the on-chain portfolio. | Extend the existing provider/context response shape; avoid a parallel wallet or portfolio store. |
| Auth and wallet | Email OTP creates an HttpOnly signed session in [app/api/auth](../app/api/auth); [lib/useAuth.tsx](../lib/useAuth.tsx) exchanges it for a Crossmint JWT and loads/creates a Solana wallet. [app/api/me/session/route.ts](../app/api/me/session/route.ts) links the verified email to its wallet. | Crossmint is already optional through [lib/config.ts](../lib/config.ts). Do not store user private keys or replace the email/wallet bridge. |
| Legacy Devnet flows | [lib/solana-server.ts](../lib/solana-server.ts) owns the server mint authority. [app/api/devnet/invest/route.ts](../app/api/devnet/invest/route.ts) verifies a user-signed test-dollar transfer then mints an app share; [app/api/devnet/withdraw/route.ts](../app/api/devnet/withdraw/route.ts) verifies returned shares, pays test dollars, then burns shares. | This is a functioning Devnet-demo vault seam, not a verified deposit into Ondo/Kamino or another external yield protocol. |
| Direct RWA/Meteora demo | [lib/rwa-demo.ts](../lib/rwa-demo.ts), [lib/rwa-demo-config.ts](../lib/rwa-demo-config.ts), [lib/meteora-devnet.ts](../lib/meteora-devnet.ts), [app/api/demo](../app/api/demo), and [components/app/rwa-demo-drawer.tsx](../components/app/rwa-demo-drawer.tsx). | It already has a separate, session-bound direct Devnet swap path with Devnet genesis verification, atomic strings, quote expiry, transaction-message matching, and explicit disclosures. It is an asset-trading demo, not an Earn strategy. |
| State/persistence | [lib/devnet-ledger.ts](../lib/devnet-ledger.ts) stores auth challenges, wallet links, legacy activity, vault checkpoints, RWA quotes/orders, funding, and payouts in an atomically renamed JSON file. | Sufficient for one local/demo process; not a durable multi-instance financial-action store. |
| Deployment | [scripts/deploy.sh](../scripts/deploy.sh) pushes committed `HEAD`, builds on the VPS, and atomically repoints the app symlink. Runtime config and ledger live outside the checkout. | Keep deployments committed-only; do not make a demo feature depend on local untracked files. |

## Wallet and Devnet findings

1. The normal Earn flow sends a user-signed SPL transfer through the Crossmint wallet (`wallet.send(...)` in [components/app/invest-drawer.tsx](../components/app/invest-drawer.tsx) and [components/app/withdraw-drawer.tsx](../components/app/withdraw-drawer.tsx)). The server parses the confirmed transaction before minting or redeeming app-issued shares.
2. The dedicated RWA demo serializes a direct Meteora DLMM transaction server-side, sends it through the embedded wallet, and verifies the exact submitted transaction and token deltas before completion. Its public routes are under [app/api/demo](../app/api/demo); sensitive operations bind the request wallet to the authenticated session via [lib/rwa-demo-api.ts](../lib/rwa-demo-api.ts).
3. The RWA demo is intentionally fail-closed: it requires `SOLANA_CLUSTER=devnet`, an explicit RPC URL, configured public mints/pool, and a canonical Devnet genesis hash before quote, swap, or faucet operations. It is disabled in the current local environment because those `DEVNET_*` and enablement variables are absent.
4. The older [lib/solana-server.ts](../lib/solana-server.ts) defaults to the public Devnet RPC when unset, but it does not independently verify the RPC genesis hash before write operations. A non-Devnet `SOLANA_RPC_URL` therefore needs an explicit hard guard before any Universal Earn write path reuses this module.
5. A read-only RPC probe against the default endpoint passed: `https://api.devnet.solana.com` returned the expected Devnet genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

## API and script inventory

### Relevant API surfaces

- Auth/session: [app/api/auth](../app/api/auth) and [app/api/me/session/route.ts](../app/api/me/session/route.ts).
- Existing Earn/vault: [app/api/devnet/vaults/route.ts](../app/api/devnet/vaults/route.ts), [app/api/devnet/invest/route.ts](../app/api/devnet/invest/route.ts), [app/api/devnet/withdraw/route.ts](../app/api/devnet/withdraw/route.ts), [app/api/devnet/portfolio/route.ts](../app/api/devnet/portfolio/route.ts), and [app/api/yields/route.ts](../app/api/yields/route.ts).
- Existing test-money and optional rails: [app/api/devnet/faucet/route.ts](../app/api/devnet/faucet/route.ts), KZTE routes, Transak, MoonPay, and Crossmint on-ramp routes.
- RWA demo: `GET /api/demo/assets`, `POST /api/demo/funding`, `/api/demo/quotes`, `/api/demo/orders`, `/api/demo/orders/:id/transaction`, `/api/demo/orders/:id/confirm`, and `/api/demo/payouts`. They use atomic amount strings and typed order states.

### Scripts

- [scripts/setup-devnet.mjs](../scripts/setup-devnet.mjs) creates legacy demo mints/authority and writes to `.env.local`; it is a Devnet write operation.
- [scripts/bootstrap-rwa-demo.ts](../scripts/bootstrap-rwa-demo.ts) verifies Devnet, creates or reuses test mints/pool/LP position, and may write public IDs to a configured local config target. It is a Devnet write operation.
- [scripts/devnet-smoke.mjs](../scripts/devnet-smoke.mjs) requires a running local app and executes faucet, transfer, vault, asset, KZTE, and exchange transactions. It intentionally mutates Devnet.
- [scripts/screenshots.mjs](../scripts/screenshots.mjs) writes screenshot artifacts.
- [scripts/deploy.sh](../scripts/deploy.sh) pushes to GitHub and deploys to the VPS; it was not run.

## Configuration and secret posture

[.env.example](../.env.example) documents Crossmint, auth/mail, legacy demo-token, RWA-demo, provider, and SMTP configuration. `.env.local` is ignored by [.gitignore](../.gitignore), as are `.demo-*` authority/ledger files and `.secrets/` keypairs.

The local `.env.local` contains legacy Crossmint/auth/demo-token settings but does **not** contain `SOLANA_CLUSTER`, RWA-demo enablement flags, payer path, RWA/quote mint, or pool settings. Consequently, the existing direct Meteora RWA demo cannot be run locally without intentional setup. No secret values are recorded in this report.

The local `.env.local` is a regular file with mode `0644` while it contains server credentials and mint authority material. Restrict it to the account owner (for example, mode `0600`) before any shared-machine or production use. This report does not change its permissions.

## Baseline results

`node_modules` was initially absent. `npm ci --no-audit --no-fund` completed successfully (1,801 packages). npm emitted a React 19 peer-resolution warning and several deprecation notices; it did not alter tracked files.

| Command | Result | Notes |
| --- | --- | --- |
| `npm run lint` | PASS | ESLint exited 0. |
| `npm run typecheck` | PASS | `tsc --noEmit` exited 0. |
| `npm test` | PASS | 6/6 tests in [tests/rwa-demo.test.ts](../tests/rwa-demo.test.ts) passed. Coverage is focused on RWA-demo integer conversion, caps, state transitions, disclosure, and Devnet guard. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | PASS | Next.js 16.3.6 built all 53 pages/routes successfully. The build logged repeated non-fatal `bigint` native-binding fallback messages; pure JavaScript was used. |
| Read-only Devnet genesis probe | PASS | Default public RPC returned canonical Devnet genesis hash. |
| `node scripts/devnet-smoke.mjs` | NOT RUN | It needs a running app and intentionally creates Devnet transactions/mints/transfers. Running it would exceed a report-only audit and should be performed later with an explicitly configured test authority. |
| `npm run devnet:bootstrap` / `node scripts/setup-devnet.mjs` | NOT RUN | Both can create on-chain resources and/or mutate `.env.local`. |
| `scripts/deploy.sh` | NOT RUN | Pushes and deploys to production infrastructure. |

## Smallest safe integration plan

1. **Choose the provider only after feasibility research.** Do not present the existing `ondo-usdy` entry as a real Ondo deposit: [lib/vaults.ts](../lib/vaults.ts) calculates an app-side share price from an APY reference, and [lib/solana-server.ts](../lib/solana-server.ts) mints the shares. If no official, verified Devnet provider path exists, make this one first strategy an explicitly named **Devnet Demo Strategy**: real test-token transfers and share-token transactions, with **illustrative/simulated yield**.
2. **Extend, do not replace, the catalog.** Add provider/network/mode/availability/source/disclosure/withdrawal-capability metadata to [lib/yields.ts](../lib/yields.ts) (or one adjacent typed module). Keep the existing `YIELD_STRATEGIES` consumer path so `/earn`, home, portfolio, and activity remain connected.
3. **Use the current UI seam.** Adapt the Earn card/detail/drawer components listed above to render that metadata, clear `DEVNET DEMO`, `SIMULATED FUNDING`, `ILLUSTRATIVE YIELD`, and `NO MONETARY VALUE` copy, source/as-of information, unavailable/unsupported states, quote expiry, and a real pending/confirmed/retry lifecycle.
4. **Harden the write seam before broadening it.** Follow the RWA-demo pattern in [lib/rwa-demo-api.ts](../lib/rwa-demo-api.ts): derive the wallet from the verified session rather than trusting a body `walletAddress`; keep transaction confirmation server-side; add a canonical-Devnet RPC guard to any reused write module; keep mainnet writes disabled.
5. **Use integer/base-unit contracts for new work.** The RWA demo provides a tested model in [lib/rwa-demo.ts](../lib/rwa-demo.ts). The legacy Earn flow currently accepts `number` values and does arithmetic/rounding with JavaScript floats in [app/api/devnet/invest/route.ts](../app/api/devnet/invest/route.ts), [app/api/devnet/withdraw/route.ts](../app/api/devnet/withdraw/route.ts), and [lib/solana-server.ts](../lib/solana-server.ts); do not copy that pattern into the new provider contract.
6. **Keep persistence narrow and honest.** The JSON ledger is adequate for a single Devnet demo instance. If a feature needs concurrent production-grade idempotency, rate limits, or reconciliation, introduce a transactional shared store as a separate, reviewed change rather than pretending the in-process lock is distributed.
7. **Treat RWA swapping and earning as separate capabilities.** The direct Meteora demo is useful verified Devnet execution evidence, but should not be labelled a yield provider without a genuine yield mechanism.

## Risks and decision gates

| Priority | Risk / evidence | Required response |
| --- | --- | --- |
| Blocker for a real RWA swap demo | The local environment lacks all RWA-demo cluster/mint/pool/payer configuration; the demo correctly stays disabled. | Configure a dedicated Devnet-only payer, pool, and public IDs through the documented bootstrap process; do not substitute Mainnet or fake a completed transaction. |
| High | `.env.local` mode is `0644` despite containing secret material. | Restrict permissions and keep it ignored; never copy its values into source, reports, or client variables. |
| High | Legacy `solana-server` can use a non-Devnet RPC URL without a genesis-hash write guard. | Add a fail-closed canonical-Devnet guard before reusing it for the gateway. |
| High | Existing app-minted vUSDY/vKZGB shares and reference-rate pricing are not evidence of an external protocol deposit or accrued on-chain yield. | Name them demo/illustrative unless provider research proves a different integration. |
| High | [lib/devnet-ledger.ts](../lib/devnet-ledger.ts) uses a process-local mutex plus a JSON file. It cannot safely coordinate replicas, concurrent deploys, or durable financial operations. | Limit to one demo process or add shared transactional persistence before scaling. |
| Medium | Legacy Earn write routes accept the wallet address supplied in the request body, unlike the session-bound RWA routes. On-chain signature checks reduce abuse, but the authorization model is inconsistent. | Bind future gateway writes to the verified session wallet; test mismatch rejection. |
| Medium | Legacy Earn/value code uses floating-point UI amounts and derives share/payout amounts with `Math`/`Number`. | New contracts must use decimal strings/base units; migrate legacy paths only with focused compatibility tests. |
| Medium | The only automated tests are six RWA-domain unit tests. No route, wallet, UI, legacy vault, provider-failure, or browser integration test exists. | Add focused tests for strategy gating, stale quote, rejected/failed transaction, session-wallet mismatch, idempotency, no-mainnet writes, and disclosure copy. |
| Medium | `npm ci` reported a React peer-resolution warning and multiple transitive dependency deprecations; the build fell back to pure-JS bigint bindings. | Not a current build blocker, but track dependency upgrades separately and test wallet/Meteora behavior after upgrades. |
| Decision gate | No verified provider/deployment evidence is in this audit. | Wait for provider research before choosing Kamino/native staking/another protocol. Use the transparent Demo Strategy fallback if Devnet support cannot be proven. |

## Practical handoff

The existing product is not an empty scaffold: a narrow, coherent Earn integration can land in the current catalog, route handlers, Devnet context, and Earn UI without new framework or wallet dependencies. The safest first deliverable is one clearly labelled Devnet Demo Strategy with independently verifiable test-token transactions, while provider research decides whether any real Devnet yield protocol can replace that fallback.
