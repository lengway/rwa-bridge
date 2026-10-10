# Earn security and test review

## Implementation follow-up — 2026-10-10

The original findings below are retained as the pre-implementation baseline.
This follow-up is authoritative for the selected Universal Earn flow. It does
not assert that a Devnet transaction was submitted.

### Selected Universal Earn flow: mitigated findings

- **Canonical Devnet guard.** lib/solana-server.ts now validates both the
  declared target and the canonical Devnet genesis hash immediately before each
  legacy signer operation: token mint, token transfer, burn, ATA creation, and
  fee-SOL transfer. The selected invest and withdraw routes run that guard
  before parsing/confirming an action. The legacy scripts make the same
  fail-closed check before local or chain writes.
- **Browser preflight.** The Devnet status route now withholds a mint and
  treasury from browser transfer controls unless there is an explicit Devnet
  cluster, a canonical Devnet RPC, configured test assets, and a staging
  Crossmint client key. This closes the earlier configuration path in which a
  production wallet could have been asked to transfer before a server-side
  signer guard rejected the follow-up call.
- **Exact selected-flow accounting.** The Universal Earn deposit route accepts
  a canonical decimal string and the exit route accepts a JSON-safe atomic
  share string. New selected-flow calculation and SPL signer calls use bigint
  base units; its fixed one-to-one test-token/share rate excludes illustrative
  yield entirely.
- **Deposit/withdraw idempotency.** A deposit is recorded as MINT_PENDING
  before mint submission. A withdrawal is recorded as PAYOUT_PENDING before the
  payout and BURN_PENDING before the burn. A failed or ambiguous signer/ledger
  boundary becomes NEEDS_REVIEW and later retries return a review-required
  response instead of issuing another mint or payout.
- **Session binding and confirmation.** Both selected routes bind the request
  address to the signed session and independently inspect confirmed token
  balance deltas for the exact requested atomic amount. A browser success flag
  cannot complete an Earn action.
- **Provider rails.** The legacy KZT/card/Crossmint/Transak/MoonPay endpoints
  are fail-closed by default behind ENABLE_LEGACY_FIAT_ADAPTERS. Their default
  response is a typed 503 unavailable state before provider, wallet, ledger,
  or signer work begins. The Universal Earn UI does not offer those paths by
  default.
- **Faucet availability and replay safety.** The retained legacy test-token
  issuer is disabled by default behind ENABLE_LEGACY_DEVNET_FAUCET, requires a
  session-wallet match and a URL-safe idempotency key, and uses the canonical
  signer guard. It persists MINT_PENDING before any signer call, returns the
  stored signature for an exact completed replay, and blocks a fresh key while
  an earlier action is unresolved. It remains a Devnet-only test utility,
  never a fiat funding source.

### Remaining limitations

- The JSON ledger and its mutex/key locks are still single-process
  demonstration controls. They cannot guarantee distributed idempotency,
  durable rate limits, or recovery across worker/process failure. Do not scale
  this mechanism as financial infrastructure.
- Historic legacy routes retained outside the selected Earn flow may still use
  numeric display contracts or older persistence sequencing. They are not
  promoted to the Universal Earn provider contract; optional legacy
  provider-facing routes stay disabled by default and require a separate
  durability review before any enablement.
- The legacy test faucet's aggregate rate map is process-local. Its action
  record is durable for one process, but a shared limiter and transactional
  store/cross-process lock are still required before any multi-instance use.
- No end-to-end wallet transaction, browser test, Kamino transaction
  simulation, or Devnet smoke script was run in this review. No transaction
  signature is claimed.

### Follow-up verification

After integration, npm run lint, npm run typecheck, and npm test passed with
14 tests. npm run build passed with Next.js 16.3.6; the optional native bigint
binding fell back to pure JavaScript. The test suite covers the new
decimal/atomic conversion, capability gates, required disclosure set,
operation/quote transitions, legacy requested-cluster guard, and persisted
legacy-faucet action replay/terminal-state rules. It does not replace a
controlled, explicitly approved Devnet transaction test.

Reviewed 2026-10-10. The baseline static review plus its recorded commands do
not assert that a Devnet transaction was submitted. The review workstream did
not directly change production code or tests; later integration changes are
summarized above.

## Verification run

| Command | Result |
| --- | --- |
| `npm run lint` | Passed (exit 0). |
| `npm run typecheck` | Passed (exit 0). |
| `npm test` | Passed (exit 0): 6/6 tests passed in `tests/rwa-demo.test.ts`. Node emitted `DEP0205` deprecation warning for `module.register()`. |
| `npm run build` | Passed (exit 0): Next.js 16.3.6 completed the production build and generated 53 routes. The build emitted repeated optional-native-binding warnings: `bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)`. |
| `node scripts/devnet-smoke.mjs` | Not run. It can exercise funding and other Devnet money flows and requires configured secrets; no live transaction was approved for this review. |

