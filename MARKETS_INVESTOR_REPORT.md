# Plain Markets: the investor side

> **Superseded in part (15 Oct 2026):** the free "Get allocation" flow and `POST /api/bonds/[mint]/allocate` were replaced by a real delivery-versus-payment purchase (Bonds → Buy). Issuer allocation remains only as a labelled issuer action in the console. See [MARKETS_DVP_REPORT.md](MARKETS_DVP_REPORT.md).

This branch builds on `claude/markets-wire-1ddeac`. It adds the retail half of the story inside the signed-in Plain app: an issuer issues a bond, the register records it, and a retail investor who signed in with email holds it in a Crossmint smart wallet and is paid its coupons. The whole path runs on the real `plain_markets` program on devnet.

No Crossmint code changed. The investor never signs anything. The issuer key issues the units, and the paying agent pushes each coupon to the wallet.

## Flows

| Flow | How it works |
|---|---|
| **Primary allocation** | Bonds tab → **Get allocation** → choose N units. `POST /api/bonds/[mint]/allocate` takes the wallet from the session, never from the request body. It applies the rate limits and the `Idempotency-Key`, then waits in the issuer's single-flight queue, which is shared with the console routes. Inside the queue, `DevnetIssuer.allocate` re-reads the instrument and the wallet's bond balance and checks the window and the cap. It then sends one transaction with three parts: a memo `pm:alloc:1 <wallet> <units>`, an `allow_holder` instruction only when the allowlist is on and the wallet has no entry, and `issue`. `issue` creates the wallet's off-curve associated token account. The cash leg is simulated: no payment is taken, and the UI says so. |
| **Window and cap** | `allocationWindow` mirrors the program's `issue` checks: the instrument is Active, not matured, has no open redemption, is not in an ex-date lock, and has no pending action. When the window is closed, the button is disabled and shows the reason. The cap is 20 units per investor and 10 per request, both set by env vars. |
| **Plain investors in the register** | The allocation memo lands in the instrument's signature feed, which the ledger already reads. `DevnetLedger.plainInvestors(mint)` lists these wallets with no extra RPC call. They become register candidates, so record-date snapshots include them without a full history replay. They are labelled with `plainInvestor: true`, custody "Plain smart wallet" and the **Plain investor** badge in the console register and the entitlement tables. |
| **Coupons arrive automatically** | The paying agent's `pay` push already targets `getAssociatedTokenAddressSync(settlementMint, holder, true)`. On-chain, `init_if_needed` creates that account for PDA owners. A test now asserts that `issue` and `pay` target the off-curve ATAs of a PDA. The devnet run below confirmed it with a real transaction. |
| **Portfolio** | A Bonds block shows units, face value, accrued coupon (an estimate), the next coupon date and amount, the coupon calendar and the test USD balance, labelled as a devnet token. |
| **Activity** | Received coupons and redemptions come from the chain's `ClaimReceipt`s. They are merged into the day-grouped list with links to the transaction and to `/verify/[actionId]`. |
| **Bond detail** `/bonds/[mint]` | Shows the terms (face, coupon, frequency, maturity, next coupon, yield to maturity), your position and your upcoming dates. Every corporate action has a status timeline (Announced → Register locked → Snapshot posted → Funded → Paying → Settled), each step linking to its transaction. It also shows your entitlement or the payment you received, and a link to "Verify on-chain". |
| **Votes** | Shows votes that affect you: you were in the snapshot, or you hold units while a vote is upcoming or open. Each shows the question, the on-chain tally, your weight and whether you voted. A note says that voting from Plain needs a wallet signature, which is coming next. Nothing signs. |

### Math (`lib/markets/investor.ts`, pure and isomorphic)

- **Coupon schedule.** Coupons fall every 12/frequency calendar months from the issue date, in UTC, with day clamping. The last coupon is at maturity. The period count matches `couponPeriods`.
- **Coupon per unit.** Uses `entitlements.couponPerUnit`, so the amount matches what the program pays, cent for cent.
- **Accrued coupon.** Accrues linearly over the first period the issuer has *not* announced yet. The demo bond paid coupons 1–4 on accelerated "live demo" timing, so showing accrual for a period that was already paid would be wrong. With nothing announced, this is simply the current calendar period. The estimate is rounded down and shown to the cent.
- **Next coupon.** An announced, unpaid coupon if there is one. Otherwise the next scheduled date nobody has announced yet.
- **Yield to maturity.** The nominal annual yield, compounded `frequency` times a year, that discounts the remaining program coupons and the face value back to the price. It is solved by bisection. At par it is 12.04% for the 12% bond, because the coupons are quarterly and today falls mid-period.

## Files

