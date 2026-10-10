# Kamino Lend Devnet route evidence

**Access date:** 2026-10-10

## Decision

The enabled Universal Earn route is direct **Kamino Lend on Solana Devnet**.
It supplies and redeems Devnet USDC against one pinned lending reserve. The
application does not use a hosted transaction builder because the public
Kamino KTX builder did not resolve this Devnet market; it instead constructs
the transaction using the pinned Kamino SDK and a canonical Devnet RPC.

This is a Devnet-only route. It has no monetary value, does not accept fiat,
and is not a Mainnet, bank, investment, or jurisdictional-availability claim.

## Pinned route

| Item | Address / value |
| --- | --- |
| KLend program | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` |
| Lending market | `8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa` |
| Devnet USDC reserve | `8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn` |
| Devnet USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Collateral mint | `6Txtcxf78FxjpDxc31jAnfXzaRFECr26DNt8CNim2wb7` |
| Liquidity supply vault | `NVA3HA7nyfrvqbNehACNiLnd33ANssgsBYUPdqP5B2J` |
| Market authority | `3vA23mvUdFnXEfMsRzEQJHRUpNt52uzZhzpY2hUna6Yo` |
| Token precision | 6 decimals for liquidity and collateral |
| Default per-action cap | `1000000` atomic units (1 Devnet USDC) |

The configured RPC must return canonical Devnet genesis hash
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

## Read-only validation completed

The implementation validates these conditions before every prepared action:

1. `ENABLE_KAMINO_LEND_DEVNET=true`, `SOLANA_CLUSTER=devnet`, and an HTTPS
   `SOLANA_RPC_URL` are present.
2. The RPC genesis is canonical Devnet.
3. The pinned KLend program is executable and the market/reserve accounts are
   owned by it.
4. The decoded reserve belongs to the pinned market and references the pinned
   liquidity mint, collateral mint, supply vault, token program, and market
   authority.
5. Both SPL mints have the expected precision; the reserve is active and is
   neither in emergency mode nor blocked for cToken usage.
6. A prepared v0 transaction has only the expected Kamino, Compute Budget,
   and Associated Token programs; its fee payer and required static accounts
   are pinned to the authenticated wallet and configured route.
7. The exact unsigned transaction is simulated before it can reach the wallet.

Read-only construction was checked for both supply and redeem with
`@kamino-finance/klend-sdk@13.0.2` and `@solana/kit@2.3.0`. No airdrop,
signature, or broadcast was performed during this verification.

## User transaction boundary

The server produces an unsigned Base58-serialized v0 wire transaction. The
connected Crossmint Solana wallet is the only component that signs or sends it.
After a user submits it, the server requires finalized commitment and verifies:

- exact prepared message digest;
- exact Kamino instruction digest and required accounts;
- expected authenticated wallet signer; and
- expected Devnet USDC/collateral token deltas.

The UI reports completion only after all of those checks pass. A processed or
confirmed-but-not-finalized signature remains pending.

## Product constraints

- The reserve rate and withdrawal liquidity are variable. No numerical APR is
  displayed or guaranteed.
- Withdrawals require the user to hold sufficient collateral cTokens and the
  reserve to have sufficient liquidity at prepare time.
- Each server instance retains a short-lived prepared-action record (90 seconds)
  for exact message validation. A stale action must be prepared again.
- Mainnet writes are rejected. The direct hosted KTX builder is not used for
  this Devnet reserve.
- Native SOL staking, card funding, KZT/KZTE rails, off-ramps, and other legacy
  adapters are outside the enabled route.

## Primary sources

- [Kamino Lend program addresses](https://kamino.com/docs/build/resources/program-addresses)
- [Kamino Lend deposit operations](https://kamino.com/docs/build/developers/borrow/operations/deposit)
- [Kamino KLend SDK](https://github.com/Kamino-Finance/klend-sdk)
- [Solana clusters](https://solana.com/docs/references/clusters)
- [Crossmint Solana wallets quickstart](https://github.com/Crossmint/solana-wallets-quickstart)