The first local build attempt reported `sh: next: command not found` because the installed `next` package was temporarily invalid. The rerun above is the current, authoritative build result; this review does not treat the transient local dependency state as a source regression.

## Existing controls worth preserving

- The RWA-DEMO path uses atomic integer strings and `bigint` helpers for its funding and quote math (`lib/rwa-demo.ts`).
- RWA-DEMO is opt-in, requires an explicit `devnet` cluster and RPC URL, and verifies the RPC genesis hash before RWA demo reads or writes (`lib/rwa-demo-config.ts`). Its server-only payer path rejects symlinks and group/world-readable key files.
- External-quote mode rejects both simulated funding and simulated payouts. The RWA demo faucet also has wallet/IP/aggregate caps and stores a keyed IP digest rather than a raw IP.
- The swap flow simulates the prepared transaction, binds confirmation to the exact serialized message digest, checks a confirmed/finalized status, configured wallet/pool/DLMM program, and verifies exact input plus minimum output from on-chain token deltas (`lib/meteora-devnet.ts`). A client-side success flag alone cannot complete the RWA-DEMO order.
- The RWA demo order state machine prevents a direct transition to `COMPLETED`; the existing test suite covers that basic invariant.

## Findings and gaps

### P1 — Devnet-only write guard is not applied to legacy write paths

The new RWA-DEMO route verifies both `SOLANA_CLUSTER=devnet` and the canonical Devnet genesis hash. The older `lib/solana-server.ts` instead creates a connection directly from `SOLANA_RPC_URL` (falling back to Devnet) and `devnetConfig.configured` checks key/mint syntax, not RPC identity. Legacy endpoints such as `/api/devnet/faucet`, `/api/devnet/invest`, and `/api/devnet/withdraw` can therefore write against whichever RPC is supplied by deployment configuration.

This does not show that a Mainnet write occurred. It does mean the project does not yet establish the acceptance criterion that **all** writes fail closed on non-Devnet targets. Centralize the canonical Devnet/genesis check and require it immediately before every legacy signing/mint/transfer operation, or disable the legacy write routes for this demo.

### P1 — Legacy Earn accounting still uses JavaScript floating point

The RWA-DEMO flow is largely atomic-string based, but the existing Earn vault flow is not. Examples include:

- `lib/solana-server.ts` converts UI `number` values with `Math.round` before minting/transferring.
- `lib/vaults.ts` derives a share price with `Math.pow` from an APY.
- `/api/devnet/invest` calculates shares with `Math.floor((amountUsd / priceUsd) * 1_000_000)`.
- `/api/devnet/withdraw` rounds received shares and calculates payout with `number` multiplication.

These flows must either be isolated as clearly labelled legacy simulation or migrated to decimal-string/atomic-unit contracts before they become the Universal Earn strategy. There are no tests covering precision at `u64` boundaries, mixed decimals, or adversarial rounding for these routes.

### P1 — Legacy mint/payout retries are not transactionally idempotent

In the legacy investment route, the on-chain share mint occurs before the ledger receipt is durably appended. A ledger-write failure after a successful mint leaves the payment signature unrecorded, so retrying can mint another set of shares. In the legacy withdrawal route, the treasury payout occurs before its payout signature is persisted; failure in that interval can cause a retry to pay again. The in-process key lock does not resolve a process crash, multi-instance deployment, or a persistent-store failure.

Use a durable action record/outbox with a unique action ID and on-chain signature before retrying a signer operation. Reconcile any ambiguous signer call by querying the derived transaction/account state; do not issue another mint or payout based only on a missing local receipt.

### P1 — The older Devnet faucet is unauthenticated and only process-rate-limited

`/api/devnet/faucet` accepts an arbitrary wallet address, sends the wallet fee SOL if needed, and mints test dollars. Its `$5,000` cap is an in-memory `Map` keyed only by wallet address. New wallets, a restart, or multiple app instances bypass that limiter. Coupled with the missing legacy network guard, this is a materially broader risk than the guarded RWA-DEMO faucet.

Retire the route from public deployments or require an authenticated wallet, an explicit Devnet-only feature flag, durable wallet/IP/aggregate limits, and trusted-proxy enforcement. Treat forwarded-IP headers as untrusted unless the edge proxy strips and replaces them.

### P2 — RWA-DEMO’s local JSON ledger and locks are not durable across instances

`lib/devnet-ledger.ts` uses process-local mutexes/key locks plus a local JSON file. This is sufficient for a single-process demonstration, but it cannot guarantee order/signature uniqueness, idempotency keys, or faucet aggregate caps across workers, restarts, or horizontally scaled deployments. The README identifies this deployment limitation; the test suite should make it an explicit release gate rather than relying on an operational note.

