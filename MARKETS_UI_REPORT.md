# Plain Markets UI — report

Branch `claude/markets-ui-9ae2c8`. Issuer console and public verifier for the corporate-actions engine in
`docs/kase-v2-spec.md`, built against a service interface and a simulated ledger that enforces the same rules
as the program. Wiring the real program client is a one-line swap (see "Swapping in the real client").

Checks: `npm run lint`, `npm run typecheck`, `npm test` (157 tests, 11 new in `tests/markets-service.test.ts`)
and `npm run build` all pass.

## Screens

### `/issuers` (public; `/kase` now 308-redirects here)
- **Instrument overview**: name, symbol, status, transfer-lock badge, mint and issuer (copyable), terms grid
  (face, coupon, issue, maturity, outstanding, settlement, transfer rules, action count), coupon schedule
  C1–C4 with status, and a **next event** card with countdown and the next three dates.
- **Corporate actions** tab: list of actions (kind, title, stage, key date, segmented progress), and a detail
  pane for the selected action (`?action=<id>`, shareable):
  - date rail: announce → record date → payment date → claim deadline, ex-date lock window shaded, "now" marker;
  - lifecycle stepper: Announced → Record locked → Snapshot posted → Funded → Settling → Settled
    (votes: … → Voting open → Tallied), each completed stage with its date and transaction signature;
  - **next step** bar with the button the operator needs now; disabled with the opening date when the program
    would reject it early (record date not reached, payment date not reached, vote still open);
  - **confirmation dialog** per step: what the instruction does, signer, program/action/vault accounts,
    progress for multi-transaction steps ("Pay 5 outstanding"), confirmed signatures and slots, errors in place;
  - figures: per-unit amount and its formula, total entitlement (on-chain vs projected), paying vault, paid
    (n of m holders, rounding residue) with a progress bar; votes show a tally with turnout;
  - **entitlement table** (pre-execution preview from the live register; from the snapshot once posted):
    holder, units, share, redeemed units, entitlement or voting weight, status with receipt signature, per-row
    **Pay** for the paying agent; **Export CSV**;
  - link to the verifier.
- **Register** tab: holders with custody type, units, face value, share bars; supply / redeemed, slot,
  transfer lock state.
- **Event log** tab: every program event, newest first, filterable by action, with slot and signature.
- **New corporate action**: three-step guided dialog (type → terms and dates → review) for coupon, partial
  redemption, final redemption and vote, with inline validation mirroring the program, and a live preview
  (per unit, funding required, units burned, rounding residue, per-holder table).
- Simulated-ledger strip (only when the service is simulated): ledger clock, "Advance to <next date>", Reset.

### `/verify/[actionId]` (public, shareable)
Runs entirely in the browser against public data:
1. reads the action account, 2. fetches the published snapshot, 3. sha256 of the canonical snapshot,
4. rebuilds the Merkle tree, 5. recomputes every entitlement, 6. compares with on-chain totals, receipts, tally.

Shows a verdict (Verified / Consistent so far / Mismatch), checks with plain-language explanations and
on-chain vs recomputed hex, an on-chain vs recomputed table, the snapshot leaves with leaf hashes and receipt
matches, "Share link", "Snapshot JSON" download, "Run again", and a **tamper test** that adds one unit to the
largest holder in the local copy so the hash, root, units and payment checks visibly fail. Unknown ids get a
clear not-found state.

Checks: lifecycle order, snapshot hash, snapshot binding (action, mint, record date, slot), Merkle root,
units = supply at record, entitlement total (formula and rounding residue bound), vault funded in full,
every receipt equals its recomputed entitlement / burned units / no double payment / paid_amount and
paid_count reconcile, and for votes the tally equals the sum of snapshot weights.

Both pages use the site header/footer, the landing palette and card language, work at 375 px with no
horizontal scroll, respect `prefers-reduced-motion`, and carry one footnote: devnet, test settlement token,
built for the Superteam Kazakhstan × KASE side track, not affiliated with KASE.

## Code map

| File | Role |
| --- | --- |
| `lib/markets/service.ts` | Types and the `MarketsLedger` / `MarketsService` interfaces |
| `lib/markets/math.ts` | Integer entitlement math (coupon, partial / final redemption, vote weight) |
| `lib/markets/snapshot.ts` | Merkle tree, proofs, canonical snapshot JSON and sha256 (Web Crypto) |
| `lib/markets/derive.ts` | `withDerivedViews` (preview, entitlements, verification) and `verifyCorporateAction` |
| `lib/markets/lifecycle.ts` | Stage labels, next-step rules, upcoming events, action titles |
| `lib/markets/csv.ts` | Entitlement CSV |
| `lib/markets/format.ts` | Money, units, bps, UTC dates |
| `lib/markets/mock-service.ts` | Simulated ledger with the program's rules and the deterministic seed |
| `components/markets/*` | Provider + hooks, console, action detail, timeline, tables, dialog, verifier |
| `app/issuers/page.tsx`, `app/verify/[actionId]/page.tsx` | Routes |

## The service interface

