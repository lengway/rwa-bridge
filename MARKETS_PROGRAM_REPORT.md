# Plain Markets: on-chain program report

`plain_markets` is an Anchor 1.2 program. It runs the corporate-action lifecycle of a tokenized bond
on Solana: record date, ex-date lock, snapshot, funding, entitlement, payment, redemption and voting.
It replaces the server-script prototype (`lib/kase/*`) with rules the chain enforces.
The design follows `docs/kase-v2-spec.md`.

| | |
|---|---|
| Program id | `H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm` |
| Devnet | **Deployed** ([explorer](https://explorer.solana.com/address/H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm?cluster=devnet)). The full lifecycle demo ran on devnet; links are [below](#devnet-deployment-and-transaction-links). |
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

## Devnet deployment and transaction links

- Program: [`H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm`](https://explorer.solana.com/address/H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm?cluster=devnet). Deploy tx: [`3xqXK2jC…`](https://explorer.solana.com/tx/3xqXK2jCWNXMHeG3Epyf87oBcH92nvcRfYGKBRgghuwSMQ8cbiBaUEMHMPxz81E9NLTHnQqCicaWVtKHZY2HqC3Z?cluster=devnet). Upgrade authority: `82dzmeh7DEoJQrAhnzVVjfRFgeDoXj65gUwkbbnjiWB6`. Program data: 542,032 bytes, 2.754 SOL rent.
- Demo instrument (PKZ27): [`6WKRYj9rYx4Qb1aeB86dAHqRhj3yKrQ3WnLSyiT2zAGx`](https://explorer.solana.com/address/6WKRYj9rYx4Qb1aeB86dAHqRhj3yKrQ3WnLSyiT2zAGx?cluster=devnet). Bond mint: [`5HrfH3enHC21eD1o8eqfhDFset21mVjW4w19oBqFQMim`](https://explorer.solana.com/address/5HrfH3enHC21eD1o8eqfhDFset21mVjW4w19oBqFQMim?cluster=devnet). Test USD mint: [`8FtK9wQtUXWb1DvXpGpNJz1DYCBheZ3BkigowLYDkBrk`](https://explorer.solana.com/address/8FtK9wQtUXWb1DvXpGpNJz1DYCBheZ3BkigowLYDkBrk?cluster=devnet).
- Investors: alice [`FBhg7JGE…`](https://explorer.solana.com/address/FBhg7JGEAstoEkjx7hsz5rMac91Z4cGTRwAJV8ezrC4M?cluster=devnet), bob [`8oj1CzY6…`](https://explorer.solana.com/address/8oj1CzY6FCdZEqektG9J3mzwvxz11WtbiydnJ676uQAo?cluster=devnet), carol [`2SwDaaZy…`](https://explorer.solana.com/address/2SwDaaZyqWRB2JJZQN1qYAgWNbmM5SWbc5ZEgEwMm5CU?cluster=devnet)

`npm run markets:demo` ran 39 transactions on devnet (2026-10-13). Two attempts were rejected on-chain as intended and so have no link:

- A transfer after the record date failed with `TransferLocked`.
- Alice's second coupon claim failed with `AlreadyClaimed`.

The final redemption left a supply of 0 and the instrument Redeemed. Summary and snapshots: `.data/markets-demo/latest.json` (gitignored).

| # | Step | Tx |
|---|---|---|
| 1 | create test USD settlement mint (6 dp) | [o11SzwYnkc…](https://explorer.solana.com/tx/o11SzwYnkckYXa5sG9tRQ8G9xL4PnaYJ4XKy1w4tRJpzJsiEryAN9eNbXKPaNPxYVcEvrV5oEMNhpog5KKptFo4?cluster=devnet) |
| 2 | mint 1,000,000 test USD to the issuer | [jXXmH71K1k…](https://explorer.solana.com/tx/jXXmH71K1kPQyt8YrAJQSq1Ww5kkaa3NLe5SoDRsUQ5MfTzvjg9fEYyCFR6NGu7d3oRx2hYth2JM1FVSwyndUbY?cluster=devnet) |
| 3 | fund investor wallets with 0.02 SOL for fees | [57uvhg2PBo…](https://explorer.solana.com/tx/57uvhg2PBox1pekj5chF9Y9BgbXGGGxhjxRAK4JkMs2muiWCyWcjDMZeTQGLcTEeZPCUpE1JcJfegfYYFhRrmm55?cluster=devnet) |
| 4 | initialize_instrument PKZ27 (12.5% semi-annual) | [4Dfc992bhp…](https://explorer.solana.com/tx/4Dfc992bhpSAoJD9GnvjaHKj7hCcKDvwrCZrJkdd5GvMaf6sRG1krnBzGrNKoqsAUWtyc2hjN3k1CG2PGTKMhgfj?cluster=devnet) |
| 5 | issue 50 units to alice | [DVUnmJarKz…](https://explorer.solana.com/tx/DVUnmJarKzFhfBeacacRu9h2tycWaPaeyX2szFAsh7SUE5SYRxRt62EyiT9wdRHGW94AUS6H4EyX3m5jt2hxHdb?cluster=devnet) |
| 6 | issue 30 units to bob | [44Bm9BCq7N…](https://explorer.solana.com/tx/44Bm9BCq7NLviBV56S5dQqPZaUwdWnGjSiGdeywZ4NDBuQFWBGRZq6adkCLxo78bnvqmi4GstWbYhzSGv6GZYH8z?cluster=devnet) |
| 7 | issue 20 units to carol | [4aF2nJKnyq…](https://explorer.solana.com/tx/4aF2nJKnyqesXtyq6ANi6hub9e673XNjWpXVcXbFSS7Hfwv6nDG3EKfErVwHeqPD73iMfLfYYidTvpcgYAMgUYDK?cluster=devnet) |
| 8 | coupon: announce | [4kwrEnnceC…](https://explorer.solana.com/tx/4kwrEnnceC9mWe7iVFSWbNswF3aehotDJWsDH1y9kSLMg8svkuLPLw7e3gEPKTfTvcyjtMthPyVjxvwLSd2qcqtf?cluster=devnet) |
| 9 | transfer 5 units carol → bob before record date | [2KioeoWipV…](https://explorer.solana.com/tx/2KioeoWipVihVKVdRPZ6zZntv3sHBnB77YvRVKRDgrxriL9iDmWPsnwihvGePLfiFZ8A3aN7oeauCVFcv7K9Vq64?cluster=devnet) |
| 10 | coupon: lock_record (crank) | [5QdTc2z1X8…](https://explorer.solana.com/tx/5QdTc2z1X8WSJp7kUhqjXeDvs6i4ikb34nQ9G9pa4wDrhJHYTXQ4WAH7aJVTNg45Xodebkj9nKs3nM5JNtLmJkGK?cluster=devnet) |
| 11 | coupon: post_snapshot root 9dea96c0ac44… | [3RNUhF3x7C…](https://explorer.solana.com/tx/3RNUhF3x7Cfy5up2GFSifWoZadsgVjCDuhb6Vm4NPh1qwnne9amWeh7LMS9TAe1pys3nMrPtYrWN2yEX5DrtbcTP?cluster=devnet) |
| 12 | coupon: fund $6,250.00 | [3HWggDnDoX…](https://explorer.solana.com/tx/3HWggDnDoXN2PE46hcg9U3cR3U1CGeAeTnmYfjjZBDqH77P9qv3jxcNiCz2xvNYGLqAvgmNMQG31rDUF8swQsqhs?cluster=devnet) |
| 13 | coupon: alice claims (pull) | [4hdxFJm1PJ…](https://explorer.solana.com/tx/4hdxFJm1PJbbazL4rj2CjsabXTJuyNaUVrUW4s6HRnjMKV4SfWKx3o2zz1BrqFeBxx4TucYRBKnucv7vgB2kMvvV?cluster=devnet) |
| 14 | coupon: paying agent pays bob (push) | [2XM6AJxbCg…](https://explorer.solana.com/tx/2XM6AJxbCgNKUb553DDxpKjvfweH2fQaBE1JyYUKW3WCbUDicHiJhNxnswr57dRPivusKbmTSWuQ4mM42W4Z6iNa?cluster=devnet) |
| 15 | coupon: paying agent pays carol (push) | [DnAx8Hgbwv…](https://explorer.solana.com/tx/DnAx8HgbwvvZyiKzEcGixXE1cSzEcc7P7JsSp9SeGxKqDrmWiuRYZcmM4LHnuWpHCEZBsLfHa42fBczUS9r7jLF?cluster=devnet) |
| 16 | coupon: settle | [5JkWJdLgeQ…](https://explorer.solana.com/tx/5JkWJdLgeQiNKBft2gbpGGvHsiYypSabjNCDUD61CG5tL3xeCxy2VnkaomTEHTAfpUAiYr2BtjpRbMzK8SHnh3XZ?cluster=devnet) |
| 17 | vote: announce | [4JAwubJBBn…](https://explorer.solana.com/tx/4JAwubJBBnZGosUj1s9Rz1fDA82n2KRoR5sw439DSgKMp8tU6BwRT9RGDTXnyityDhSZzVJHG3oUf7KJAjYQ9WXX?cluster=devnet) |
| 18 | vote: lock_record (crank) | [3ygkMBossR…](https://explorer.solana.com/tx/3ygkMBossRP1r6pDwDA7Vc1LFVnQmVDr7cM3uVyZofsn1k9YpKybwCEe1AUTPbyGD3e9ffZu7NjrLo7dcC984u3T?cluster=devnet) |
| 19 | vote: post_snapshot root d39ebd12b889… | [2JehFKKnq7…](https://explorer.solana.com/tx/2JehFKKnq7NuxxAan7pChPa3LaR9Jnxo2Y35fxMxRdCxTWTauzTu72nMRUx2aChMujVPJ5JBPvSTT8bEjmuuLzB8?cluster=devnet) |
| 20 | vote: alice votes For (50 units) | [c7NQfnBBsE…](https://explorer.solana.com/tx/c7NQfnBBsExwLHFYD4CBTGPEkJvGHM9Xkm4FzysM8gz1WZtyrfcBHDsf6RW6CS8C1MXTnxUgPKYbnXKPWLCxo6C?cluster=devnet) |
| 21 | vote: bob votes Against (35 units) | [2Vetr5Xio7…](https://explorer.solana.com/tx/2Vetr5Xio71c7Ue8qHWUBnp9NbkuUYay2Ao3Ve8KsaDhmGXD3koFt2S3WQZPbFK94XaX1ueuXw8sEP1G3mzPseP?cluster=devnet) |
| 22 | vote: carol votes For (15 units) | [5aW9nnSg9t…](https://explorer.solana.com/tx/5aW9nnSg9tJPTXTFNHeKwXXichpKYeQ62iNmDYM445SgYBR4N3oFVjfWeCxG2hpbY4BUg48ueFVzEXVrUKJNMgiv?cluster=devnet) |
| 23 | vote: settle (close tally) | [58mDp9v3fd…](https://explorer.solana.com/tx/58mDp9v3fd9B2UohjN7NfTK8s68ZSeS2YJWhQHL7VNn3CsiRSiAcDnrKCddDcBQJvLa5PrB7YfsLKky45Zhu1SFH?cluster=devnet) |
| 24 | partial: announce | [3vL6NritVV…](https://explorer.solana.com/tx/3vL6NritVV4bQbYMBgkzf4f5VsPT5Gu1oHUsoLhpDMbREvjCw8qepuuJLShma5YZsRUCpXeKVSQ9DtZUMiEopVsd?cluster=devnet) |
| 25 | partial: lock_record (crank) | [52VRVAWKAE…](https://explorer.solana.com/tx/52VRVAWKAE87PMeNVYVh4N7UFfDKBMmjatPdV6wKaNSAQPrLUa6TZ7MYJAYGCCzE3YySAtw3ypgZH1kGMS2ASB28?cluster=devnet) |
| 26 | partial: post_snapshot root 1bfa6164a421… | [2QAw65Vqiy…](https://explorer.solana.com/tx/2QAw65VqiyPMqimv2eh8Nwh7KZwJohmaP394h5PtkT7GgpRdZb6S4bVe5J7j66FZTCbfiz1GqVNLgtEM5VKStpoz?cluster=devnet) |
| 27 | partial: fund $23,000.00 | [45i14VykFk…](https://explorer.solana.com/tx/45i14VykFk7qnQvFhWFLnS5UJjBfbHxh5mw7mtcQngqZTd5Ce96ZhPY7yYPZVa26f3KjswjVa7YjsnhwCqdXFtbX?cluster=devnet) |
| 28 | partial: paying agent pays alice (push) | [H2zzhVsKSm…](https://explorer.solana.com/tx/H2zzhVsKSmFUwhGUvFzAgtM49Wjp9e8RrPAh8s6MyAoKDWvDMGH5RPQphqA7S9EboTw7SUycofnZ8N7aVS6nVjN?cluster=devnet) |
| 29 | partial: bob claims (pull) | [35s8QS5ZCU…](https://explorer.solana.com/tx/35s8QS5ZCUoCA6HWVz91QUQd79aqdPqm418RaMGDxeAgsrt5n6P3cQj9AeZD5JyJgPnW6D93URDdJk7JSeibTjVr?cluster=devnet) |
| 30 | partial: paying agent pays carol (push) | [2tERQpjwi9…](https://explorer.solana.com/tx/2tERQpjwi9ys54fLvGPFWXFsavGaaqH99yn2xYbL3jTCqnTawU3vAdeJutiUntsFvLfnuxSKR5fiVutnN8so2h9F?cluster=devnet) |
| 31 | partial: settle | [3EUQVGgXBZ…](https://explorer.solana.com/tx/3EUQVGgXBZJCs2hZy2HohDJSZpx3guVBTPk9pi1T9hCmdj7DBoroYmXQZCP9totAedsCnSW5cRXffaie7tDaxrQB?cluster=devnet) |
| 32 | final: announce | [5G195P6LMY…](https://explorer.solana.com/tx/5G195P6LMYEBbfqnaepGuTgVaEMFjupZuiBjepPz56fdSPJ6WtakhuCSskoSTwq6WmJXag2fcLm1uEzzTKyYjJxt?cluster=devnet) |
| 33 | final: lock_record (crank) | [5BQoM1fTwE…](https://explorer.solana.com/tx/5BQoM1fTwERc3PMM1atzWyLDJCp2KpUM3tR2yp13eY23UJGyRpSjFpGQSoZU1DugirtPQwAAjcfVAnJxmBE6w4n6?cluster=devnet) |
| 34 | final: post_snapshot root 6c1ad956de5d… | [3ynwAspy3z…](https://explorer.solana.com/tx/3ynwAspy3zSETswoCqPHwRGf7SNnUDsrAuv66pLXjYtQMe1EUm6yYQ5Bg2wE4X645s7BnVVHJo2x5Wjn1rBVTZw3?cluster=devnet) |
| 35 | final: fund $81,812.50 | [38492xuU72…](https://explorer.solana.com/tx/38492xuU72AuZLSWrcBqxbeM9vbiZTw9yfGzfMiTg6QkZgTuddgKHHfg2f9kTTrBcH66TSjGnLQY2H3Qs6cUiW8b?cluster=devnet) |
| 36 | final: paying agent pays alice (push) | [3MtSzd4jWG…](https://explorer.solana.com/tx/3MtSzd4jWGDe9XH4hYLJ1WCwdU4su4jzdVZYogoeerfmmKpXLH6i28gPd6gq5se9sJu6v2JntrXrTxqzqdm1fCmQ?cluster=devnet) |
| 37 | final: paying agent pays bob (push) | [3Z6rkRG2ZH…](https://explorer.solana.com/tx/3Z6rkRG2ZHnxuLFZ6HZE6bVBtwUqA7MWyogbZpxsGZ3bbgpTTYBaeREKHzx7LLa9zoFyN3irf4XQh2V47hK863dR?cluster=devnet) |
| 38 | final: carol claims (pull) | [2KkvpZzbaa…](https://explorer.solana.com/tx/2KkvpZzbaaqTJE5JZwSGFMqq6EsokCy3gKv41xjBrPUeZGxMXPmTtwHJShoX18NWwzazCZvjkNGXHXdp84b9hcDk?cluster=devnet) |
| 39 | final: settle | [yxNiPMuNHW…](https://explorer.solana.com/tx/yxNiPMuNHWUA6o5ynBb6Mw26HrAe2TPP9aHYeAkhsFwaaTNoTHMABjRTDVwU1jdVe4AAwX3JjCVcPFe5KT6vfQi?cluster=devnet) |

## Deploy

Already done on devnet. To redeploy or upgrade from the CLI wallet:

```bash
solana program deploy programs/plain-markets/target/deploy/plain_markets.so --program-id programs/plain-markets/target/deploy/plain_markets-keypair.json --url devnet
```

```bash
npm run markets:demo
```

The upgrade authority is the CLI wallet. To rebuild, run `npm run markets:build`; it runs
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