Also scope idempotency lookups by wallet (or include the wallet in the unique key). The current global key lookup avoids duplicate mints but lets a collision with another wallet turn into a cross-user conflict/denial of service.

### P2 — Strict quote-expiry behavior is not proven after a transaction is prepared

An initial quote is rejected on order creation, and the UI blocks an expired quote. A prepared transaction is instead bounded by its blockhash and its signed minimum-output instruction. Confirmation validates the message digest and token deltas, but does not independently compare wall-clock time with `order.expiresAt`. This does not appear to bypass the minimum-output protection, but it leaves the product requirement “stale quote rejected” unproven for a client that signs a previously serialized transaction after the 30-second quote display TTL.

Decide and test the intended invariant: either a blockhash-valid prepared transaction remains acceptable because its min-output is authoritative, or make transaction validity and displayed quote expiry a single enforceable window. Do not mark the order failed merely because a successful on-chain transaction was observed late; reconcile it truthfully.

### P2 — Default UI copy can mislabel the test quote token as USDC

The default server configuration names the quote token `QUOTE-DEMO`, but `components/app/rwa-demo-screen.tsx` and `RwaDemoLauncher` hard-code `USDC` in their introductory copy. This conflicts with the requirement not to present a fake USDC label unless the app is explicitly configured for an external Devnet USDC mint.

Render the configured `quoteSymbol` after `/api/demo/assets` loads, or use a neutral “test quote token” label before then. Add a component test for both default and external-quote modes.

### P2 — Simulated yield needs a first-class mode in the legacy Earn API

The legacy vault quote compounds a fetched or fallback APY into a Devnet share price. The API/data model does not encode a mode such as `illustrative`, `historical`, `provider-derived`, or `unavailable`, and the older UI can present price appreciation as a position’s earnings. Keep this separate from the well-labelled RWA-DEMO swap. Any Universal Earn strategy should carry source, network, provider, availability, and yield-mode metadata server-side; a client must not infer or supply those claims.

## Focused recommended test plan

Implement these in priority order, using injected RPC/provider/ledger interfaces for unit and route tests. Keep an optional Devnet smoke suite separate from the normal CI gate.

1. **Atomic amount properties.** Test decimal strings at 0, 6, and 18 decimals; malformed values; leading zeros; values near `u64::MAX`; rounding direction; quote-token conversion; and exact share/payout accounting. Assert the legacy routes never convert a financial base-unit amount through `number`.
2. **Network and configuration fail-closed matrix.** For every write endpoint, assert disabled/missing config, `mainnet-beta`, an unknown genesis hash, mismatched RPC/genesis, malformed mint, external-quote mode, and disabled faucet all reject before a signer call. Assert a canonical Devnet mock is the only success path.
3. **RWA order-state and quote tests.** Cover every invalid transition, an expired quote, a rebuilt order while the prior blockhash is valid, a rebuild after expiry, a second signature for one order, a signature already attached to another order, and all final states. Explicitly specify and test prepared-transaction behavior past the quote display TTL.
4. **Confirmation adversarial cases.** Mock a pending, failed, and confirmed RPC result; then test wrong wallet signer, wrong pool, wrong program, digest mismatch, wrong mint, partial/excess input, output below minimum, missing parsed balances, and RPC timeout. Only the verified exact transaction may become `COMPLETED`.
5. **Idempotency and crash recovery.** Run concurrent funding/order/payout requests and simulate failures immediately after `mintTo`, treasury transfer, burn, and ledger persistence. Replays must return the original result or a review-required state, never execute a second signer operation. Add a multi-process/durable-store integration test before scaling beyond one instance.
6. **Faucet and provider negatives.** Assert unknown providers and arbitrary mints are rejected; an external quote mint cannot be issued or paid out by this app; forged client success flags never complete an order; limits persist across restart; and trusted-proxy/IP behavior is tested at the deployment boundary.
7. **Disclosure/UI contracts.** Test default `QUOTE-DEMO` versus explicit external `USDC`, and assert each funding/payout/yield state visibly carries the correct `DEVNET DEMO`, simulated/illustrative, and no-monetary-value disclosure. Assert no simulated value is labelled earned, on-chain yield, or a real KZT payout.
8. **Opt-in Devnet smoke.** After test configuration and explicit approval, run one buy and sell against the configured Devnet pool; capture the cluster, signatures, and explorer URLs. Include one expected failure (stale/prepared transaction or insufficient balance). Never make this suite target Mainnet or gate ordinary CI.

## Secret-handling check

The reviewed source keeps signing modules server-only, loads key material from server environment/path configuration, and ignores `.env*` and `.secrets/`. Static search found no client import of the server signing modules and no obvious tracked private key literal. This is not a credential audit: `.env.local` was intentionally not opened or logged. Preserve the file-permission checks for the RWA-DEMO payer and avoid reintroducing raw secret environment values into browser-visible configuration.
