# Universal Earn Gateway — implementation report

**Status:** completed Devnet-first implementation
**Date:** 2026-10-10 (Asia/Almaty)
**Scope:** the existing Plain Next.js application; no replacement application,
new wallet stack, provider SDK, Mainnet action, or production deployment.

## Outcome

The application now exposes one public Earn strategy: **Devnet Demo Strategy**.
It is an application-controlled Solana Devnet test-token/share demonstration,
not a Kamino, Ondo, KASE, bank, staking, KZT, or RWA-provider position.

The actual chain boundary is deliberately narrow:

1. With an explicitly configured staging wallet and canonical Devnet RPC, a
   user can sign a transfer of the configured test quote token to the demo
   treasury.
2. The server verifies the confirmed transfer, records a durable pre-mint
   action, then mints an app-controlled demo share one-for-one.
3. On exit, the server verifies the returned demo-share transfer, records a
   durable pre-payout action, returns the matching Devnet test token, burns the
   share, and records both signatures.

ILLUSTRATIVE YIELD has no numeric APY in this delivery and never changes the
fixed redemption amount. Fiat funding and payout remain SIMULATED; all test
assets and records have NO MONETARY VALUE.

## Repository architecture discovered

| Area | Existing seam retained | Gateway change |
| --- | --- | --- |
| App/UI | Next.js 16 App Router and the existing /earn tab, drawers, shell, and responsive components | Reworked the existing Earn cards, detail view, deposit/exit drawers, home, portfolio, and disclosure components instead of creating a detached app. |
| Wallet | Existing email session and Crossmint wallet bridge | The browser is given a transfer-ready mint/treasury only when it has a staging wallet key, explicit SOLANA_CLUSTER=devnet, and a canonical Devnet RPC check. |
| Earn routes | Existing Devnet invest and withdraw routes | Replaced new-flow numeric inputs with canonical decimal/atomic-string accounting, session-wallet binding, confirmation checks, explicit action states, and safe retry behavior. |
| Server signer | Existing test authority helpers | Added canonical Devnet-genesis validation immediately before every legacy signer operation; Mainnet/non-Devnet writes fail closed. |
| Persistence | Existing atomically-renamed local JSON Devnet ledger | Added action status/signature fields for deposit/withdraw reconciliation. It remains intentionally single-process demo persistence. |
| Provider catalog | Existing yield and vault mappings | Added lib/earn-gateway.ts: normalized strategy, position, funding/yield-provider interfaces, capability gates, disclosures, operation/quote states, and exact amount helpers. |

The reconnaissance baseline, file map, and original risks are in
[earn-repo-audit.md](earn-repo-audit.md). The pre-existing untracked
RWA_GATEWAY_DEVNET_FIRST.md was preserved and was not adopted as this
gateway's specification.

## Team workstreams

| Workstream | Deliverable |
| --- | --- |
| Repository reconnaissance | docs/earn-repo-audit.md, baseline command results, architecture map, and safe integration seams. |
| Provider feasibility | docs/earn-provider-research.md, including official sources, a read-only Devnet probe, Kamino/native-stake decision gate, and regional/eligibility boundaries. |
| Earn UI | Existing Earn screens/drawers wired to the normalized catalog with supported, pending, error, unavailable, and redemption-only states. |
| Earn domain/chain | lib/earn-gateway.ts, exact base-unit conversion, fixed redemption rules, ledger action states, selected API routes, and focused tests. |
| Devnet guard | Canonical Devnet checks in signer helpers, legacy scripts, and browser readiness/status handling. |
| Legacy adapters | Fail-closed server gate for retained Crossmint/card/Transak/MoonPay/KZT/KZTE paths. |
| Security review | docs/earn-security-review.md, reviewed findings, implementation follow-up, and residual deployment limitations. |
| Integration | Conflict resolution, legacy-copy cleanup, final checks, and this report. |

## Research decision and evidence

**Selected first strategy:** SIMULATED_DEMO / Devnet Demo Strategy.

Kamino Devnet program deployment was verified read-only, but no exact public,
supported, liquid Devnet market or vault with a compatible end-user
deposit-and-withdraw route was proven. Native SOL staking is feasible later but
its activation/deactivation is epoch-bound and cannot truthfully be marketed as
an instant exit. The application-controlled Devnet token/share path was the
only route that could be completed safely without pretending to integrate an
unverified provider.

Official sources were checked on **2026-10-10** and are recorded with
evidence and unresolved questions in [earn-provider-research.md](earn-provider-research.md):

