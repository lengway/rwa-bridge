# Universal Earn Gateway — adapted project specification

**Status:** Devnet-first implementation scope
**Adapted:** 2026-10-10
**Applies to:** the existing Plain Next.js application

## Objective

Extend the existing Earn experience into a truthful Universal Earn Gateway. A
user must be able to discover the first supported strategy, fund a demo
account, deposit test tokens, inspect a position, and exit it without implying
that a simulated rail, app-issued token, or reference APY is a real fiat,
provider, or on-chain yield product.

Kazakhstan is the first intended market, but country-specific payment rails,
Intebix, KZTE, Crossmint, and any other provider remain optional adapters.
Their presence in the codebase is not proof of partnership, eligibility, or
production availability.

## Truth model

The app must visibly distinguish these concepts:

| Area | Required representation |
| --- | --- |
| Network | `DEVNET DEMO`; all write-capable paths must reject Mainnet and a non-Devnet RPC target. |
| Funding | `SIMULATED FUNDING`; no fiat payment is collected or implied. |
| Deposit / exit | A confirmed Devnet test-token transfer and app-issued demo-share token movement may be called an on-chain Devnet transaction only after server-side confirmation. |
| Return | `ILLUSTRATIVE YIELD`; it is not earned, provider-derived, or on-chain yield, and it must not increase redemption accounting. |
| Assets | `NO MONETARY VALUE`; test assets never represent a bank balance, legal claim, real RWA, or canonical stablecoin unless independently verified and configured. |
| Payout | Any KZT-facing receipt is simulated; it must never be presented as a bank transfer or real off-ramp. |

## First strategy decision

The first strategy is a single `SIMULATED_DEMO` strategy backed by the
repository's existing Devnet test-token/share flow:

1. A user records a clearly labelled simulated funding intent. The optional
   legacy test-token issuer is disabled by default and may issue a test token
   only when `ENABLE_LEGACY_DEVNET_FAUCET=true`, an authenticated session, and
   the canonical-Devnet write guard are all present.
2. The user signs a Devnet transfer of that test token to the configured demo
   treasury.
3. The server verifies the transaction and issues an app-controlled demo share
   token.
4. The position view reads the share balance from Devnet.
5. To exit, the user signs a share-token transfer to the treasury; after
   verification, the server returns test quote tokens and burns the shares.

This is not an Ondo, Kamino, KASE, bank-deposit, or native-staking position.
Illustrative return is a separate UI/reference field and does not change the
test-token redemption value.

## Deferred providers

- **Kamino:** a Devnet program deployment alone is insufficient. Enable only
  after an exact Devnet market/vault, compatible SDK release, asset, provider
  terms, simulation, user-approved deposit, and withdrawal are verified.
- **Native SOL staking:** viable only with explicit activating/deactivating
  states. Exit is epoch-bound and must not be described as instant.
- **Fiat, KZT, Intebix, KZTE, Crossmint, on/off-ramp providers:** disabled or
  optional until credentials, geography, compliance, and provider capability
  are separately confirmed.

## Engineering rules

- Preserve the current App Router, wallet bridge, navigation, and design
  system; do not build a detached app.
- Strategy contracts carry provider, network, mode, source, availability,
  capability, funding/payout, withdrawal, and yield metadata.
- New amount contracts use decimal strings and integer base units; do not use
  JavaScript floating-point values for new financial accounting.
- Persist signatures/action IDs and verify a transaction before calling it
  completed. Retries reconcile existing work rather than issuing a duplicate
  signer operation.
- Unsupported capability is a typed unavailable state, never a fake success.
- Private keys remain server-only. No client bundle may receive a privileged
  key, arbitrary mint, or Mainnet write path.
- The JSON ledger is accepted only for this single-process Devnet demo; it is
  not production-grade distributed financial persistence.

## Verification expectations

Run formatter/lint, typecheck, unit tests, and production build. A Devnet
smoke test is opt-in because it creates real Devnet transactions; if it is not
run, report `NOT RUN` and the reason. Any real transaction must include a
Devnet signature and Explorer URL, never a secret.

## Required documentation

The implementation report records the selected strategy, provider research,
source files changed, dependencies, exact commands/results, optional Devnet
transaction evidence, known gaps, manual run instructions, and the next three
tasks. It must not claim audit, production readiness, compliance approval, or
partner integration without evidence.
