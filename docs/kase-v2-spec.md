# Plain Markets — corporate actions engine (KASE track v2)

## Idea

Tokenization does not end at issuance. Plain Markets is the servicing layer for tokenized bonds on Solana:
an on-chain program that **enforces** the corporate-action lifecycle (record date, ex-date lock, funding,
entitlement, payment, redemption, voting), plus three faces built around it:

1. **Issuer console** — announce and run corporate actions, see funding and settlement status.
2. **Investor view inside Plain** — a retail user who signed in with email holds the bond in their Plain
   smart wallet, sees the coupon calendar, receives / claims coupons, votes. This is the part nobody else has:
   issuer → registry → retail investor, end to end, in one product.
3. **Public verifier** — anyone re-derives every action from chain: snapshot root, entitlements, totals reconcile.

## On-chain program `plain_markets` (Anchor, devnet)

Accounts (PDAs):
- `Instrument` [b"instrument", mint]: issuer, bond mint (Token-2022, 0 decimals), settlement mint, face value,
  coupon bps, frequency, issue/maturity timestamps, status (Active | Matured | Redeemed), `lock_until` (ex-date lock),
  allowlist flag, counters.
- `PayingVault` [b"vault", instrument]: token account owned by the program holding settlement funds per action.
- `CorporateAction` [b"action", instrument, id]: kind (Coupon | PartialRedemption | FinalRedemption | Vote),
  record_ts, payment_ts, rate/percent params, merkle_root of (holder, units) snapshot, snapshot_hash,
  total_units, total_entitlement, funded_amount, paid_amount, status
  (Announced → RecordLocked → SnapshotPosted → Funded → Settling → Settled), claim deadline.
- `ClaimReceipt` [b"claim", action, holder]: prevents double payment; stores amount, slot.
- `VoteRecord` [b"vote", action, holder]: choice, weight (from snapshot proof).

Key mechanics:
- **Ex-date lock via Token-2022 transfer hook**: the bond mint's transfer hook (this program) rejects transfers while
  `now < instrument.lock_until` and (optionally) to non-allowlisted holders. Record date = lock start; the register
  cannot change between record date and payment. Program-enforced, no per-account freezing.
- **Snapshot**: an off-chain indexer reads the register at record time, builds a Merkle tree of (holder, units),
  posts root + total_units + sha256 of the canonical JSON. The program checks total_units == bond supply.
- **Entitlement math on-chain**: coupon = units × face × coupon_bps / 10_000 / frequency (integer, settlement decimals);
  the program recomputes from the proof, never trusts a client amount.
- **Funding**: issuer deposits exactly `total_entitlement` into the paying vault; action becomes Funded.
- **Payment**: `claim(proof)` by the holder (pull) or `pay(holder, proof)` crank by the paying agent (push, for
  custodial / retail wallets). Both write a ClaimReceipt.
- **Redemption (DvP)**: payout and burn of the holder's units in the same instruction (program PDA is the mint's
  permanent delegate). Final redemption marks the instrument Redeemed once supply == 0; leftovers return to issuer
  after the claim deadline.
- **Vote**: weight = snapshot units via proof; tally is on-chain.
- Events (`emit!`) for every transition; Memo not needed any more.

Tests: litesvm / anchor test covering happy path + attacks (double claim, wrong proof, transfer during lock,
underfunded settlement, early redemption before payment_ts, non-issuer calls).

## Off-chain (Next.js app, rwa-bridge)

- `lib/markets/` — TS client from the IDL, Merkle builder, snapshot indexer (getProgramAccounts on Token-2022 mint),
  pure entitlement math mirroring the program (shared test vectors).
- `/issuers` (replaces /kase, keep /kase redirect) — issuer console: instrument page, action timeline
  (announce → record → lock → snapshot → fund → settle), per-holder preview before execution, CSV export.
- `/verify/[action]` — public verifier: recompute root + totals from chain in the browser, green checks.
- Plain app — "Bonds" section: holdings, coupon calendar, received coupons in Activity, vote.

## Honesty

Devnet only. Settlement token is a test USD minted by the issuer (fiat leg simulated). Not affiliated with KASE.
