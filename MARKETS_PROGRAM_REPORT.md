# Plain Markets: on-chain program report

`plain_markets` is an Anchor 1.2 program. It runs the corporate-action lifecycle of a tokenized bond
on Solana: record date, ex-date lock, snapshot, funding, entitlement, payment, redemption and voting.
It replaces the server-script prototype (`lib/kase/*`) with rules the chain enforces.
The design follows `docs/kase-v2-spec.md`.

| | |
|---|---|
| Program id | `H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm` |
| Devnet | **Not deployed yet.** The deploy wallet has 1.26 SOL and the 542 KB program needs about 2.76 SOL in rent. The devnet faucet returned "rate limit reached" four times; it was not retried in a loop. See [Deploy](#deploy). |
| Workspace | `programs/plain-markets/` (excluded from `tsconfig` and ESLint; `npm run build` passes) |
| Client | `lib/markets/client/` (IDL, IDL type, builders), `lib/markets/merkle.ts`, `lib/markets/entitlements.ts`, `lib/markets/register.ts` |
| Demo | `scripts/markets-demo.ts` (`npm run markets:demo`) |
| Program keypair | `programs/plain-markets/target/deploy/plain_markets-keypair.json`, backed up to `.secrets/plain-markets-program-keypair.json`. Both are gitignored. |

## Accounts (PDAs)

| Account | Seeds | Purpose |
|---|---|---|
| `Instrument` | `["instrument", mint]` | Bond terms: issuer, paying agent, settlement mint, face, coupon bps, frequency, issue/maturity dates, status (Active, Matured, Redeemed), lock window `lock_from..lock_until`, allowlist flag and counters. This PDA is the bond mint's **mint authority, permanent delegate, transfer-hook authority and metadata authority**. |
| `CorporateAction` | `["action", instrument, id u64 LE]` | Kind, status, schedule (record, payment, claim deadline), parameters, on-chain `amount_per_unit`, record supply and slot, Merkle root, snapshot sha256, totals, funded/paid/claimed/redeemed counters, vote tally and winner, and the previous lock window (for rollback). |
| Paying vault | `["vault", action]` | One settlement token account per action, owned by the action PDA. It is created at `announce` for paying kinds and closed at `settle` or `cancel_action`, with rent returned to the issuer. |
| `ClaimReceipt` | `["claim", action, holder]` | Prevents double payment. Stores units, amount, burned units, mode (Claim or Push), payer, slot and timestamp. |
| `VoteRecord` | `["vote", action, holder]` | Choice, weight (snapshot units), slot and timestamp. |
| `AllowEntry` | `["allow", instrument, wallet]` | Allowlisted wallet (only checked when the allowlist is on). |
| Extra account metas | `["extra-account-metas", mint]` | SPL transfer-hook validation list. It resolves `[Instrument, AllowEntry(destination owner)]` for every transfer. |

The bond mint is Token-2022 with 0 decimals and these extensions: **TransferHook** (this program),
**PermanentDelegate** (the Instrument PDA), and **MetadataPointer + TokenMetadata** (name and symbol
appear in wallets and explorers). It has no freeze authority.

## Instructions

| Instruction | Who | What it enforces |
|---|---|---|
| `initialize_instrument(params)` | issuer | Creates the mint with its extensions, the Instrument and the hook account list. Validates frequency (1/2/4/12), face > 0, rate ≤ 100%, maturity > issue and metadata lengths. Rejects a settlement mint that is the bond mint or has a transfer fee, transfer hook or non-transferable extension. |
| `issue(units)` | issuer | Mints to the holder's associated token account. Blocked if the instrument is not Active, an action is pending, a redemption is open, or the register is locked. Needs an `AllowEntry` when the allowlist is on. |
| `allow_holder(wallet)` / `disallow_holder` / `set_allowlist(bool)` / `set_paying_agent(pk)` | issuer | Allowlist and paying-agent administration. |
| `announce(params)` | issuer | Strict schedule: `now ≤ record < payment ≤ claim_deadline`. Parameters are validated per kind. Computes and stores `amount_per_unit`, creates the paying vault and sets the ex-date lock window. Only one action can be in its pre-payment stage at a time, and a redemption only runs when no other action is open. |
| `lock_record()` | anyone (crank) | Callable once `now ≥ record_ts` and before `payment_ts`. Pins `record_supply` and `record_slot`. Moves Announced → RecordLocked. |
| `post_snapshot(root, hash, total_units, holder_count, total_redeem_units)` | issuer | Requires `total_units == mint supply == record supply` and a non-zero root. Recomputes `total_entitlement` on-chain. For partial redemptions, the posted burn total must lie within the per-holder rounding bounds. Moves to SnapshotPosted. |
| `fund(amount)` | issuer | Funding can come in tranches but never exceeds the total. The action becomes **Funded exactly at `total_entitlement`**. A fully funded final redemption marks the instrument Matured. |
| `claim(units, proof)` | holder | Pull payment. |
| `pay(units, proof)` | paying agent or issuer | Push payment to the holder's own associated token account, for custodial and smart wallets. |
| `cast_vote(units, proof, choice)` | holder | Weight comes from the snapshot proof. Valid only before close. Writes a `VoteRecord` and updates the on-chain tally. |
| `settle()` | anyone once every snapshot unit is paid; issuer only after the claim deadline otherwise; anyone after a vote closes | Sweeps leftovers to the issuer and closes the vault. A partial redemption releases the register. Votes record the winning option (strict plurality; a tie has no winner). |
| `cancel_action()` | issuer | Allowed before Funded (votes: before the first ballot). Refunds any partial funding and rolls back the lock window and pending state. |
| `transfer_hook(amount)` (SPL `Execute`) | Token-2022 | Rejects transfers while `lock_from ≤ now < lock_until`. Rejects destinations without an allowlist entry when the allowlist is on. Refuses direct invocation outside a transfer (checks the `transferring` flag). |

`claim` and `pay` share one code path, in this order:

1. State checks: action is Funded or Settling, `now ≥ payment_ts`, and the receipt is fresh.
2. Verify the Merkle proof of `(action, holder, units)`.
3. Recompute the entitlement from the proof.
4. Bound it against the snapshot totals and the funded amount.
5. Burn redeemed units through the permanent delegate.
6. Transfer settlement from the vault.
7. Write the receipt and emit events.

All of this happens in one instruction, so delivery versus payment is atomic. When the final
redemption's last burn takes the supply to 0, the instrument becomes Redeemed in that same instruction.

### State machine

```
Announced ─lock_record─▶ RecordLocked ─post_snapshot─▶ SnapshotPosted ─fund(=total)─▶ Funded ─claim/pay─▶ Settling ─settle─▶ Settled
    └────────────── cancel_action (before Funded) ──────────────▶ Cancelled
Vote: SnapshotPosted (voting open) ─cast_vote─▶ Settling ─settle (after close)─▶ Settled
```

### Ex-date lock

`announce` sets the lock window. The hook enforces it by time alone, so nobody has to call anything
at the record date:

- **Coupons and votes:** locked from `record_ts` to `payment_ts`.
- **Redemptions:** locked from `record_ts` until settlement, because units are burned at payment. A final redemption stays locked forever.

A lock that is already running is extended rather than replaced. A new record date must fall inside
it, otherwise `LockStillRunning`, so the single window never locks an unrelated gap.

### Entitlement math (identical in `math.rs` and `lib/markets/entitlements.ts`)

Amounts are rounded per unit (per denomination, the market convention): the amount for one unit is
floored first, then multiplied by units. Every unit gets the same amount, and the total is
`total_units × amount_per_unit`, computed on-chain.

- **Coupon:** `floor(face × rate_bps / 10 000 / frequency)` per unit.
- **Partial redemption:** burns `floor(units × redeem_bps / 10 000)` per holder and pays `burn × floor(face × price_bps / 10 000)`.
- **Final redemption:** `floor(face × price_bps / 10 000) + coupon(rate_bps)` per unit, and burns every unit.
- **Vote:** weight equals the snapshot units.

### Merkle snapshot (identical in Rust and `lib/markets/merkle.ts`)

- **Leaf:** `sha256(0x00 ‖ action ‖ holder ‖ u64le(units))`. Including the action address means a proof from another action never verifies.
- **Node:** `sha256(0x01 ‖ min(a,b) ‖ max(a,b))`.
- **Order:** leaves sorted by holder bytes; an odd node is promoted.
- **Snapshot hash:** `snapshot_hash = sha256(canonicalSnapshotJson)`, using fixed key order and units as decimal strings.

Shared vectors live in `lib/markets/test-vectors.json` (generated by `npm run markets:vectors`). Both
`cargo test` (`tests/vectors.rs`) and `node:test` (`tests/markets-vectors.test.ts`) check them, so the
Rust and TS code are proven to match byte for byte on leaves, ordering, proofs, roots and the snapshot hash.

### Events

`InstrumentCreated`, `UnitsIssued`, `AllowlistUpdated`, `AllowlistToggled`, `PayingAgentUpdated`,
`ActionAnnounced`, `RecordLocked`, `SnapshotPosted`, `ActionFunded`, `EntitlementPaid`, `UnitsRedeemed`,
`VoteCast`, `ActionSettled`, `ActionCancelled`, `InstrumentMatured`, `InstrumentRedeemed`.
55 custom errors (6000–6054), each with a specific message.

## Test matrix

`npm run markets:test` runs LiteSVM tests against the compiled `.so`: **23 tests, all passing**.

| Area | Test | Asserts |
|---|---|---|
| Setup | `instrument_initializes_token_2022_bond` | Token-2022 mint with 0 decimals; hook → program; permanent delegate and mint authority → Instrument PDA; no freeze authority; metadata present |
| | `rejects_bad_instrument_params` | `InvalidFrequency`, `InvalidFaceValue`, `InvalidMaturity` |
| | `rejects_settlement_mint_with_transfer_hook` | `InvalidSettlementMint` |
| Coupon lifecycle | `coupon_full_lifecycle_with_attacks` | announce → free transfers before record → **transfer during lock: `TransferLocked`** → permissionless lock_record (and a second call: `InvalidActionStatus`) → `SupplyMismatch` and `InvalidSnapshotRoot` → **non-issuer snapshot: `NotIssuer`** → **claim before funding: `ActionNotFunded`** → tranche funding → **underfunded settle: `ActionNotFunded`** → `OverFunding` → **non-issuer fund: `NotIssuer`** → **claim before payment_ts: `PaymentNotDue`** → **forged units: `InvalidProof`** → **stolen proof under another key: `InvalidProof`** → **foreign proof from another action: `InvalidProof`** → pull claim → **double claim and double push: `AlreadyClaimed`** → **random wallet push: `NotPayingAgent`** → delegated paying agent push → early settle: `ClaimWindowOpen` → transfers work after payment date → settle by anyone when fully paid; vault closed |
| | `unclaimed_coupon_sweeps_back_after_deadline_issuer_only` | **non-issuer sweep: `NotIssuer`**; issuer sweep returns the exact unclaimed amount |
| Redemptions | `partial_then_final_redemption_burns_and_redeems` | 25% partial: per-holder floor burns, lock persists after payment (`TransferLocked`), `MissingHolderBondAccount`, **redeem twice: `AlreadyClaimed`**, `RedemptionInProgress`, settle releases the lock. Final: principal + coupon, every unit burned, Matured → Redeemed atomically at supply 0, **redeem twice after redemption: `AlreadyClaimed`**, nothing more can be announced or issued (`InstrumentNotActive`) |
| | `partial_redeem_total_must_respect_rounding_bounds` | `RedeemTotalOutOfBounds` below and above the bounds |
| | `unclaimed_final_redemption_keeps_instrument_matured` | Sweep after the deadline; remaining units stay frozen |
| Votes | `vote_tally_is_weighted_by_snapshot_units` | `InvalidVoteChoice`, `InvalidProof`, `AlreadyVoted`, no vault for votes, `VotesAlreadyCast` on cancel, `VotingNotClosed`, `VotingClosed`, tally and tie → no winner |
| | `vote_majority_wins` | Permissionless settle records the winner |
| Allowlist / hook | `allowlist_blocks_non_allowlisted_destination` | **transfer to a non-allowlisted wallet: `DestinationNotAllowlisted`**, issuance needs an entry (`AllowlistEntryRequired`), self-allowlisting `NotIssuer`, toggling off opens transfers |
| | `hook_cannot_be_invoked_outside_a_transfer` | `NotTransferring` |
| Admin / guards | `non_issuer_admin_calls_fail` | announce, set_paying_agent, issue, cancel all fail with `NotIssuer` |
| | `schedule_and_parameter_validation` | `InvalidSchedule` ×2, `UnexpectedParameter`, `InvalidRedeemShare`, `InvalidVoteOptions`, `PendingActionExists` |
| | `cancel_refunds_partial_funding_and_restores_lock` | Refund and vault closed; lock, pending, open-action and period counters restored; `MissingSettlementAccounts` |
| | `funded_actions_cannot_be_cancelled_and_supply_cannot_change_under_snapshot` | `InvalidActionStatus`, `RegisterLocked` |
| | `next_coupon_lock_window_merges_with_running_lock` | `LockStillRunning`; windows merge; period 2 |
| Vectors | `entitlement_vectors`, `merkle_vectors` (+4 unit tests in `math.rs`) | Rust matches the TS-generated vectors byte for byte; the hook discriminator matches the SPL interface |

Node side: `tests/markets-vectors.test.ts` has 5 tests. `npm test` passes 153/153 overall, and `npm run build` passes.

### End-to-end run (local validator)

`MARKETS_RPC=http://127.0.0.1:8899 npm run markets:demo` uses the same `.so` and program id with the
TS client. It ran **39 transactions** successfully:

1. Settlement mint and 3 investors.
2. `initialize_instrument` and issuance of 50/30/20 units.
3. **Coupon:** a transfer before the record date succeeds, and a transfer after it is rejected on-chain with `TransferLocked`. Then crank, snapshot from the register, fund $6,250, one pull and two push payments. Alice's second claim is rejected with `AlreadyClaimed`. Settle.
4. **Vote:** tally For 65 / Against 35, so For wins.
5. **25% partial redemption:** 23 units burned, $23,000 paid.
6. **Final redemption:** $81,812.50 paid, supply 0, instrument Redeemed.

Every on-chain total matched the off-chain math.

Compute units measured in that run:

| Instruction | CU |
|---|---|
| `initialize_instrument` | 59k |
| `issue` | 50k |
| `announce` | 40k |
| `post_snapshot` | 21k |
| `fund` | 33k |
| `claim` | 71k |
| `pay` | 75k |
| final-redemption `claim` with burn | 69k |
| `cast_vote` | 32k |
| `settle` | 33k |

All are under the 200k default.

## Devnet transaction links

None yet. The deploy is blocked on devnet SOL (see below). Once deployed, `npm run markets:demo`
prints an explorer link for every step and writes them to `.data/markets-demo/latest.json`, together
with the canonical snapshot JSON of every action that the verifier needs.

## Deploy

1. Top up the deploy wallet `82dzmeh7DEoJQrAhnzVVjfRFgeDoXj65gUwkbbnjiWB6` (the Solana CLI default
   keypair) to at least **2.9 devnet SOL**. For example, sign in at <https://faucet.solana.com>, or
   retry `solana airdrop 2` later.
2. Deploy and run the demo:

```bash
solana program deploy programs/plain-markets/target/deploy/plain_markets.so --program-id programs/plain-markets/target/deploy/plain_markets-keypair.json --url devnet
```

```bash
npm run markets:demo
```

The upgrade authority will be the CLI wallet. To rebuild, run `npm run markets:build`; it runs
`anchor build` and syncs the IDL into `lib/markets/client/idl`.

## Known limits

- **Snapshot correctness is checked off-chain.** On-chain, the root's total must equal the supply,
  and each claim is bounded by the snapshot totals and the funded amount. Whether each leaf matches
  the real balance at record time is re-derived by the public verifier from chain data plus the
  published snapshot (`register.ts`, `merkle.ts`). For redemptions the burn also enforces real
  holdings: you cannot be paid for units you do not hold.
- **Partial redemption totals are bounded, not proven.** The program cannot sum per-holder floors,
  so `total_redeem_units` is bounds-checked and individual claims can never exceed it. A dishonest
  value inside the bounds would show up in the verifier, not on-chain.
- **Leaves are per wallet.** Redemption burns from the holder's single bond account (normally the
  associated token account). The indexer aggregates multiple token accounts per owner, but a holder
  who split units across several accounts would need to consolidate them before a redemption.
- **Unclaimed final redemptions.** After the claim deadline the issuer may sweep unclaimed principal.
  The holder's units stay on a frozen register as a record of the liability. Pushing payments before
  the deadline (as the demo does) avoids this.
- **Single lock window.** One pre-payment action at a time; redemptions run alone; overlapping
  locks must be contiguous (`LockStillRunning`).
- **Error codes on closed or absent vaults.** A claim after settlement, or `fund` on a vote, fails
  with Anchor's `AccountNotInitialized` (3012) rather than a custom error, because the vault is
  closed or does not exist.
- **Settlement mints.** Tested with SPL Token. Token-2022 settlement mints with fees, hooks or
  non-transferability are refused. A settlement mint with its own permanent delegate is a trust
  assumption on that stablecoin issuer.
- **Proof length.** Capped at 24 (about 16.7M holders), but transaction size limits practical depth
  to roughly 15 to 18 without address lookup tables.
- **Upgradeable program.** The upgrade authority is the deployer wallet. Devnet only. The
  settlement token is a test USD. Not affiliated with KASE.
