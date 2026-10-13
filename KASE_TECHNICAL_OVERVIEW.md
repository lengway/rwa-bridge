# Corporate Actions on Solana — technical overview

Plain prototype built for the **Superteam Kazakhstan x KASE side track "Corporate Actions on Blockchain"**.
It is not affiliated with or endorsed by the Kazakhstan Stock Exchange.

- Live page: `/kase` (e.g. https://plain.lengway.me/kase)
- Network: **Solana devnet**
- Code: `lib/kase/entitlements.ts` (pure math, unit-tested in `tests/kase-entitlements.test.ts`),
  `lib/kase/devnet.ts` (on-chain executor), `app/api/kase/route.ts` (API), `components/kase/kase-console.tsx` (UI)

## What it does

A test tokenized bond goes through its full lifecycle, each step a real devnet transaction:

| # | Corporate action | On-chain effect | Memo |
|---|---|---|---|
| 1 | Issue & distribute | Token-2022 bond mint created (0 decimals, permanent delegate, on-mint metadata incl. terms); 100 bonds minted to 5 holders | `KASE-ISSUE <mint> batch=n` |
| 2 | Record date | Holder registry read from chain at one slot → canonical JSON → sha256 → hash anchored on-chain | `KASE-RECORD <mint> <date> coupon-1 slot=<slot> sha256=<hash>` |
| 3 | Coupon payment | One atomic tx paying every holder on the snapshot in the settlement token | `KASE-COUPON <actionId> period=1/4 perBond=50USD snap=<hash>` |
| 4 | **Additional action: partial early redemption (pro-rata buyback, 20% at par)** | Fresh record-date snapshot; one atomic tx: cash to each holder + burn of the tendered bonds | `KASE-BUYBACK <actionId> 20% pro-rata at par snap=<hash>` |
| 5 | Redemption at maturity | Fresh snapshot; one atomic tx: principal + final coupon to each holder, burn of all bonds, mint authority revoked (instrument marked redeemed, supply provably 0) | `KASE-REDEEM <actionId> principal+final-coupon snap=<hash>` |

## Instrument

| Term | Value |
|---|---|
| Name / symbol | Plain Test Bond 10% 2Y / PTB10 |
| Face value | $1,000 |
| Coupon | 10% annual, semi-annual (2 periods / year) |
| Tenor | 2 years (4 coupon periods) |
| Units | 1 token = 1 bond (0 decimals) |
| Settlement | Test USD token, 6 decimals, minted by the issuer (stands in for fiat) |

Terms are written into the mint's Token-2022 metadata (`terms` field:
`face=1000USD;coupon=10%;freq=2/yr;issue=…;maturity=…;settlement=<mint>`), so the instrument is self-describing on chain.

## Architecture

```
Browser (/kase)  ──POST {command}──▶  app/api/kase/route.ts
                                        │  per-IP rate limit, command whitelist
                                        ▼
                                   lib/kase/devnet.ts
                                        │  single-flight queue + strict phase machine
                                        │  issued → recorded → coupon_paid → bought_back → redeemed
                                        ├── lib/kase/entitlements.ts  (pure bigint math, snapshot hashing)
                                        ▼
                         Solana devnet: Token-2022 + Associated Token Account + Memo programs
```

- **Issuer / paying agent**: one server-side devnet keypair (`KASE_ISSUER_SECRET`). It is mint authority, freeze authority,
  metadata update authority and **permanent delegate** of the bond mint, and owner of the settlement treasury.
- **Holders**: five wallets derived deterministically from the issuer secret (`sha256(secret ‖ "kase-holder-i")`).
  They never sign anything: the issuer pays for their token accounts, and the permanent delegate lets the issuer
  retire bonds at redemption without holder signatures — the same power a registrar/CSD has over a register.
- **State**: the action log (signatures, snapshots, entitlements) is cached in `.data/kase-state.json`;
  balances shown in the UI are always read live from chain. Every fact the log contains is independently
  verifiable from the memos and token balances on devnet.
- **Safety**: actions run one at a time through a queue; each step is only valid in the previous step's phase,
  so a coupon cannot be paid twice against the same snapshot and redemption cannot precede the buyback.
  Re-issuing a fresh instrument is rate-limited. All tokens are worthless devnet test tokens.

## Record-date logic

1. Read the bond mint's token accounts. The registered holders' ATAs are always included; other accounts are
   discovered via `getTokenLargestAccounts` when the RPC allows it (the public devnet RPC excludes Token-2022 from
   `getProgramAccounts`; a production deployment would use an indexer or a full RPC).
2. All balances are fetched with **one** `getMultipleAccounts` call, so the snapshot is consistent as of a single
   slot (`context.slot`), which is stored with the snapshot.
3. Holdings are normalised (zero balances dropped, duplicate owners merged, sorted by owner) and serialised to
   canonical JSON: `{instrument, recordDate, slot, holdings:[[owner, units], …]}`.
4. `sha256(canonical JSON)` is written on-chain in a Memo transaction signed by the issuer.
5. Entitlements are computed **only** from the snapshot, never from live balances, and every payment memo carries
   the snapshot hash — anyone can recompute the hash from the published JSON and match it to the payments.

