# Plain

Plain is a Solana Devnet-only app whose enabled Earn route supplies and redeems
Devnet USDC through one pinned Kamino Lend reserve. The server prepares and
simulates an unsigned transaction; the user's connected wallet signs and sends
it. Devnet assets and positions have no monetary value.

- App: https://plain.lengway.me
- Earn route: https://plain.lengway.me/earn/kamino-lend
- [Implementation report](docs/earn-implementation-report.md)
- [Provider and route evidence](docs/earn-provider-research.md)
- [Gateway contract](docs/UNIVERSAL_EARN_GATEWAY_SPEC.md)

## Current route

| Item | Value |
| --- | --- |
| Protocol | Kamino Lend |
| Network | Solana Devnet only |
| KLend program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |
| Market | `8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa` |
| USDC reserve | `8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn` |
| Devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Collateral mint | `6Txtcxf78FxjpDxc31jAnfXzaRFECr26DNt8CNim2wb7` |
| Rate | Variable protocol rate; no fixed APR is shown or promised |
| Per-action cap | 1 Devnet USDC by default, configurable only downward |

The route does not accept fiat, provide an off-ramp, or use Mainnet. It is not a
bank account, investment product, or claim of production availability.

## Sign-in and wallet configuration

Copy `.env.example` to `.env.local`. Email-code sign-in requires
`AUTH_SESSION_SECRET` and working SMTP settings (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, and `MAIL_FROM`). The embedded wallet additionally
requires the four `AUTH_JWT_*` settings below and Crossmint configuration. The
example intentionally leaves secrets blank; create and supply your own values
outside Git.

```dotenv
AUTH_SESSION_SECRET=
AUTH_JWT_PRIVATE_KEY=
AUTH_JWT_KID=
AUTH_JWT_ISSUER=
AUTH_JWT_AUDIENCE=
```

`AUTH_JWT_PRIVATE_KEY` must be an EC P-256 (prime256v1) private-key PEM. Encode
PEM line breaks as literal `\n` in a single-line environment value; the server
converts them back to newlines. Keep it private. `AUTH_JWT_ISSUER` and
`AUTH_JWT_AUDIENCE` must match the trust configuration for the BYO JWT.

The embedded wallet additionally requires a Crossmint **staging client key**
with Wallets enabled:

```dotenv
NEXT_PUBLIC_CROSSMINT_API_KEY=
```

Configure the Crossmint staging client's BYO JWT/JWKS trust to match your issuer
and audience and this app's `https://<your-app-origin>/.well-known/jwks.json`
endpoint. Add the actual app origin to that client's permitted domains. These
are owner-managed Crossmint console settings; this repository does not create
them or prescribe a fake domain. A Crossmint key alone does not configure the
trust relationship or enable a payment rail.

## Kamino configuration and action storage

For the Kamino route, configure these values in addition to sign-in and wallet
configuration:

```dotenv
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
ENABLE_KAMINO_LEND_DEVNET=true
KAMINO_LEND_DEVNET_MAX_AMOUNT_ATOMIC=1000000
KAMINO_ACTION_STORE_PATH=
```

The runtime checks the canonical Devnet genesis hash and requires an HTTPS RPC;
Mainnet or another cluster fails closed. The cap is in atomic Devnet USDC and
cannot exceed `1000000` (1 token).

`KAMINO_ACTION_STORE_PATH` is an optional **base path**: the server appends `.d`
and stores action records in that directory. If unset, the directory is
`${DEMO_LEDGER_PATH || <cwd>/.demo-ledger.json}.kamino.d`. Keep this storage on
stable persistent disk **outside versioned release directories** so prepared,
pending, and verified action records remain available across releases. The
file-backed queue supports a single Node.js process only; it is not safe for
ephemeral serverless instances, multiple processes, or replicas sharing this
directory. The 90-second preparation expiry prevents signing stale prepared
payloads; it does not delete the record or prevent reconciliation of a
transaction already sent. Keep records until their outcome can be verified.

