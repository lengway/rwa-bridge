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

- **First stabilization release:** `ac002f4bfe08cd4f99846fe35dba0fa4ab991d5f`
  was deployed and externally checked at `https://plain.lengway.me`. The newer
  UX release and its actual checks are recorded below.
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

## UX pass — implementation, not a full signed E2E claim

- Primary Home actions are now Add to Earn / Withdraw / Activity; historic assets
  and exits remain accessible. Core pages, auth errors, sign-in emails, metadata
  and PWA description are English. Repeated protocol details are collapsed;
  Devnet/no-value and risk disclosures remain visible.
- Added authenticated USDC/SOL balance checks, exact Max bounded by wallet,
  configured cap and withdrawal liquidity, and manual official test-fund guides.
  Withdraw guidance does not require funding USDC again. No faucet request or
  real funding was automated.
- Prepared actions quote their actual RPC network fee in SOL; refundable
  token-account rent is explicitly separate. Receipt reconciliation no longer
  depends on the reserve still accepting new actions, but retains canonical
  Devnet, exact-message, signer, instruction and token-delta verification.
- Existing signatures are checked automatically, at most 10 checks, with
  cancellation, timeouts and unknown/pending outcomes preserved. The poller can
  never build, sign or resend. Actual verified proceeds are shown after success,
  even if a later reserve-health refresh fails.
- Fixed an integration mismatch in the advanced legacy transfer form: its
  TEST QUOTE balance must match its configured mint; Kamino USDC cannot satisfy
  a legacy transfer's balance check. Unknown legacy balances remain unknown.
- Legacy FX/yield polling is disabled when those adapters are disabled, rather
  than repeatedly requesting unavailable reference feeds from the primary app.
- Focused tests for polling, snapshots/Max, fee metadata and wallet-setup rendering
  pass. Intermediate full run: lint/typecheck/build pass and 51 tests pass. A
  subsequent null-balance TypeScript error introduced by the legacy UI fix was
  detected and corrected; final checks and deployment status follow below.
- Existing SMTP delivery, real wallet signing and authenticated-screen visual
  behavior still require the owner flow; email templates/render tests are not
  delivery or on-chain success evidence. Three bounded copy/presentation jobs
  used GPT-6 Luna; integration and financial-boundary changes stayed with Sol.
- Strict receipt tests uncovered an old client bug: `readSignature` reused the
  32-byte address parser, while fallback to the expected signature hid missing
  or mismatched response signatures. Fixed client/server/recovery validation to
  Base58-decoded 64-byte signatures; no fallback can manufacture completion.
- The first read-only fee-RPC spike failed because its test command used a
  truncated genesis literal (not an application-code defect). Corrected against
  the repository's canonical constant; the unsigned v0 fixture returned an
  actual RPC fee of 5000 lamports. This is read-only RPC compatibility evidence,
  not a submitted Kamino transaction or proof of the full wallet journey.
- Final local checks for this UX candidate: lint, generated-route typecheck,
  **53 tests**, production build and diff check pass. Production localhost HTTP
  smoke passes **14/14**. Authenticated empty-wallet snapshot and wallet mismatch
  checks passed against real Devnet RPC with the local-only test-session fixture.
  English login renders without horizontal overflow at desktop and 390px iframe
  widths; optional disabled FX/yield endpoints are not requested by that page.
  Full authenticated visual flow and SMTP delivery remain owner checks.
- **UX release deployed and externally checked:** `27b4e79e670988a4e8f9cb1fb7aa0fd2b025fc16`.
  `plain-web` is active/running and `/home/plain/app` resolves to this exact
  release. Clean VPS install, lint, typegen/typecheck, 53 tests and production
  build pass; preflight and post-switch checks each pass 14/14. Public HTTPS
  read-only smoke passes 10/10. Public English login renders without horizontal
  overflow and does not request disabled FX/yield reference endpoints. Previous
  code release `ac002f4` is retained for rollback. No owner transaction was signed,
  sent, or asserted successful by this implementation session.

## Mock onboarding / widget foundation

User approved mock KYC, partner mock identity reuse, and **widget-only** integration.
Implemented minimal country/declarations stored in the existing user's ledger;
status is `MOCK_COMPLETED`, `identityVerified` always false. No raw identity
documents or personal identity fields are accepted. The new-deposit server gate
does not gate historical withdrawals or existing action reconciliation.

