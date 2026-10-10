# Plain

Plain is a Devnet-only Universal Earn gateway for one direct Kamino Lend route
on Solana. It prepares a transaction for a pinned Kamino Lend USDC reserve,
simulates it server-side, and asks the connected wallet to sign and submit it.

**Solana Devnet only. Devnet USDC and Devnet positions have no monetary value.**

- Live app: https://plain.lengway.me
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

The route never accepts fiat, provides an off-ramp, or uses Mainnet. It is not
a bank account, investment product, or production availability claim.

## Transaction lifecycle

1. The browser requests a deposit or withdrawal for the authenticated wallet.
2. The server verifies canonical Devnet, the exact program/market/reserve/mints,
   active reserve state, wallet balance, and the configured cap.
3. The server builds an unsigned v0 transaction through the Kamino SDK and
   simulates it before returning a Base58 wire payload.
4. The connected wallet is the only signer and sender.
5. The server marks the action complete only after it is finalized and after
   verifying the exact transaction message, Kamino instruction, signer, and
   expected SPL-token deltas.

The UI never turns a wallet-provider response or a merely processed signature
into a success state.

## Required configuration

Copy `.env.example` to `.env.local` and configure the following server-side
values:

```bash
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
ENABLE_KAMINO_LEND_DEVNET=true
# Optional safety cap in atomic Devnet USDC; cannot exceed 1000000 (1 USDC).
KAMINO_LEND_DEVNET_MAX_AMOUNT_ATOMIC=1000000
```

The runtime independently verifies the RPC genesis hash, so pointing these
variables at Mainnet or another cluster fails closed. The RPC URL must be HTTPS.

For the embedded wallet experience, also configure a staging Crossmint client
key:

```bash
NEXT_PUBLIC_CROSSMINT_API_KEY=ck_staging_...
```

## Run and verify locally

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

Once the app is running with the configuration above, the read-only health
surface is available at `/api/kamino/market`. It returns `ready: true` only if
all pinned Devnet accounts and the reserve are verified at that moment.

Do not put a wallet private key, production credentials, Mainnet endpoint, or
real payment credential into this project. A real on-chain action requires a
wallet controlled by the user, Devnet SOL for fees, and Devnet USDC or Kamino
collateral as appropriate.

## Deploy

The VPS checkout is `/home/plain/worktrees/rwa-bridge`. After committing the
validated change, deploy from this repository with:

```bash
scripts/deploy.sh stapp
```

The deploy script pushes committed `HEAD`, pulls it on the VPS, installs from
the lockfile, builds, and switches the running release only after the build
succeeds. Runtime configuration lives outside Git at
`/home/plain/shared/.env.local`.

## Legacy routes

Historic app-controlled Devnet positions remain exit-only for reconciliation.
They are not part of discovery and cannot process a Kamino action. Card,
KZT/KZTE, and other legacy adapters are disabled by default and are not evidence
of payment, provider, regional, or production availability.
