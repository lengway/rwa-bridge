# Plain Markets: wiring the console and verifier to devnet

This branch merges `claude/markets-program-61fa62` (Anchor program, client) and
`claude/markets-ui-9ae2c8` (issuer console, verifier). It then runs `/issuers` and `/verify/[actionId]`
against the deployed `plain_markets` program on devnet (`H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm`).

## What changed

| Area | Files |
|---|---|
| UI math matches the program | `lib/markets/math.ts` and `snapshot.ts` now wrap `entitlements.ts` and `merkle.ts`. Leaves include the action address and rounding is per unit, so the UI and the program compute the same values. Service types gain the per-action vault, `amount_per_unit`, `terms_hash`, `record_slot`, `Cancelled`, the winning option, and on-chain evidence attached to each check. |
| Publication | `lib/markets/publication.ts`: the announcement terms are a memo in the `announce` transaction (`terms_hash = sha256(json)`). The register snapshot is a memo in the `post_snapshot` transaction, split into part transactions when it is too large. The verifier needs nothing but the ledger. |
| Reads | `lib/markets/signature-feed.ts` and `lib/markets/devnet-service.ts`. A single `getSignaturesForAddress(instrument)` call lists every program transaction and every hooked transfer, with memos inline. Transitions and receipts are matched to signatures by the slots and times the program stores. Receipts and ballots are read from PDAs derived from the snapshot holders. A cold console load is about 12 RPC calls and does no `getTransaction`. The public devnet endpoint allows 10 calls per 10 s for `getTransaction`, `getSignaturesForAddress` and `getProgramAccounts`. |
| Independent register check | `lib/markets/chain-history.ts`. The verifier replays the bond-mint balances of every transaction that touched the instrument up to `record_slot` and compares the result with the snapshot. It fetches about one transaction per second, shows progress, and caches results in the browser. |
| Writes | `lib/markets/devnet-issuer.ts` signs as issuer, paying agent and indexer. Demo custody wallets for `claim` and `vote` are derived from the issuer secret. The issuer retries RPC calls, confirms by polling and maps Anchor errors to readable messages. |
| API | `app/api/markets/[op]/route.ts` (POST: announce, lockRecord, postSnapshot, fund, pay, claim, vote, settle). It enforces a per-IP and global rate limit, runs a single-flight queue (one issuer transaction at a time) and requires an `Idempotency-Key`; a replay returns the first result. Secrets stay on the server. |
| Mode | `lib/markets/server.ts`. `MARKETS_MODE=devnet` uses the real program; anything else uses the simulated ledger. Pages read the env at request time (`connection()`). |
| Console | The new-action dialog has a "Live demo timing" option on chain: record date 1 minute after signing, payment 3 minutes after. The clock ticks, so date-gated steps unlock on time. |
| Seed | `npm run markets:seed` (`scripts/markets-seed.ts`). |
| Tests | `tests/markets-devnet.test.ts` (mock JSON-RPC fixture of a settled coupon, issuer helpers, guards, HTTP executor), plus the updated `tests/markets-service.test.ts`. |

## Environment (server)

| Variable | Purpose |
|---|---|
| `MARKETS_MODE=devnet` | Turn on the real program. |
| `MARKETS_ISSUER_SECRET` | Issuer key (JSON array or base58). Without it the console is read-only. Server only. |
| `MARKETS_INSTRUMENT_MINT` | Optional. Pins the bond mint(s) shown. |
| `MARKETS_ISSUER` | Optional. For read-only deployments. |
| `MARKETS_RPC_URL` | Optional. Server RPC, may carry an API key. |
| `MARKETS_PUBLIC_RPC_URL` | Optional. Browser RPC. Defaults to the public devnet endpoint. |

Locally these are in the gitignored `.env.local`, with a copy of the key in `.secrets/markets-issuer.json`. Issuer public key: `2aywwRQSenRTXmqNG8ue8zc4awfnSHRM6FjiKuQ1qr1D`.

## Live demo instrument (devnet)

- PDB28: instrument `9BhxHS9ijmAE8BKr8Y7wXREjHT3tw8nzeT8vvVutfkh5`, mint `7ye1Ny5cLax3FRP4YFAQsBTzf2MMMeAPBHwp7NHaGb7g`, test USD `settlementMint` in `.data/markets-seed/latest.json`.
- Actions:

  | # | Action | State | How it got there |
  |---|---|---|---|
  | 1 | Coupon 1 | Settled | 4 pushes and 1 claim, by the seed |
  | 2 | Vote | Closed; "For" won 520 to 250 | By the seed |
  | 3 | Coupon 2 | Settled | Funded, paid and settled from the browser console |
  | 4 | Coupon 3 | Snapshot posted, awaiting funding | Announced, locked and snapshotted from the console |

- Verifier URLs:
  - `/verify/EQjqF9TGiBBuQeU4TsYzsiiBEDFPdy62V44d9KjFSrJX`
  - `/verify/9cMYivTvqWGmjytyfkQsbqAo9viVW1oi9AiobiTmLZnb`
  - `/verify/H8wS2wLP6bz6bbqmYtmXUadd26ssvrNWQYhddxgV7FHd`
  - `/verify/HsrbHeWK4W5QZmC68oLE3spbv5BWoSEYdBZR2ePyfBHg`

## Limits and follow-ups

- **Public RPC limits.** Two browsers on the same IP share the 10-per-10-s budget. For a public demo, set `MARKETS_PUBLIC_RPC_URL` to a keyed devnet RPC that is safe to expose, such as a domain-restricted Helius key.
- **Register discovery.** The register uses the directory and earlier snapshot holders as candidates. A holder who only arrived through a secondary transfer triggers the full replay, which is slow on the public RPC.
- **Write routes are open to anyone, with rate limits.** That fits a devnet demo. Before any non-demo use they need authentication.
- **No cancel UI.** The program supports `cancel_action`; the console does not expose it.
- **One action can block announcements.** A coupon left awaiting funding blocks new announcements until it is funded (`pending_action`).