Added `/widget-demo`, `/widget`, dependency-free `/plain-widget.js`, origin-bound
10-minute sandbox bootstrap, CSP allowlist and source/origin-checked messaging.
The token cannot authorize a user or spending; actual email auth and user wallet
signatures remain required. Only demo-bank exists; no real bank/provider is
connected. Cross-site cookies/webviews/signing are explicitly not production-
validated; same-origin demo plus first-party fallback is the supported example.

Actual local checks: lint/typegen/typecheck/build/diff pass, **60 tests pass**.
Isolated HTTP fixtures verify signed-token validation, wrong-origin rejection,
no user-auth elevation, strict mock-only input, profile save/reset and the
new-deposit gate. SMTP was disabled for fixtures; no actual emails or transactions
were sent. Browser demo launch reached 'Sandbox session connected' and the real
email login screen in its iframe, with no horizontal overflow. Core HTTP smoke
still passes 14/14. Deployment and external checks follow after activation.

Activated release `29b1a261848f89f81f58db6ce43e1d7623ecd8f8` on the authorized
VPS; previous `27b4e79` retained for rollback. VPS lint/typecheck, 60 tests and
production build passed; 14 HTTP checks passed both before and after activation.
External HTTPS checks passed for eight public surfaces plus sandbox bootstrap,
validation, wrong-origin rejection and no user-auth elevation. Public browser
`/widget-demo` launch reached 'Sandbox session connected' and the real email
sign-in screen inside `/widget`, without alerts or horizontal overflow. Console
contains expected signed-out `/api/auth/session` 401 responses, not evidence of
a completed authenticated flow. Owner email login and signed deposit/reload/
withdrawal remain unverified; no real KYC/bank funding or production cross-site
authentication is claimed. API billing/spend remains unavailable.

## Portfolio failure / RPC storm hotfix

Owner reported the authenticated Home portfolio failing after the widget release.
VPS logs showed repeated Solana RPC `429 Too Many Requests` retries. The original
15-second polling could overlap its own 25-second requests; full market verification
and legacy history hydration repeated without coalescing, including unrelated
Kamino token accounts in legacy scans. Public unauthenticated smoke did not cover
this authenticated path, so its previous success was not sufficient evidence.

Hotfix `841fbf7` coalesces wallet-scoped read snapshots (10 seconds), read-only
verified market loads (30 seconds), legacy reads/status (60 seconds) and transient
failures (cooldown). Browser polls now run every 60 seconds and coalesce in-flight
refreshes. Historic hydration is bounded to two requests at once and scoped to
known legacy mints; optional legacy reads cannot delay a verified Kamino summary
more than four seconds. Missing legacy data is explicitly marked/excluded, never
represented as a successfully loaded zero. Preparation/receipt verification still
load fresh chain state; a newly verified action invalidates portfolio snapshots.
Home initial failure renders 'Balance unavailable' rather than endless skeletons.

Actual local lint/typecheck/build and **64 tests** passed, including failed-balance
rendering, coalescing, wallet isolation, expiration, cooldown and concurrency limits.
Five simultaneous authenticated HTTP reads against live Devnet all returned 200
with actual portfolio data in 2.179 seconds. This used a separate local fixture
ledger and session secret; no owner login, email, signatures or chain writes.
VPS activation and an isolated VPS authenticated read check follow separately.

Added `scripts/authenticated-portfolio-smoke.mjs` for repeatable isolated checks.
It only admits loopback fixture ports 3203/3204 and signs an `.invalid` test-email
session using a fixed non-production fixture secret. It must run against a
separate ledger with SMTP and legacy authority disabled. It verifies five
concurrent live-Devnet portfolio reads, authenticated wallet mismatch rejection
and unauthenticated rejection; it never sends a transaction. Local repeat passed
in 1.696 seconds. The fixture wallet is a public read target, not a wallet owned
by or a balance belonging to the user.

Hotfix `841fbf74518e40c78a889addeccad67292fb1520` activated on the authorized VPS;
previous release retained. VPS lint/typecheck/build and 64 tests passed, with
14 core HTTP checks before and after activation. External HTTPS read-only smoke
passed 10 checks. A separate loopback instance of the activated build on the same
VPS used a fixture session secret/ledger with SMTP, legacy authority/import disabled:
five concurrent authenticated live-Devnet portfolio requests returned 200 in
**1.206 seconds**, and wallet mismatch/unauthenticated reads returned 403/401.
The temporary service was stopped and its own fixture ledger removed. No owner
session, production secret, external emails, wallet signatures or transactions
were used. Recent active-service logs showed startup without renewed 429 entries
in the inspected window; this is not a guarantee about future public-RPC quotas.
Owner should reload to validate their own session and holdings; that specific
owner flow remains unobserved.