Transfers after the record date do not change who is paid for that period (ex-date semantics).

## Entitlement formulas

All money is integer micro-USD (`bigint`, 1 USD = 1,000,000), so there is no floating-point rounding.

- **Coupon per period**: `units × face × rate ÷ frequency`
  → `10 × $1,000 × 10% ÷ 2 = $500` (the track's example; unit-tested).
- **Partial early redemption (pro-rata buyback)**: `tendered = floor(units × pct)`, `cash = tendered × face × price`
  (price = 100% of face here). Rounding down never redeems more than a holder owns.
- **Redemption at maturity**: `units × (face + face × rate ÷ frequency)` = principal + final coupon.

Worked example from the verified run (holdings 10 / 25 / 40 / 5 / 20 = 100 bonds):

| Holder | Bonds | Coupon ($50/bond) | Buyback 20% @ par | Bonds left | Redemption ($1,050/bond) | Total received |
|---|---|---|---|---|---|---|
| A | 10 | $500 | 2 → $2,000 | 8 | $8,400 | $10,900 |
| B | 25 | $1,250 | 5 → $5,000 | 20 | $21,000 | $27,250 |
| C | 40 | $2,000 | 8 → $8,000 | 32 | $33,600 | $43,600 |
| D | 5 | $250 | 1 → $1,000 | 4 | $4,200 | $5,450 |
| E | 20 | $1,000 | 4 → $4,000 | 16 | $16,800 | $21,800 |
| **Total** | 100 | **$5,000** | 20 → **$20,000** | 80 | **$84,000** | **$109,000** |

These are exactly the balances read back from chain after the run (bond supply 100 → 80 → 0).

## Settlement flow

- **Coupon**: issuer treasury → each holder's settlement-token ATA, `TransferChecked` × n in one transaction with the memo.
  Either every holder is paid or nobody is.
- **Buyback / redemption (delivery-versus-payment)**: for each holder, `TransferChecked` (cash) and `BurnChecked`
  (bonds, signed by the issuer as permanent delegate) in the **same** transaction. Cash and retirement of the
  security settle atomically. Redemption additionally sets the bond mint authority to `None`, so the redeemed
  instrument can never be re-issued, and the server verifies supply = 0 afterwards.

## Solana components

| Component | Use |
|---|---|
| SPL Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) | Bond mint and settlement mint, transfers, burns, set-authority |
| Token-2022 **PermanentDelegate** extension | Issuer can burn bonds at redemption / buyback without holder signatures |
| Token-2022 **MetadataPointer + TokenMetadata** | Name, symbol, URI and bond terms stored on the mint itself |
| Associated Token Account program | Holder bond and cash accounts |
| SPL Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) | Record-date hashes and action ids anchored in every corporate-action transaction |
| System program | Account creation, rent |

No custom on-chain program is deployed: the corporate-action rules live in the issuer's server, and Solana provides
the register, atomic settlement and the immutable audit trail.

## Implemented on-chain vs simulated

| Area | Status |
|---|---|
| Tokenized bond issuance (Token-2022 mint, metadata with terms, permanent delegate) | **On-chain (devnet)** |
| Holder registry (token balances) | **On-chain**, read live |
| Record-date snapshot hash | **On-chain** (Memo); snapshot JSON kept off-chain by the issuer |
| Entitlement calculation | Off-chain, deterministic, unit-tested; inputs and outputs anchored by memos |
| Coupon payment | **On-chain** transfer of a test settlement token |
| Partial early redemption (buyback) | **On-chain**: atomic payment + burn |
| Redemption at maturity | **On-chain**: atomic payment + burn + mint authority revoked |
| Cash / fiat leg (USD, bank rails, KZT) | **Simulated**: issuer-minted test USD token, no real value |
| Holder onboarding / KYC, custody of holder keys | **Simulated**: holder wallets are derived server-side |
| Time (coupon dates, maturity) | **Simulated**: actions are triggered on demand instead of on the schedule |
| Issuer approval / multi-party governance | Not implemented (single issuer key) |

## Verified devnet run (2026-10-13)