| Area | Files |
|---|---|
| Investor math and views | `lib/markets/investor.ts` |
| Chain reads (testable over a mock RPC) | `lib/markets/investor-reads.ts` |
| Server wiring and env | `lib/markets/investor-server.ts` |
| Allocation guard chain (dependencies injected) | `lib/markets/allocation-route.ts` |
| Shared issuer queue | `lib/markets/issuer-queue.ts` (the `/api/markets/[op]` route now uses it too) |
| Issuer | `lib/markets/devnet-issuer.ts`: `allocate`; snapshots include Plain investors |
| Ledger | `lib/markets/devnet-service.ts`: `plainInvestors`, `issueStateOf`, register labels |
| Types | `lib/markets/service.ts`: `RegisterEntry.plainInvestor`, `EntitlementRow.plainInvestor` |
| API | `app/api/bonds/route.ts`, `app/api/bonds/[mint]/route.ts`, `app/api/bonds/[mint]/allocate/route.ts` |
| App UI | `app/(app)/bonds/page.tsx`, `app/(app)/bonds/[mint]/page.tsx`, `components/app/bonds/*`, `lib/useBonds.ts`; `shell.tsx` (Bonds tab, detail back button), `portfolio-screen.tsx`, `activity-screen.tsx` |
| Console | `components/markets/primitives.tsx` (`PlainInvestorBadge`), `register-and-log.tsx`, `entitlement-table.tsx`, `lib/markets/derive.ts` |
| Tests | `tests/markets-investor.test.ts` (17 tests); the shared mock-RPC fixture moved to `tests/helpers/markets-fixture.ts`; `navigation-restoration.test.ts` now expects 5 tabs |
| Devnet driver | `scripts/markets-investor-e2e.ts` (`npm run markets:investor-e2e -- <baseUrl> [units]`) |

## Environment

The earlier `MARKETS_*` variables are unchanged (see `MARKETS_WIRE_REPORT.md`). New, server-only:

| Variable | Default | Purpose |
|---|---|---|
| `MARKETS_ALLOCATION_CAP_UNITS` | 20 | Most units one investor may hold through allocation |
| `MARKETS_ALLOCATION_MAX_PER_REQUEST` | 10 | Most units per request; never more than the cap |

The Bonds tab needs `MARKETS_MODE=devnet`, plus `MARKETS_ISSUER_SECRET` for allocations. Without them the tab shows "Bond offerings are not available right now.", and Portfolio and Activity hide the bond blocks.

Built-in limits:

| Endpoint | Limits |
|---|---|
| `POST /api/bonds/[mint]/allocate` | 6 per wallet per hour, 10 per IP per minute, 120 per minute in total. Idempotency keys are scoped per wallet. |
| GET routes | 30 per wallet per minute. Feeds refresh at most every 15 s. |

## Checks

- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm test`: 193 of 193 passed.
- `npm run build` passed.

New tests:

- Calendar months, the schedule, the current period and accrual (including coupons paid ahead of the calendar and the per-period ceiling).
- Yield to maturity at par, at a discount and at a premium.
- The allocation window, which covers every `issue` precondition.
- The allocation check: units, the window and the cap with its messages.
- The allocation memo round trip.
- The handler chain: session, availability, mint, key, body size, idempotency (409 when a key is reused with a different request), per-wallet and per-IP rate limits, serialized execution, error mapping and retry after a failure.
- `issue` and `pay` accounts for a PDA owner.
- A full view over the mock RPC: the smart-wallet holder is flagged in the register and sees its position, coupon, calendar, test USD balance and links.
- Votes and the calendar.

## Devnet run (2026-10-14, PDB28, `npm run dev` with `MARKETS_MODE=devnet`)

The investor was a local smoke session (HMAC-signed with `AUTH_SESSION_SECRET`) for `5ThN39MNdKU7cgmqnH1f3wETAGQD9uiuvK76PxhxCNeY`. That address is a PDA: it is off the ed25519 curve and has no key, like a Crossmint smart wallet. `scripts/markets-investor-e2e.ts` produced:

1. **Allocation was refused** while Coupon 3 awaited funding: 409, "The issuer is recording the register…". Without a session the route returns 401.
2. **Coupon 3 was finished** to unblock issuance: funded, paid to 5 holders, settled.
3. **5 units were allocated** to the smart wallet: [`5zkiZ1PR…`](https://explorer.solana.com/tx/5zkiZ1PRkzQY4rxEno1cXW2uysbuk3XNjjs9kbtXiogwwWhaDeiYYDe9hugQyWYSamZqiPPBDHJjNHWmEPF5tzgp?cluster=devnet). The register then flagged the wallet as a Plain investor.
4. **Coupon 4 ran on live timing:** [announce](https://explorer.solana.com/tx/3jyyhBVBDPvtS5BxoiDaMyrN8FQMe1KAck4zWBD97Sz6RXqDCmwnEr5YWe5AqduZ8nuXersh89sbdyqaV1hX1jdS?cluster=devnet) → [lock](https://explorer.solana.com/tx/61Q6wk3D3N7dX643G2hSfZpRQNE9sAzkiwecBH2kmzN2XD6B4w91rZutYfAKRzB2zqDKDJdfLJUUrNrD3egvywjx?cluster=devnet) → [snapshot](https://explorer.solana.com/tx/2nRugyJgvjtmYmTkLai2z12E7MYyMHZMC228AWx9Vydwovu4eddSAVebuicvGWdyVcK6tJcF2UPCbwqEuvimMeqm?cluster=devnet) → [fund](https://explorer.solana.com/tx/3htWux82HX8XbwSTJXxcp5expAgdmYCFCd5rkGXNDaRjz1rsP6yL4V1ViHhPzMyyBxRzGs8dyRonERXmNmL1hL48?cluster=devnet) → [**push to the smart wallet: $150**](https://explorer.solana.com/tx/53UbA1sUXwDfw74iFxgh2fM4XuQBaxLjnjBHriaAnzbAHxcaNxrKM3XJAkWbG25pnAwAVhkQPN6haCAJwzxQAX2a?cluster=devnet) → [settle](https://explorer.solana.com/tx/YDzsCb1YkC41RVtKqd5nV8xPB3tJHEwURHnwFyCbDBKB2XjCmbm7tV3wKo9KxvEcMJ8Csk7j3KEgCb3GbCQJTLK?cluster=devnet). The snapshot had 6 holders, the wallet among them; it was found through the memo, with no replay. Verifier: `/verify/EL64WamGoedusMfqhX9M89336aUz7dCfoqARQd96dxYX`.
5. **`/api/bonds` showed the result:** a 5-unit position, the Coupon 4 payment (push, with explorer and verify links) and a test USD balance of $150.
6. **More allocations and the cap:**
   - 1 unit through the UI drawer.
   - 10 units through the API.
   - A further 5 units were refused with "You can add up to 4 more units (limit 20 per investor)".
   - Replaying the same idempotency key returned the original signature.

   The wallet now holds 16 units.

Allocations and coupons cost the issuer about 0.01 SOL. The bond now has 4 of 8 coupons announced, so 4 remain for demos.

### UI

The signed-in shell only renders after a real email login with Crossmint, and smoke sessions are rejected by `/api/auth/session` by design. To check the UI, I mounted the same screen components on a temporary local page without the shell. That page was never committed. Through it I checked:

- the Bonds overview, the detail page and the portfolio block, on desktop and at 375 px (no horizontal scroll);
- the allocation drawer end to end, which issued 1 unit and refreshed the position;
- the issuer console register, which shows the badge.

## Manual test steps (needs a real sign-in)

1. Put `MARKETS_MODE=devnet`, `MARKETS_ISSUER_SECRET` and `MARKETS_INSTRUMENT_MINT=7ye1Ny5cLax3FRP4YFAQsBTzf2MMMeAPBHwp7NHaGb7g` in `.env.local` next to the usual auth and Crossmint variables. Then run `npm run dev`.
2. Sign in with email and open **Bonds** (sidebar on desktop, tab bar on mobile). Check that PDB28 shows a 12% coupon, about 12% yield to maturity, $1,000 face value, Quarterly and the next coupon date.
3. **Get allocation**, then 2 units. The success screen links to the issue transaction. The position appears at the top. Portfolio shows the Bonds block.
4. Open `/issuers` → Register. Your smart wallet has the **Plain investor** badge.
5. In `/issuers`, announce a coupon with "Live demo timing". Then run lock → snapshot → fund → **Pay all** once the payment time arrives.
6. Back in the app, about 15 to 30 s later:
   - **Activity** shows "Coupon received · PDB28" with Transaction and Verify links.
   - The bond detail shows the timeline as Settled and "You received $60.00 for 2 units".
   - Portfolio shows the test USD balance.
7. Try to allocate during the ex-date lock (between the record and payment dates). The button is disabled with the reason. Try more than the cap; the error explains how many units are left.

## Limits and follow-ups

- **Voting from Plain** needs the smart wallet to sign `cast_vote`, which is a new Crossmint transaction type. It is intentionally not built; the UI says it is next.
- **The cash leg is simulated.** A real allocation would take payment (an on-ramp or a USDC transfer) before `issue`, using delivery versus payment.
- **In-memory guards.** The rate limits and idempotency keys live in memory, per server instance, like the console routes. Several instances would need a shared store, and the issuer key also assumes one instance.
- **The demo bond's calendar.** Coupons 1–4 were paid on accelerated timing, so the next scheduled coupon is period 5 (13 Oct 2027). Accrual correctly shows $0.00 until that period opens.
- **Public RPC.** The issuer console in the browser shares the public devnet RPC's budget of 10 requests per 10 s. It loads slowly while scripts are running against it. `MARKETS_PUBLIC_RPC_URL` with a keyed RPC fixes this.
