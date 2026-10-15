# Plain Markets: real bond purchases (delivery versus payment)

Bonds are no longer allocated for free. An investor taps **Buy** in `/bonds`, approves once with the
email signer of their Crossmint smart wallet, and one Solana transaction moves their devnet USDC into
the issuer's proceeds vault and mints the bond units to them. Either both legs happen or neither does.

| | |
|---|---|
| Program | `plain_markets` `H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm`, upgraded in place on devnet (same id, same upgrade authority `82dzmeh7…`) |
| Upgrade | extend +81,920 bytes, then deploy: [`5Hvmw16h…`](https://explorer.solana.com/tx/5Hvmw16hemivKdRhmUKuNr1hmLybJw1U9uFY1q4sLAmwbP8Y4vfKEqbEoNFics38DFLKLbDPPY1WuNXWfuKExcZw?cluster=devnet) |
| New instrument | **PUN27** · Plain USDC Note 12% 2027 · mint [`5nkJFLW1m1hXVony9ouiTKPoweXWb78KB8KeBGsJjyuC`](https://explorer.solana.com/address/5nkJFLW1m1hXVony9ouiTKPoweXWb78KB8KeBGsJjyuC?cluster=devnet) · instrument `HvhfgAbwyUF1RDsufDbC1wg6ez4uFUSYwhCMU714gY9S` |
| Settlement | Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| Terms | 1 USDC face per unit, 12% a year paid quarterly, issued 15 Oct 2026, matures 15 Oct 2027 |
| Offering | `Fmp3VZUqodR8NZd5UTmxD7WQShmRA8rsH6imLfEksywx`, at par (1 USDC/unit), open until 13 Apr 2027, 100,000 units, 1,000 per wallet; proceeds vault `9GeGwh3A5swYqYb8awfJJdgyCBprhu1GC2w9RiLTrVF2` |
| Seed txs | [initialize_instrument](https://explorer.solana.com/tx/2KFpxcfDaWGwS4dyGLUdnVBqpnPGh9amr68LTjJUXduVYfq5m7kbaTLRAbni23AbeyuQB2anFUnRph5Sj6qZEjg8?cluster=devnet) · [open_offering](https://explorer.solana.com/tx/34qsEG3d3qxHABPn4jXF7UAdTWuDXHkqR9nd8pYSLWE52tAH6wZewFiaFTyN5FYezUp8Vi97ygybo8dkcFCKwcfC?cluster=devnet) |
| Default offering | `MARKETS_INSTRUMENT_MINT=5nkJFLW1m1hXVony9ouiTKPoweXWb78KB8KeBGsJjyuC,7ye1Ny5cLax3FRP4YFAQsBTzf2MMMeAPBHwp7NHaGb7g`: PUN27 first, PDB28 stays listed as an earlier issue (not sold in Plain, its payments still shown) |

**Deploy note:** set `MARKETS_INSTRUMENT_MINT` as above on the deployment. Nothing was pushed or deployed to Vercel.

## 1. Program changes

New state lives in new PDAs, so the `Instrument` layout and every existing instrument are unchanged.
New error codes are appended after `MathOverflow`, so earlier codes keep their numbers.

| Item | What it does |
|---|---|
| `Offering` PDA `[b"offering", instrument]` | issue price (settlement base units per unit, fixed), sale window `start_ts <= now < end_ts`, total cap, per-holder cap, sold units, lifetime proceeds, withdrawn, purchase count, closed flag |
| Proceeds vault `[b"proceeds", instrument]` | token account in the settlement mint, authority = offering PDA |
| `open_offering(params)` | issuer only; price > 0, window ends after now and no later than maturity, caps > 0, per-holder ≤ total, `cap × price` fits u64; instrument must be Active |
| `subscribe(units, max_payment)` | buyer signs as token authority only (pays no lamports). Checks: units > 0, instrument Active, `now < maturity`, offering not closed and inside its window, **no pending action, no open redemption, not inside the ex-date lock** (exactly the `issue` rules), allowlist entry required when the allowlist is on, `sold + units <= cap`, `buyer bond balance + units <= per-holder cap`, `units × price <= max_payment`. Then `TransferChecked` buyer → proceeds vault and `MintTo` (instrument PDA authority) into the buyer's **canonical Token-2022 ATA**, in the same instruction |
| `withdraw_proceeds(amount)` | issuer only, to an issuer-owned settlement account; amount ≤ vault balance |
| `close_offering()` | issuer only; stops sales for good, proceeds stay withdrawable |
| Events | `OfferingOpened`, `UnitsSubscribed` (buyer, units, price, amount, sold, supply), `ProceedsWithdrawn`, `OfferingClosed` |

**Allowlist choice: require a prior allow, no auto-allow.** `subscribe` follows `issue`: when the allowlist
is on, the buyer must already have an `AllowEntry` (issuer `allow_holder`). An offering can't add wallets
to a restricted register by itself. PUN27 has the allowlist off (open retail offering); eligibility is
Plain's sign-in. The `max_payment` argument is an on-chain slippage guard against a changed price; the
server always sets it to exactly `units × price`.

Tests (`programs/plain-markets/programs/plain_markets/tests/offering.rs`, LiteSVM, 8 tests, plus the 17
existing lifecycle tests, all green):

- DvP balances (buyer USDC −cost, vault +cost, units minted, supply, counters, top-up purchases, issuer `issue` still works next to the offering)
- underpay (`max_payment` too low; insufficient USDC reverts both legs)
- wrong mints and accounts: fake settlement mint (`has_one`), fake-token account with the real mint declared, payment redirected away from the vault, someone else's USDC account, delivery to someone else's ATA, another instrument's mint, an instrument with no offering
- per-holder cap (in one go and by topping up) and total cap (sold out)
- window: before start, after end, after maturity, closed offering; bad offering parameters; stranger opening an offering
- pending action (after announce) and ex-date lock (funded, inside lock); reopens after the payment date
- allowlist: no entry, another wallet's entry, then allowed
- proceeds: stranger, issuer-signed withdrawal to a foreign account, buyer claw-back, over-withdrawal, zero, then partial and full withdrawal

## 2. Smart-wallet purchase: validation design

A purchase is a second strictly validated intent, `markets-subscribe`, run by the same executor and
state machine as Kamino (`lib/kamino-smart-wallet-executor.ts`: durable provider-create claims, wallet
lease, `CREATE_UNKNOWN` recovery, setup-required initialization, status reconciliation). Each intent
type has its own validators; the Kamino validators were not changed (the Kamino receipt module only
exports a few helpers now).

1. **Build (server, `lib/markets/purchase-server.ts`).** Fresh RPC reads, never the indexer cache: the
   pinned program is executable; the mint is a listed instrument; its settlement is Circle devnet USDC on
   SPL Token; the offering, the wallet's bond and USDC accounts. `purchaseBlocker` refuses early, in plain
   words, whatever the program would refuse (closed, window, lock, pending action, sold out, holder cap,
   USDC balance, allowlist). The payload is `[bond ATA create-idempotent if missing] + subscribe(units,
   units × price)`, built with the Anchor client, fee payer = the wallet (Crossmint replaces it).
2. **Intent (pure, `lib/markets/purchase.ts`).** `validateSubscribeIntent` re-derives every account from
   the pinned program id and the mint (instrument, offering, proceeds vault, the wallet's Token-2022 bond
   ATA and SPL USDC ATA, allow entry or the program-id placeholder), checks the exact 24 data bytes
   (discriminator, units, `max_payment = units × on-chain price`), all signer/writable flags (only the
   buyer's writable bit may differ, because it is the fee-payer placeholder in a compiled template),
   ATA creation only for those two accounts, paid by the wallet, and nothing else: no extra program,
   subscribe last, at most 1,000 units. The server runs it on its own build, so the Anchor builder and
   the independent derivation must agree.
3. **Envelope (unchanged code).** `inspectKaminoSmartWalletEnvelope` checks project sponsorship, the
   sponsor fee payer, exactly two signers, the single XmSwi wrapper, that the decoded wrapped
   instructions equal the template byte for byte, the compute budget and rent pre-funding bounds, and
   runs the wrapped simulation.
4. **Approve (client, `lib/kamino-smart-wallet-client.ts`).** The same chain: switch to the email
   signer, `wallet.approve`, status as the only authority, setup-then-continue with the same bond and
   units. Bond purchases use their own browser journal (`plain:markets-purchase-operation:v1:`), so a
   Kamino screen never resumes a purchase and the reverse.
5. **Receipt (`lib/markets/purchase-receipt.ts`).** On the finalized transaction only:
   sponsor = fee payer and first signer, the wallet never signs as a keypair, the top-level shape (compute
   budget, optional sponsor → wallet rent transfer, wrapper last), the wrapped payload equal to the reviewed
   instructions and re-validated as an intent, the ATA CPI flow (size query, create-account owned by the
   right token program, immutable owner, init with the wallet as owner), and the subscribe subtree being
   exactly `TransferChecked(wallet USDC → proceeds vault, cost, 6 dp, wallet authority)` then
   `MintTo(bond mint → wallet bond ATA, units, instrument authority)`. Then the balances: **wallet USDC
   −cost exactly, vault +cost exactly, wallet bond +units exactly**, no other wallet account of either
   mint moved, the sponsor paid the fee, and the wallet's lamports dropped by at most the rent of the
   token accounts it created in this transaction.

Tests: `tests/markets-purchase.test.ts` (12) mirrors the Kamino intent/receipt/client tests: the pinned id
and discriminator match the IDL; the Anchor build validates; underpay, unit mismatch, wrong settlement
mint or token program, a cheaper price; swapped vault/mint/bond account, missing signer, extra account,
foreign program, smuggled transfer, reordered or duplicated instructions, foreign ATA payer or target;
receipt with wrong payment amount, destination, delivery units or account, extra CPI, wrong deltas, failed
transaction, foreign fee payer, wallet lamport drain; client mint binding; one-tap setup-then-buy; purchase
terms in the investor view.

## 3. App changes

- **Investor (`/bonds`, `/bonds/[mint]`).** `BuyButton` and the purchase drawer
  (`components/app/bonds/bond-purchase.tsx`): units (stepper or typed, capped by the per-wallet room, units
  left and the USDC balance), preview (you pay, USDC balance, coupon per period, yield, maturity), one tap,
  spinner, **Done** with the explorer link, error with details and Retry, resume after reload. Offerings
  carry `purchase` terms from the on-chain offering; when buying is not possible the button is disabled
  with the reason. `POST /api/bonds/[mint]/allocate` and the Get allocation drawer are removed.
  `POST /api/bonds/[mint]/purchase` prepares the operation; status and wallet setup reuse
  `/api/kamino/smart-wallet/status` and `/initialize`, which now dispatch on the record's intent.
- **Issuer console (`/issuers` → Offering tab).** Units sold against the cap, proceeds, what is in the
  vault, the window, every buyer with units, amount and a link per payment transaction (decoded from
  `UnitsSubscribed`), **Withdraw proceeds**, and **Issuer allocation** (issuer action, no payment, capped by
  `MARKETS_ALLOCATION_*`) as the only free issuance left. Instruments can be switched with `?mint=`.
- **Register and coupons.** Buyers are register candidates (from the offering's events), so record-date
  snapshots include smart wallets that bought, and coupons on PUN27 are paid in real devnet USDC.

## 4. Devnet end to end

`npx tsx scripts/markets-purchase-e2e.ts --buyer <keypair.json> [--units N] [--coupon] [--http <base>]`

A script has no Crossmint email signer, so it builds exactly the server's payload, validates it with
`validateSubscribeIntent`, simulates it, and signs it with a local keypair buyer instead of the wrapper.
The finalized transaction is then checked with the same trace and delta verifiers as the smart-wallet
receipt (`verifyPurchaseTrace`, `verifyPurchaseDeltas`; payload at stack height 1 instead of 2).

Run on 15 Oct 2026, buyer `8Mdmu9GN72J1scQC15SAa9pvDGpNMNJhxrPbCi3nQ6iD` (a local devnet keypair holding 5 USDC):

| Step | Result |
|---|---|
| Buy 2 units (bond ATA created in the same tx) | [`2SRZ5i3y…`](https://explorer.solana.com/tx/2SRZ5i3yCxRYz3Ya5mVVa4a18jpwfDXpikEzGuDk29NvsuRPy45kJRneBnhAFtczBGMiuvfhCh3eG6dCrCyYe4xr?cluster=devnet): USDC −2.000000 exactly, vault +2.000000, +2 units; receipt verifiers passed |
| Buy 1 more unit | [`2fLp71xo…`](https://explorer.solana.com/tx/2fLp71xoKt4DvZeDcwuetcdvMqtRM2vo4sSj9AsU42a1y76teBXA4r76LaNUuxk9NURpMVNTpy6uUgpadC6EYqk7?cluster=devnet): −1.000000 / +1.000000 / +1; offering 3 sold, 2 purchases decoded from `UnitsSubscribed` |
| Issuer withdraws proceeds | [`4o3DEGTJ…`](https://explorer.solana.com/tx/4o3DEGTJbddAMDCBr8ePaZmJ36wUekJZc6QyCBpkzZYmLFbXDDsmcPAiP4KXvCUud73yRp5fhLAWFyyVdgDK3YNs?cluster=devnet): 3.000000 USDC to the issuer |
| Coupon 1 on PUN27 (live timing) | [announce](https://explorer.solana.com/tx/3gEJ1JLKN5H8XLWdKrLrtBuGLsYMdHvhHTKXE1QDQp2UCLt5DPtAR95CiTjt4z5sopFJjUrJFbeL7HRC7Bq5QgPv?cluster=devnet) · [lock_record](https://explorer.solana.com/tx/4C2XG85cCCgGQD1jAUnJvBMBYKHANh4mMZuv4c2KXZh9WtZNev1QpAkWbiBsJ5qujR9q6gvf94rENhmuk34MG8aP?cluster=devnet) · [post_snapshot](https://explorer.solana.com/tx/4UV3yMYDV6qe2WnKrbkzWqpm8eGshJpKA5F2zHFthwzg6F5z1LTeEn3Nka2bGfSNoCMDBBL2yohfGJuWqRCEkiuJ?cluster=devnet) (the buyer came from the offering events) · [fund](https://explorer.solana.com/tx/cPaCeeUUHjJLHATkssrtBmXxUXQnpWaqYD8HeFTY3FkNZBDfC6j3zRGa4nzQGJt6LnTBXzbbaLE47dNESLTVBqU?cluster=devnet) with the withdrawn proceeds · [pay](https://explorer.solana.com/tx/3DMXwsBKk8f318meeHyDEW88h3LBHdxBoFdAekHWpmUj8tFExxU8fRpBZoSvNZktiNwF27yWu9mAnKJJkFigwnUP?cluster=devnet) · [settle](https://explorer.solana.com/tx/4Hwfbd8yiEmv93czQNnZwp6Pe99NDASmxvG21FuS9NUkbysLWhrEAxGoGvFq9hSo3xBefMWKFtpSyKviZg4LcK1w?cluster=devnet) |
| Buyer's USDC | 2.000000 → **2.090000** (3 units × 0.03 USDC coupon, real devnet USDC) |
| `GET /api/bonds` (smoke session) | default offering PUN27, $1.00/unit, open, 3/100,000 sold; position 3 units |
| `POST /api/bonds/[mint]/purchase` (smoke session) | 503 at Crossmint wallet verification, as expected (see 5) |

The coupon used period 1 early (the quarterly schedule's first date is 15 Jan 2027), so the next
PUN27 coupon is period 2. In the browser, the console's Offering tab showed the live numbers and the
buyer with its payment link; the Buy drawer (mounted without the signed-in shell, as in the investor
report) showed the preview and, on tap with the smoke session, the error state with Retry.

## 5. What needs a real login to verify

Everything Crossmint-specific: the smart wallet lookup (`verifyCrossmintKaminoWallet`), the wrapped
transaction and its simulation, the email-signer approval, and the finalized wrapped receipt for a
purchase. Through `/api/bonds/[mint]/purchase` a smoke session stops at the first step (the smoke wallet
is not a Crossmint wallet): 503 "Bond purchases are temporarily unavailable", nothing created. The
same chain already runs in production for Kamino deposits, and the purchase reuses it unchanged.

Manual test (Plain on devnet, signed in with email, the wallet holding ≥ 2 devnet USDC, e.g. from
https://faucet.circle.com):

1. Bonds → the first offering is **PUN27** at $1.00 per unit, 12%, quarterly; PDB28 below it says "Not offered in Plain".
2. **Buy** → 2 units → preview shows "You pay $2.00", the USDC balance and "$0.06" per quarter → **Buy 2 units for $2.00**.
3. First purchase on a wallet that was never used on-chain: a one-time wallet setup approval comes first, then the purchase continues by itself.
4. Spinner, then **Done — 2 units bought** with **View transaction**. On the explorer: one transaction, the XmSwi wrapper, `subscribe` with a USDC `TransferChecked` to `9GeGwh3A…` and a `MintTo` of 2 units.
5. The position shows PUN27 · 2 units; the USDC balance is $2.00 lower.
6. `/issuers` → Offering: sold +2, proceeds +$2.00, your wallet in Buyers with the payment link. **Withdraw** moves the vault to the issuer.
7. Optional: announce a coupon on PUN27 in the console, run it to payment, and see the coupon arrive in USDC in Portfolio/Activity.
8. Negative checks: Buy is disabled with a reason while a coupon is being recorded (pending action) or inside the ex-date lock; more than 1,000 units total per wallet is refused.

## 6. Limits and follow-ups

- **Per-holder cap is a holding cap.** It checks the buyer's bond balance after the purchase. A buyer who
  transfers units away can buy again; a per-buyer lifetime cap would need a per-buyer PDA (and its rent).
- **Issuer console writes are unauthenticated** (as before this change): anyone who can reach
  `/api/markets/*` can trigger issuer operations on devnet, now including issuer allocation (capped) and
  withdrawals (always to the issuer's own account). Gate the console before it leaves devnet.
- **Offering reads download each purchase transaction once** (`getTransaction` per signature, cached in
  memory and in browser localStorage). Fine for a demo; an indexer would replace it at volume.