- [Kamino KLend deployment README](https://github.com/Kamino-Finance/klend/blob/master/README.md)
  and [KLend SDK Devnet environment](https://github.com/Kamino-Finance/klend-sdk/blob/3c3a38d4ff9d7cf7b0380a383b81c9cd4f0f58b8/src/client/tx/CliEnv.ts).
- [Kamino KVault deposit](https://github.com/Kamino-Finance/klend-sdk/blob/master/examples/kvault-tutorial/earn-vaults-04-user-deposit-example/index.ts)
  and [withdraw](https://github.com/Kamino-Finance/klend-sdk/blob/master/examples/kvault-tutorial/earn-vaults-05-user-withdraw-example/index.ts)
  examples, which point to Mainnet and therefore were not treated as Devnet
  product evidence.
- [Solana Devnet clusters](https://solana.com/docs/references/clusters) and
  [stake-account lifecycle](https://solana.com/docs/references/staking/stake-accounts).
- [Crossmint staging versus production](https://docs.crossmint.com/introduction/platform/staging-vs-production),
  [supported chains](https://docs.crossmint.com/introduction/supported-chains),
  and [production-access requirements](https://help.crossmint.com/articles/2804023362-how-do-i-get-production-access-to-crossmint).

A bounded read-only RPC probe confirmed the public Devnet genesis hash
EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG and observed executable
Kamino KLend/KVault program accounts. It did **not** construct, simulate, sign,
or send a Kamino instruction.

## Implementation details

### Strategy and provider contract

- lib/earn-gateway.ts exports the one-enabled catalog plus disabled Kamino and
  native-staking placeholders. Historic KZT-labelled demo shares are
  REDEMPTION_ONLY, not discoverable as a new deposit opportunity.
- Metadata is explicit for source, network, mode, availability, capabilities,
  funding, payout, yield, and required disclosures. The read-only
  /api/earn/strategies endpoint returns that catalog without an execution
  surface.
- EarnPosition, YieldProvider, FundingProvider, and wallet-capability
  contracts use JSON-safe atomic strings. The simulated adapters return
  capability gates, so a placeholder cannot silently become executable.
- Canonical decimal strings are converted to bigint base units; floats,
  scientific notation, ambiguous formatting, excess precision, and malformed
  atomic strings fail closed.

### UI

- /earn remains in the existing navigation and presents the single Devnet demo
  instead of an unsupported provider card.
- Deposit, exit, home, portfolio, activity, and test-asset surfaces clearly
  label DEVNET DEMO, SIMULATED FUNDING, ILLUSTRATIVE YIELD, and NO MONETARY
  VALUE where applicable.
- There is no numeric APY claim when the selected strategy has no
  provider-derived metric. Historic positions can exit but cannot accept new
  deposits.
- Card/KZT/KZTE/on-off-ramp controls are unavailable by default. Retained
  legacy adapter UI requires an explicit public flag, while its server routes
  require a separate server flag and still do not establish provider or regional
  availability.
- The optional legacy test issuer is visibly unavailable by default rather than
  pretending an enabled faucet or fiat top-up exists.

### Backend and safety controls

- The Devnet invest route accepts only a canonical decimal amount, checks the
  session wallet, verifies the exact confirmed inbound test-token transfer, and
  persists MINT_PENDING before minting. Any ambiguous
  submission/persistence result becomes NEEDS_REVIEW; a retry cannot mint
  another share.
- The Devnet withdraw route accepts only a sharesAtomic string, verifies the
  exact returned-share transfer, persists PAYOUT_PENDING before the test-token
  payout, then records BURN_PENDING before burning. Ambiguous work is
  fail-closed for reconciliation.
- lib/solana-server.ts checks both the declared cluster and the RPC genesis
  hash before every server-controlled mint, transfer, burn, ATA creation, or
  fee-SOL transfer. The Earn routes make that check before parsing an action.
- The Devnet status route withholds mints/treasury from browser transfer
  controls unless it sees an explicit Devnet target, canonical Devnet RPC,
  configured test assets, and a ck_staging_ Crossmint client key. This prevents
  a production-wallet misconfiguration from prompting a user transfer before a
  later server guard can reject it.
- Legacy fiat/provider endpoints respond with typed 503
  LEGACY_FIAT_ADAPTERS_DISABLED unless ENABLE_LEGACY_FIAT_ADAPTERS=true. The
  default gateway does not use them.
- The optional legacy test issuer requires a session-bound, URL-safe request
  id. It persists MINT_PENDING before a signer call, returns the stored
  signature for an exact completed replay, and blocks a new id while any
  earlier action for that wallet requires reconciliation. Its process-local
  rate map remains a single-instance-demo limitation.

## Files changed

Key new files:

- docs/UNIVERSAL_EARN_GATEWAY_SPEC.md
- docs/earn-repo-audit.md
- docs/earn-provider-research.md
- docs/earn-security-review.md
- docs/earn-implementation-report.md
- lib/earn-gateway.ts
- lib/legacy-fiat-adapters.ts
- app/api/earn/strategies/route.ts
- tests/earn-gateway.test.ts
- tests/legacy-devnet-guard.test.ts

Key adapted areas:

- Earn catalog/accounting: lib/yields.ts, lib/vaults.ts,
  lib/devnet-ledger.ts, and lib/solana-server.ts.
- Earn execution: the Devnet invest, withdraw, faucet, portfolio, status, and
  vault routes.
- Existing legacy adapter routes and Devnet scripts were guarded rather than
  deleted.
- Existing Earn, home, portfolio, activity, add-money, withdrawal, RWA-demo,
  and test-asset components were adapted in place.
- README.md and .env.example now document the current truth model and
  fail-closed flags.

No dependency was added. The implementation uses the repository's existing
Next.js, Solana Web3/SPL Token, Crossmint, and test tooling.

## Verification

The final integration commands were run from rwa-bridge:

| Command | Result |
| --- | --- |
| npm run lint | **PASS** (exit 0). |
| npm run typecheck | **PASS** (exit 0). |
| npm test | **PASS** — 14 tests across exact amount conversion, catalog/capability gates, required disclosures, quote/action transitions, Devnet guards, durable legacy-faucet action replay/terminal-state rules, and existing RWA-demo arithmetic/state tests. Node emitted the non-blocking DEP0205 module.register() deprecation warning. |
| npm run build | **PASS** — Next.js 16.3.6 production build completed. The optional native bigint binding was unavailable, so the package used its pure-JS fallback; this was non-fatal. |
| git diff --check | **PASS** — no whitespace errors. |
| Read-only Solana Devnet probe | **PASS** — canonical Devnet genesis and Kamino program-account observations are recorded in the provider research report. |
| node scripts/devnet-smoke.mjs | **NOT RUN** — it creates Devnet transactions. No explicit user authorization or controlled signing configuration was provided for this task. |
| node scripts/setup-devnet.mjs / npm run devnet:bootstrap | **NOT RUN** — both can create test assets and mutate local configuration. |
| Browser end-to-end wallet test | **NOT RUN** — no staging wallet/test authority was configured for a user-approved transaction. |

## Transaction evidence

No Devnet write was submitted during this work.

- **Signatures:** none.
- **Explorer URLs:** none.
- **Reason:** the optional scripts and an end-to-end deposit/exit would create
  actual Devnet actions. The task did not include explicit authorization to
  sign/send them, and no controlled staging wallet/test authority was supplied.

The absence of a signature is intentional and must not be read as a claim that
the selected strategy was executed live.

## Known gaps and blockers

1. The selected strategy is a truthful application-controlled demo, not a live
   Kamino/native-staking/provider integration. Kamino and native stake remain
   disabled until an exact Devnet market/vault or lifecycle is independently
   simulated and user-approved.
2. The JSON ledger and locks are safe only for one demo process. A production or
   multi-instance deployment needs a transactional datastore, durable
   idempotency/reconciliation jobs, and shared rate limiting.
3. The optional legacy card/KZT/provider adapters stay off by default. Enabling
   them is not approval to make them production-ready; their provider terms,
   eligibility, credentials, accounting, durability, and regional availability
   still require separate review.
4. Test-token issuer and RWA bootstrap/smoke scripts are deliberately
   write-capable and remain opt-in. No real fiat, card, bank, KZT, KZTE,
   Crossmint, MoonPay, Transak, Intebix, or off-ramp integration was verified.
5. No browser/wallet Devnet transaction was exercised in this environment.

## Manual local run

1. Install dependencies: npm ci.
2. Copy .env.example to .env.local. Keep SOLANA_CLUSTER=devnet; use an explicit
   canonical Devnet RPC; use only a server-side test authority and a
   ck_staging_ Crossmint key. Never use a production key, Mainnet RPC, or real
   payment credential.
3. If test assets must be created, deliberately run node scripts/setup-devnet.mjs.
   This is a Devnet write and requires Devnet SOL; it is not required merely to
   inspect the app.
4. Start the application with npm run dev and open /earn after signing in.
   Discovery works without an issuer. The test-token issuer is intentionally
   unavailable until ENABLE_LEGACY_DEVNET_FAUCET=true is set for a controlled
   demo.
5. For a user-approved Devnet action, confirm the UI still says DEVNET DEMO,
   transfer only the configured test token, and retain the resulting Explorer
   signature. Do not run scripts/devnet-smoke.mjs unless the intent is to
   create Devnet transactions.

## Next three recommended tasks

1. Replace the JSON ledger/locks with a transactional shared store plus durable
   idempotency keys and a reconciliation worker; then test process-crash and
   multi-instance recovery.
2. Conduct a narrowly scoped native-SOL-staking or one pinned Kamino-Devnet
   market spike: read-only account validation, build/simulate, then one
   explicitly approved user-wallet deposit and exit with captured signatures.
3. Complete provider/legal/eligibility review before enabling any KZT, card,
   Crossmint, KZTE, on/off-ramp, or production path; surface typed unavailable
   status until each exact route has passed that review.