## Embedded wallet root-cause correction

Owner reported the failure persisted after `841fbf7`. Nginx portfolio access
records showed **500**, not a session rejection or current RPC quota error.
Reproduced the failure against the owner's public wallet address using a separate
fixture session/ledger on the VPS; the previous ordinary-key fixture had passed.
A direct read exposed `TokenOwnerOffCurveError` at the ATA derivation: the
embedded smart-wallet address is off-curve, and the reader passed
`allowOwnerOffCurve=false` (or omitted it) at three sites.

`f5e485e` replaces those sites with a single canonical SPL ATA helper admitting
PDA owners. This is address derivation only: session scoping, account program,
user signing and verified settlement remain unchanged. Added regression tests
for a deterministic PDA and an ordinary public key; 66 tests, lint/typecheck,
build and diff check passed. Direct live-Devnet reading of the owner's **public**
address now succeeds locally with a valid EMPTY position and token-account
addresses; no owner authentication, wallet signatures or transactions used.
The reusable smoke now accepts a public read target and defaults to a PDA so this
specific class of regression is not hidden by an ordinary-key fixture again.
VPS deployment and same-address HTTP verification follow after activation.

Activated `f5e485e42c5871f33cf2bc3e3375a0f20e50120f` at 17:43 UTC; previous
`841fbf7` retained. VPS lint/typecheck, 66 tests and production build passed,
as did 14 HTTP checks before/after activation and 10 external HTTPS read checks.
The exact previously failing public wallet read target now passed five concurrent
authenticated HTTP reads in **1.188 seconds** from an isolated instance of the
activated VPS build, with wallet mismatch/unauthenticated requests still 403/401.
Before this correction the same-address fixture returned 500; this is a
reproduced before/after result, not inference from the ordinary-key fixture.
The temporary service and its own fixture ledger were cleaned up. Owner production
session was not impersonated. The last observed owner-origin nginx portfolio
requests were 500 **before** this activation; post-activation owner UI remains
to be confirmed by refresh. Local same-address HTTP test also passed in 3.442
seconds and deterministic PDA fixture in 0.619 seconds. No transactions sent.

## Product copy and demo bank presentation

Owner requested natural product terminology with one corner demo marker, and a
demo bank with a Plain button. Implemented compact expandable Demo · Devnet
disclosure across landing, account/setup/app and widget. Primary labels now use
USDC, SOL, cUSDC, deposits/withdrawals and estimated portfolio value instead of
repeated DEVNET UNITS/NO MONETARY VALUE banners. cUSDC balances remain separate
from estimated USDC value; no APY or credited earnings invented. Actual historic
test tokens retain their identity. Mock identity consent and explicit Devnet /
no-value acknowledgement before wallet signing remain; execution guardrails,
exact values, 1 USDC cap and authenticated wallet scoping are unchanged.

`/widget-demo` is now fictional Forma Bank with sample bank account/card/activity
data and two Plain entry buttons. Plain opens through the existing signed
sandbox SDK in a native dialog. Bank/card controls that are not connected stay
disabled; sample bank balances never fund or update the user's Plain wallet.
Closing/canceling destroys the frame; stale async bootstraps are ignored. No
external provider, paid tooling or real bank integration was added.

Actual local checks: lint/typecheck/build/diff pass, **69 tests pass**. Browser
verified desktop dashboard, Plain dialog reaching real email sign-in, close /
reopen with exactly one iframe, cancel-handler cleanup, and no token in frame
URL. A 375px nested viewport verified bank layout and 359px dialog with 357px
widget viewport, without horizontal overflow; no physical mobile wallet flow
is claimed. Screenshots inspected. Core HTTP smoke passed 14 checks; five
authenticated reads of the previously failing public PDA target returned 200 in
0.394 seconds on the isolated local instance. No email or transactions sent.
Deployment/public checks follow separately; owner signing remains unverified.