Bond mint [`HeSaiwzSHHtqSdSMxbHTzGLCA6FDTvaC1M2cLcmUa41m`](https://explorer.solana.com/address/HeSaiwzSHHtqSdSMxbHTzGLCA6FDTvaC1M2cLcmUa41m?cluster=devnet) ·
settlement token [`9H5PQmUsmD7ohe1PZZFK2HeZAmzps9XjrLPY4NYDwkeG`](https://explorer.solana.com/address/9H5PQmUsmD7ohe1PZZFK2HeZAmzps9XjrLPY4NYDwkeG?cluster=devnet) ·
issuer [`5SA2YZgN4Lw4nrXYDxSgnXDFnMW3NUNZR51ddtYiHXkz`](https://explorer.solana.com/address/5SA2YZgN4Lw4nrXYDxSgnXDFnMW3NUNZR51ddtYiHXkz?cluster=devnet)

| Step | Transactions |
|---|---|
| Create bond mint (extensions) | [5oE7jM…](https://explorer.solana.com/tx/5oE7jMtF5mU8bQUP9dEoPih3zhrYGug4nUhJB7dorUVDgEbKu4Q7UCJJwbwwmgBb6p5FfAcfnFjPh1NWzQHAKGZK?cluster=devnet) |
| Token metadata + terms | [tTkZdH…](https://explorer.solana.com/tx/tTkZdHTPVJRFKhWZpp5JkiYdjous21hMdAKGTj6byjAYuFWWYbwFSLAPMS793CxiKBmPjb5xgdfCusgqXoorj6u?cluster=devnet), [4PTqBQ…](https://explorer.solana.com/tx/4PTqBQ5ei2sBSWWsL4JZXDKDwPjM7btv5arHhjACoVpWsSReC9H2f8m3U76vhkaJsteKtwViKTvkPe92NyNu4sM?cluster=devnet) |
| Settlement token + simulated fiat treasury | [4AUvPk…](https://explorer.solana.com/tx/4AUvPkoSK9KeqKLCWXZpGVW6bgxvruXmga897cSNyHyVWHChNtjVbhJUePmqBBnH4zpy53SHLGKLuMAyUMzBrjfc?cluster=devnet) |
| Distribution to 5 holders | [5pEdUx…](https://explorer.solana.com/tx/5pEdUxhpBLqHibftmKV2kqZFHtuBV6L8VQt2GXx13no8CknYbqpn1CbE6qqz6AdszZidFFwq3yKKwGukjkn2XvNq?cluster=devnet), [2tpt4Y…](https://explorer.solana.com/tx/2tpt4YjgNcpTnuvBHEbzkqEQ8by2uM2zCkFzNC5BwXhKuX3ztzKr9tF7oQep3p7XfEM3NDhd5hYBGH28nqtR2cTr?cluster=devnet), [3ncpuo…](https://explorer.solana.com/tx/3ncpuodZxYTg8tUzhdU1BiJMmqYbxj3aNVSttVjMKLQSvWH35NQAkbkoLfRyzBR1VRUbChMzChpCrP2Cj8gknaVs?cluster=devnet) |
| Record date (sha256 `20a70264…cbe2`) | [3mmAYC…](https://explorer.solana.com/tx/3mmAYCH2s2isy2nUeU4xuJkBnsuQ1VSmpJbjzCfR3X3q8a7LHwrSgZp5Vf2vvyYwLmZpemJxFKSFunXpyh5yLgGh?cluster=devnet) |
| Coupon, $5,000 total | [2ymJSB…](https://explorer.solana.com/tx/2ymJSBfKEP1QffxxuNvdx6NVYtniqfbT98yTNCuGEareFdXj8Eix1QYnDeqjZk3vMMb6w3vJ4pdFAzR1bERp1EEK?cluster=devnet) |
| Buyback: record date + payment & burn, $20,000 | [484Hni…](https://explorer.solana.com/tx/484HnijixmRNXBNQmVoSye7M5Cw6WNC7yphjDZWfAFMXyaeRaVng3ciZ9fwW9ECn8vt9P1NH7qEdUy3VdV3UpZdL?cluster=devnet), [57FtXC…](https://explorer.solana.com/tx/57FtXCpK4iatAWuG9PTw1UteTa1HXW8Y5SGNpCEatwJE7u7LH5YiA5NVxx8QwJWohRSJrSCVnUK6WzuGVdUuo3Bm?cluster=devnet) |
| Redemption: record date + payment, burn & mint-authority revoke, $84,000 | [TQzM9P…](https://explorer.solana.com/tx/TQzM9PCD4sKkuhGBHCvGbajWVxzgUaZk3aqGw1QBaQxLnFai3aNNxpRhj9ci3sB6T1w5QnmPb5ATQCbZqX2yt2S?cluster=devnet), [2QHJT7…](https://explorer.solana.com/tx/2QHJT7s6ton7q1EEBu1qrSTzYsZcgo3HZMoAmXxeHNK141TS4PPKyrqaStTrtfWzpJ7u2q1D3r5oXQaTZsF24uua?cluster=devnet) |

## Running it

```bash
# .env.local (server only, never committed)
KASE_ISSUER_SECRET=<base58 or JSON array secret of a funded devnet keypair>
SOLANA_CLUSTER=devnet            # optional; anything else disables the prototype
SOLANA_RPC_URL=https://api.devnet.solana.com   # optional
```

Open `/kase` and press the lifecycle buttons in order; "Reset" issues a fresh instrument. A full lifecycle costs
roughly 0.03 devnet SOL in fees and rent.

## Limitations and next steps

- Single issuer key; production would put the issuer/paying-agent role behind a multisig and add a custom program
  that enforces "pay only against an anchored snapshot" on-chain.
- Holder discovery depends on RPC capabilities (see record-date logic); an indexer removes the 20-account limit of
  `getTokenLargestAccounts`.
- Settlement token is a test token; a real deployment would settle in a regulated stablecoin / tokenized KZT and
  connect fiat rails through the paying agent.
- Transfer restrictions (KYC'd holders only) could be added with Token-2022 default-frozen accounts or a transfer hook.
