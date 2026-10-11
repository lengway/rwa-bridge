# Release worklog — 2026-10-11

## Scope and safeguards

Actual app: Plain / Universal Earn, Next 16.3.6 + React 19, pinned Kamino Lend
Devnet USDC reserve. No new BUILD STATION product, Mainnet, payment integrations,
secret rotation or migrations. The user subsequently explicitly authorized
deployment to `31.76.87.250`. Outer repository contains user-owned
untracked work; nested app initially had only untracked `RWA_GATEWAY_DEVNET_FIRST.md`.

## Baseline (actually executed)

- `npm run lint`: pass, no warnings.
- `npm run typecheck`: pass.
- `npm test`: 22 passed, zero failed.
- `npm run build`: pass. Existing optional bigint native-binding and Node
  `module.register()` deprecation warnings are not hidden.
- Public `https://plain.lengway.me/api/kamino/market`: read-only response
  `ready: true`, canonical Devnet pinned reserve; this does **not** verify login,
  signing, deposits or withdrawals, and does not deploy current changes.

## Ranked findings and acceptance checks

| Priority | Finding | Effort / dependency | Acceptance |
| --- | --- | --- | --- |
| P0 | Prepared Kamino actions live only in memory and disappear after 90s | Small / durable storage | Record survives new store instance; delayed confirmation retains exact digest |
| P0 | An unrelated failed signature can poison a prepared action | Small / receipt verification | Match message/accounts/instruction/signer before persisting failure |
| P0 | Kamino UI depends on legacy-authority portfolio hydration; Kamino positions/history missing | Medium / real position + persisted receipts | Standalone Kamino config yields usable portfolio and action buttons |
| P1 | Pending client confirmation lost on reload; ambiguous sends can cause duplicates | Medium / client recovery | Recover public action identity; retry confirmation only, never resend automatically |
| P1 | Wallet bootstrap hangs; session linking is fire-and-forget | Small / auth bridge | Visible retryable error and server ack before wallet exposure |
| P1 | RPC balance errors become zero balances | Small | Missing ATA is zero; transport/layout errors remain unavailable |
| P1 | Withdrawal shortcut opens wrong mode; mandatory auth config undocumented | Small | Withdraw deep-link preserves mode; accurate required-env documentation |

## Model / budget record

- Main architecture/integration: GPT-6.1 Sol.
- Two initial bounded GPT-5.4 mini tasks finished; user then requested Terra/Luna.
  All subsequent delegation uses GPT-6 Luna.
- **Actual API/provider spend: unavailable in current tools.** The tools expose
  model prices but not billed usage; OpenCode CLI is absent from PATH. No dollar
  totals or remaining budget can be certified. Do not confuse a model-price
  catalog with a usage meter. No new billed service was provisioned and no
  on-chain writes were run; any existing RPC/provider billing is not visible.

## Verification status

Intermediate run: 31 tests passed, typecheck passed; one newly added
unused-import lint warning was found and fixed. Durable-store patch initially had
a `readdir` overload type error; fixed by explicitly using `Dirent<string>[]`.
Focused receipt/storage/portfolio run: 12 passed, zero failed.

Latest full local run: lint and typecheck pass without new warnings, **40 tests
pass**, production build passes. HTTP production smoke with explicit Devnet
configuration: **14 checks pass** (GET routes/catalog/readiness/auth rejection,
invalid request/cluster rejection; no signing or submission). The first local
HTTP attempt failed honestly with `KAMINO_DISABLED` because local config did not
enable the route; reran with explicit process-only flags, without editing
`.env.local`. The production browser renders the email login form with no
horizontal overflow at 800px. The dev browser initially remained unhydrated due
to Next's blocked 127.0.0.1 HMR origin; production-browser verification succeeds
without weakening the dev-origin policy.

Authenticated read-only HTTP integration also passed against actual Devnet RPC:
an empty test wallet returned a complete portfolio with **no legacy authority**
configured, and asserting a different wallet returned 403. Authentication for
this check used a short-lived, local-only signed smoke-session fixture and an
explicit non-production process secret, not real email/Crossmint login. No
transaction or ledger write occurred.

SSH checks: `stapp` resolves to the authorized IP, `plain-web` is active as user
`plain`, port 3200, original checkout clean at `170fe04`. Required server auth,
SMTP and wallet settings are present (values not printed). Shared configuration
declares canonical Devnet and Kamino enabled. New deploy procedure builds an
independent release, runs preflight on 3202, switches the symlink only after
checks, and restores the previous symlink if post-switch checks fail.

Deployment attempts found and preserved two actual blockers: the VPS bare Git
repository was empty, making a full-history transfer exceed short timeouts over
a slow link; seeded its baseline from the existing VPS checkout locally, then
the release push succeeded. The isolated clean install then exposed Debian's
system npm 9.2.0 peer-resolution incompatibility with the npm 11 lockfile. Restored
explicit npm 11 tooling (pinned to local 11.19.1) rather than mutating dependencies
or the lockfile. Both failures occurred before activating the new release.

The next clean VPS install succeeded (2033 packages), lint passed, then typecheck
found missing generated `LayoutProps` globals because `.next` does not exist in
a fresh checkout. Changed the documented `npm run typecheck` to execute
`next typegen` before `tsc`, rather than relying on local build leftovers.

## Release constraints

- **Deployed and externally checked:** code release `ac002f4bfe08cd4f99846fe35dba0fa4ab991d5f`
  is active at `https://plain.lengway.me` on the authorized VPS. `plain-web` is
  active/running; `/home/plain/app` resolves to that exact release worktree.
  The original checkout is untouched and clean; preflight unit is stopped.
- VPS clean npm install, lint, generated-route typecheck, **40 tests** and
  production build passed. Preflight and post-switch loopback HTTP checks each
  passed **14/14**; external HTTPS read-only checks passed **10/10**.
- Production browser renders login at 800px; login and landing were additionally
  checked in a same-origin 390px iframe viewport. No horizontal overflow,
  email/button/primary links fit. These are responsive layout checks, not a
  claim that authenticated mobile signing or native PWA install was tested.
- Full real email → embedded wallet → signed Devnet deposit → withdrawal still
  requires owner-controlled login and explicit transaction approval.
- File-based action persistence is for the current single Node server with a
  stable writable data directory, not replicated/ephemeral serverless hosting.
- Existing historic wallet-send UI recovery is a separate remaining risk;
  primary release stabilization focuses on Kamino.
- Optional legacy/reference `/api/rates/kzt` and `/api/yields` return 503 on the
  public app; the enabled Kamino route is ready independently. These unavailable
  feeds are not evidence of a live FX price or Kamino APY. Browser console also
  contains the expected 401 for a signed-out session; no uncaught application
  exception was observed in the checked public screens.
- Previous release retained at `/home/plain/worktrees/rwa-bridge`; rollback code
  exists, but no deliberate post-activation failure was injected into production.
- Source commits were sent to the VPS private Git repository only, not published
  or pushed to GitHub. This final evidence update is documentation-only and does
  not change the running code release.

## Next three actions

1. Owner signs in and explicitly approves a small Devnet deposit/withdrawal;
   verify signatures, portfolio/history and reload recovery together.
2. Read actual Cask/provider usage in the owner's billing dashboard. Spending
   remains unavailable to this session; no $50-cap compliance claim is made.
3. Review submission material/public-source access and demo recording, then
   publish/submit only with the owner's authorization.