Presentation release `1aca098` activated after VPS lint/typecheck, 69 tests,
production build and 14 pre/post activation HTTP checks passed. Follow-up browser
checking found that a real Escape key while focus was inside the iframe did not
dismiss the outer native dialog. Added origin-checked close messaging for Escape
on ordinary widget screens, but explicitly defer to active wallet/transaction
dialogs and close expanded disclosures first. Local lint/typecheck/build and
**71 tests** passed. Real browser keypress now closes the widget and removes its
iframe; a synthetic `role=dialog` fixture confirms Escape does not tear down an
approval-like screen. This fixture does not claim an actual wallet approval test.

Final active presentation release is `00d0451785b3e771ae79ae421d0341beec6d01ff`;
prior `1aca098` retained. VPS lint/typecheck, **71 tests**, production build and
14 pre/post activation HTTP checks passed. External HTTPS smoke passed 10 reads.
Public `/widget-demo` browser shows Forma Bank and the sample-data labels, launches
Plain to the real email login with 'Connected to Plain', has no overflow/alerts,
and a real Escape key from its iframe closes/removes the widget. Public dashboard
screenshot inspected. Console checks of local demo showed only expected signed-out
session 401s. No login code, wallet approval or transaction was submitted; actual
authenticated signing in the bank widget and cross-site browser support remain
unverified. Recent nginx portfolio requests returned 200, consistent with the
earlier PDA wallet-read correction; no owner session was read or impersonated.

## Two-action consumer UX / publication preparation

Owner requested a consumer-first experience with only Invest and Withdraw as
primary actions, publication to GitHub and submission/business cleanup. Owner
explicitly approved making the existing GitHub repository public after checks.
The selected business model is a transaction-fee hypothesis; owner reported a
pilot/customers, but counts, activity, permissions and revenue evidence are still
pending and are not represented as verified traction.

Home, Earn and the bank widget now share one simple screen: available route USDC,
estimated invested USDC, Invest and Withdraw. Earlier holdings remain accessible
in Wallet; TEST QUOTE or unrelated tokens cannot fund these actions. Main nav
is Home / Activity / Wallet. Route, mint, cUSDC and compute details are optional.
The action form is amount → checks → amount/fee/network review → explicit wallet
approval. Unknown balances cannot enable preparation. Network/amount caps,
session binding, receipt verification and pending/reload recovery remain intact.
Demo USDC / fee-token guidance appears only when funding is missing; no faucet
success, deposit, fee sponsorship or bank conversion is fabricated.

Local lint/typecheck/build/diff passed and **76 tests** passed, including two
primary actions, exact reviewed fees, unavailable balances and exclusion of
legacy tokens from usable USDC. Git history scans covered 937 small/text blobs
for known key/token/secret patterns and 897 configuration/source blobs for
hardcoded secret-value candidates; no findings or sensitive key/env paths.
These heuristic checks are not a guarantee of absence of every possible secret.
Only ignored local/runtime secrets remain outside the publication scope.

README updated with actual scope, funding and verification limitations. The
owner's old submission draft is preserved and marked outdated; a private owner
review checklist supplies factual corrections and questions, not generated
application answers. Actual portal edits, pilot evidence, videos, owner-approved
signed round trip and final Submit remain owner-dependent.

Published `876fad4b708625e32377a9b7ccaa6682d58239be` to GitHub `main` by
fast-forward from `170fe04`, and changed the repository to PUBLIC with the
owner's explicit approval. Anonymous GitHub API/raw README checks confirmed
public access, the matching main commit and current documentation. A final
275-file tracked-tree scan found no known secret patterns. The untracked
owner-owned RWA roadmap and private submission-review files were not published.

Activated the same code release on the authorized VPS; previous `00d0451`
retained. VPS lint/typecheck, **76 tests**, production build and 14 pre/post
activation HTTP checks passed; external HTTPS smoke passed 10 reads. Local
authenticated live-Devnet portfolio smoke for the known PDA target passed five
concurrent requests in 0.597 seconds with a separate test session/ledger; no
owner session or transactions used. Static rendering of the actual simple
screen verified two primary buttons and no overflow using clearly labeled
fixture balances; this is layout evidence, not an authenticated interactive or
signed financial flow. No real-money fee implementation, new bank rail or
claimed pilot/customer evidence was added. Owner-signed round trip remains
unverified, including the embedded smart-wallet transaction path.
