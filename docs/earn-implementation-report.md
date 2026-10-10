# Universal Earn Gateway — Kamino Lend Devnet implementation

**Status:** implemented and Devnet-gated

## Outcome

Plain now exposes one discovery strategy: **Kamino Lend · Solana Devnet**.
The route is direct protocol supply and redemption through a pinned Devnet USDC
reserve. A connected wallet, not the server, signs and submits every action.

The product makes these boundaries explicit:

- `SOLANA DEVNET`
- `KAMINO LEND`
- `USER-SIGNED ON-CHAIN`
- `VARIABLE PROTOCOL RATE`
- `NO MONETARY VALUE`

No fiat collection, off-ramp, Mainnet action, fixed APR, or provider-backed
monetary claim is included.

## Architecture

| Layer | Implementation |
| --- | --- |
| Catalog | `lib/earn-gateway.ts` enables only `kamino-lend-devnet-usdc`; historic app-controlled entries are exit-only. |
| Product view | `/earn/kamino-lend` uses the Kamino drawer rather than the legacy app-controlled share flow. |
| Server route | `GET /api/kamino/market`, `GET /api/kamino/position`, and `POST /api/kamino/{deposit,withdraw}/{prepare,confirm}`. |
| SDK | `@kamino-finance/klend-sdk@13.0.2` builds the Kamino instructions; `@solana/kit@2.3.0` compiles the v0 message. |
| Wallet bridge | Crossmint receives a Base58 serialized wire transaction and remains the only signer/sender. |
| Completion | The server requires finalization, then validates the exact message, Kamino instruction, signer, accounts, and SPL token deltas. |

## Safety controls

The server fails closed unless all of the following hold at request time:

1. `ENABLE_KAMINO_LEND_DEVNET=true` and `SOLANA_CLUSTER=devnet`.
2. `SOLANA_RPC_URL` is HTTPS and reports canonical Solana Devnet genesis.
3. The pinned KLend program, market, reserve, mints, supply vault, and market
   authority match the immutable allowlist.
4. The reserve is active and not in emergency or cToken-blocked mode.
5. The wallet balance, collateral balance, reserve liquidity, fixed 1-Devnet
   USDC cap, and an unsigned simulation all succeed.
6. The returned v0 transaction contains no unexpected program or address lookup
   table and has the authenticated wallet as fee payer.

The browser also independently validates API metadata, the exact market/reserve,
atomic amount, successful simulation result, action ID, and finalized completion
response before offering signing or reporting success.

## User flow

1. The user opens Kamino Lend in the app with a signed-in embedded wallet.
2. The UI reads the currently verified route and wallet Devnet balances.
3. The user selects supply or withdraw, enters an exact amount, and accepts the
   Devnet/no-value disclosure.
4. The server builds and simulates a transaction for the allowlisted reserve.
5. The user reviews the prepared details and signs in the wallet.
6. The UI polls confirmation without re-sending. Completion is shown only once
   the server confirms the finalized on-chain result.

## Legacy isolation

Historic app-controlled Devnet positions remain available only for their
supported exit path. The legacy invest, withdraw, vault, and import endpoints
are constrained to the historic catalog and cannot accept the Kamino product
ID. Public Earn discovery and `/api/earn/strategies` return the enabled Kamino
route only.

## Verification

The repository validates the integration with:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Focused contract tests assert canonical Devnet-only inputs, immutable route
identifiers, exact atomic conversion, successful simulation requirements,
Base58 serialized transaction handling, and strict confirmation semantics.

No user wallet was signed or sent by the implementation process. An actual
success transaction requires a user-controlled Devnet wallet with fee SOL and
the required Devnet USDC or collateral tokens.