```ts
interface MarketsLedger {                       // what a backend implements
  source: LedgerSource;                         // { cluster, kind: "chain" | "simulated", label }
  simulation?: SimulationControls;              // simulated ledger only
  subscribe(listener): () => void;              // fire on new slot / account change / own tx
  explorerTxUrl(sig): string | null;
  explorerAddressUrl(addr): string | null;
  now(): UnixTs;                                // cluster clock

  listInstruments(); getInstrument(mint);
  listActions(mint); getAction(actionId);
  getRegister(mint);                            // live Token-2022 holders
  getSnapshot(actionId);                        // canonical published snapshot or null
  listReceipts(actionId); listVotes(actionId); listEvents(mint);

  announce(mint, draft) -> TxResult & { actionId };
  lockRecord(actionId); postSnapshot(actionId); fund(actionId);
  pay(actionId, holder); claim(actionId, holder); vote(actionId, holder, choice); settle(actionId);
}

interface MarketsService extends MarketsLedger { // added by withDerivedViews(ledger)
  previewEntitlements(mint, draft); getEntitlements(actionId);
  verifyAction(actionId, { snapshotOverride? }) -> VerificationReport;
}
```

## What the real client must implement

1. **A `MarketsLedger`** (e.g. `lib/markets/client/ledger.ts`) and pass it through `withDerivedViews`:
   - reads: decode `Instrument`, `CorporateAction`, `ClaimReceipt`, `VoteRecord` PDAs from the IDL;
     register = Token-2022 holders of the bond mint (public devnet RPC excludes Token-2022 from
     `getProgramAccounts`, so use an indexer / Helius or known ATAs, as `lib/kase` does);
     events = parsed `emit!` logs (or a small indexer table);
   - `getSnapshot` returns the canonical file the indexer published; its sha256 must equal `snapshot_hash`;
   - writes: build and send the matching instructions, return `{ signature, slot, ts }` after confirmation,
     throw `Error` with a human message on program errors (the dialogs show `error.message`);
   - `subscribe`: account / slot subscription or polling; call listeners after own transactions.
2. **Account fields the UI reads** that the spec does not name explicitly — the program should store them
   (or the client must derive them): `CorporateAction.seq`, `announced_ts`, `claim_deadline_ts`,
   `snapshot_slot`, `supply_at_record`, `holder_count`, `paid_count`, `redeemed_units`, `tally[]`,
   status-transition timestamps/signatures (from events is fine), `ClaimReceipt.burned_units` and `mode`
   (claim vs push), `Instrument.issued_units`, `paying_agent`.
3. **Commitment format must match** `lib/markets/snapshot.ts` exactly (or update that file and keep the tests):
   - `leaf = sha256(0x00 ‖ holder pubkey 32B ‖ units u64 LE)`, zero balances excluded, leaves sorted by pubkey bytes;
   - `node = sha256(0x01 ‖ min(a,b) ‖ max(a,b))`, odd node promoted unchanged;
   - `snapshot_hash = sha256(JSON {version, instrument, mint, action, recordTs, slot, holdings:[{holder, units:"<decimal>"}]})`
     with holdings in the same order.
4. **Entitlement math must match** `lib/markets/math.ts` (integer, round down per holder):
   coupon `units × face × bps / 10_000 / frequency`; partial redemption `redeem = units × redeemBps / 10_000`,
   `amount = redeem × face × priceBps / 10_000`; final redemption `units × face × priceBps / 10_000` (+ coupon);
   vote weight `units`. `total_entitlement` is the formula applied to `total_units`; the difference to Σ holder
   amounts is rounding residue, returned to the issuer at settlement. The verifier relies on these semantics.
5. **Signing**: the console currently assumes the ledger signs (issuer / indexer / paying agent). With the real
   program, either keep these as server routes holding devnet keys (like `app/api/kase`) or add a wallet
   connection to the console; the dialogs already show the signer and accounts.
6. **Swap point**: `createService()` in `components/markets/markets-provider.tsx`. Explorer links appear
   automatically once `explorerTxUrl` / `explorerAddressUrl` return URLs (the simulated ledger returns null,
   so it never links to transactions that do not exist).

## Seed data (simulated ledger)

Plain Test Bond 10% 2027 (PTB27): 1,000 units × $1,000 face, 10% semi-annual, issued 15 Oct 2025, matures
15 Oct 2027; five holders (400 / 250 / 180 / 120 / 50). Clock starts 13 Oct 2026 09:00 UTC.
#1 Coupon 1 of 4 — settled ($50,000; four push payments, one claim). #2 Bondholder vote — voting open
(580 For / 250 Against). #3 Coupon 2 of 4 — snapshot posted, awaiting funding, pays 15 Oct 2026.
#4 Partial redemption 25% at par — announced, record 29 Oct 2026 (249 units burned, $1,000 residue when run).
State persists in `localStorage` so the console and a verifier tab agree; "Reset" restores the seed.

## Known limits / follow-ups

- Holders vote and claim from the investor view (Plain app "Bonds"), not from the issuer console.
- Final-redemption flow marks the instrument Redeemed when supply reaches zero; returning unclaimed funds after
  the claim deadline is represented as the settlement residue only.
- `/kase` page files and `lib/kase` are untouched; the redirect in `next.config.ts` takes precedence.