The Kamino portfolio reads the route's Devnet position and uses finalized,
server-verified action receipts. Server accounting and receipts retain atomic
integer strings; conversion to numbers is for the existing display model. The
Kamino portfolio position and receipts are sourced from the Kamino route,
not balances issued by the legacy app-controlled token authority. Historic
legacy holdings may be added when that separate configuration exists, but are
not a prerequisite for the Kamino position.

## Transaction lifecycle

1. The browser requests a deposit or withdrawal for the authenticated wallet.
2. The server verifies canonical Devnet, the pinned program/market/reserve/mints,
   reserve state, wallet balance, and the configured cap.
3. The server builds and simulates an unsigned v0 transaction before returning
   its Base58 wire payload.
4. The connected wallet is the only signer and sender.
5. The server reports completion only after finalization and verification of the
   exact transaction message, Kamino instruction, signer, and expected
   SPL-token deltas. A processed or confirmed-but-not-finalized signature stays
   pending.
6. The browser stores the public pending-action identity (and, after signing,
   the signature) in wallet-scoped `localStorage` so it can restore confirmation
   after reload. This is recovery metadata, not authorization; the server
   verifies the session and transaction.

## Local commands

The repository defines these local install, lint, typecheck, test, build, and
development commands:

```bash
npx --yes npm@11.19.1 ci
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

The public `/api/kamino/market` surface is a read-only market/reserve readiness
check. A `ready: true` result is point-in-time read evidence only, not a wallet
transaction, end-to-end smoke test, or deployment verification. The HTTP smoke
script checks readiness and authentication/validation boundaries:

```bash
node scripts/release-smoke.mjs http://127.0.0.1:3201
node scripts/release-smoke.mjs https://plain.lengway.me
```

Remote smoke checks issue GET requests only. Local checks additionally send
invalid or unauthenticated commands that must fail before any on-chain action.
Neither substitutes for a user-approved signed deposit/withdrawal.

An actual on-chain action requires a user-controlled wallet, Devnet SOL for
fees, and Devnet USDC or Kamino collateral as appropriate. Do not put a wallet
private key, production credential, Mainnet endpoint, or real payment
credential in this project.

## Deploy

The VPS runs `plain-web` through `/home/plain/app`. Deploy validated, committed
`HEAD` to the authorized host (`stapp` currently resolves to `31.76.87.250`):

```bash
scripts/deploy.sh stapp
```

The script sends the commit to the VPS bare Git repository (not public GitHub),
creates `/home/plain/releases/<commit>` as a separate worktree, installs from the
lockfile with npm 11.19.1 (the server's system npm 9 is not compatible with its
peer resolution), runs lint/typecheck/tests/build, and checks a production server on
loopback port 3202. Only then does it atomically switch `/home/plain/app` and
restart `plain-web` on port 3200. Failed post-switch checks restore the previous
symlink and restart the old release; old releases and the original worktree are
retained. Runtime secrets and the ledger stay in `/home/plain/shared` and are
never rewritten by this script. See `WORKLOG.md` for actual verification status.

## Mock onboarding and widget foundation

Email login now leads to a short **mock-only** account setup before new deposits.
No document, full name, birth date, passport or identity image is requested or
stored. `MOCK_COMPLETED` never means real KYC or real-money eligibility. Existing
portfolio access, withdrawals and confirmations remain available.

Try the labeled [sandbox partner widget](https://plain.lengway.me/widget-demo).
The browser SDK is `/plain-widget.js`; integration scope is **widget only**.
Only `demo-bank` is registered, with signed short-lived sandbox bootstrap
sessions, exact origin/source checks and no user-authentication privileges.
No real bank, identity provider or payment rail is connected. See
[widget integration and browser limitations](docs/widget-integration.md).

## Legacy routes

Historic app-controlled Devnet positions remain exit-only for reconciliation.
They are not part of discovery and cannot process a Kamino action. Card,
KZT/KZTE, and other legacy adapters are disabled by default and are not evidence
of payment, provider, regional, or production availability.
