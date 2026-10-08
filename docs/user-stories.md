# User stories

Each story lists who it is for, what they do in the app, and what happens on-chain. All of them run today on https://plain.lengway.me (Solana devnet, test money).

## Personas

| Persona | Situation | What they want |
|---|---|---|
| **Aigerim, 29, product manager in Almaty** | Salary in tenge, savings in a bank deposit and cash dollars. Never used crypto. | Dollar yield she can understand, without exchanges or seed phrases. |
| **Daniyar, 41, small business owner** | Keeps reserves in dollars, worried about devaluation. | A transparent place for idle dollars with visible yield and easy withdrawal. |
| **A bank or fintech product team** | Has millions of verified clients and a super-app. | Offer tokenized yield inside their app without building crypto infrastructure. |
| **A hackathon judge** | Has five minutes. | See that the money really moves on-chain and that the UX hides the complexity. |

## Core stories

### 1. First visit without signing in
*As a curious user, I want to try the product before giving any data.*
1. Opens the landing page, taps **Начать**.
2. Sees the home screen in demo mode, adds demo money, opens a deposit, watches earnings grow (accelerated clock available in settings).
3. A banner explains that demo data lives in the browser and offers **Войти по email**.

On-chain: nothing. Everything is labelled as demo.

### 2. Sign in and get a wallet
*As Aigerim, I want an account in one step, without installing a wallet.*
1. Taps **Войти по email**, enters the one-time code.
2. A Crossmint smart wallet on Solana is created for her in the background.
3. The Portfolio tab shows her wallet address with **Открыть в обозревателе**.

On-chain: a Crossmint smart wallet. Optional welcome email.

### 3. Add money
*As Aigerim, I want to add $50 the way I pay for things every day.*
- **Test ATM:** instant test dollars, no card, no KYC.
- **Card via Transak:** the provider opens in a full-height sheet above the app, identity fields are prefilled in test mode, she pays with a test card, the server verifies the order and credits her.
- **Card via MoonPay:** same sheet, with **В новой вкладке** when the browser blocks third-party cookies.
- **Inside a bank:** in the demo bank she taps **Со счёта в Демо-банке**, the bank shows its own confirmation in tenge at the National Bank rate, she taps **Оплатить**.

On-chain: test dollars minted to her wallet; receipt email with the explorer link.

### 4. Earn yield
*As Daniyar, I want my idle dollars to earn something I can verify.*
1. Opens **Доход → Долларовый вклад**, sees the live APY (USDY via DefiLlama, with date) and the 3-month T-bill rate for comparison.
2. Deposits $100. The app asks his wallet to sign a transfer to the treasury.
3. He receives vUSDY-DEMO shares; the Portfolio shows token amount, price per share, value and P&L, growing in real time.

On-chain: user-signed transfer to the treasury, verified by the server; shares minted to his wallet.

### 5. Withdraw
*As Daniyar, I want to get my money back whenever I want.*
1. Taps **Вывести → Из вклада на баланс**, chooses how much.
2. His wallet sends shares back; the server pays out at the current share price and burns the shares.
3. Optionally **Вывести → На банковскую карту** (MoonPay sell) or **Отправить на другой кошелёк**.

On-chain: share transfer, payout in test dollars, burn; or a plain transfer to another address.

### 6. Buy a fractional real-estate share
*As Aigerim, I want to own a small piece of a real asset from $10.*
1. Opens **Активы → Офисное здание (демо-объект)**, buys $10.
2. Pays from her balance; the server verifies the payment and mints 10 OFFICE-DEMO tokens.

On-chain: payment transfer and asset mint, both visible in **Операции в сети**.

### 7. See everything in one place
*As any user, I want to know exactly where my money is.*
The **Portfolio** tab reads the wallet from Solana: cash, vault shares, asset tokens and SOL for fees, each with mint address, token account and explorer links, an allocation bar, and the latest on-chain transactions.

### 8. A bank embeds the product
*As a bank product team, I want to add investments to our super-app in weeks, not quarters.*
1. The demo bank (`/demo-bank`) shows a typical super-app home with **Инвестиции** in the services grid.
2. Tapping it opens RWA Bridge in a full-height sheet.
3. Payments are confirmed in the bank's own UI; the bank keeps KYC and tenge rails, RWA Bridge provides the yield layer.

## Edge cases covered

- Provider widget closed after payment: the app keeps checking the order and credits it later.
- Payment succeeded but the asset mint failed: automatic retry with the same payment signature, no double mint.
- The same transaction reused for a second credit: rejected.
- Withdrawal larger than the deposit: rejected.
- Data source down: last good value with a "stale" mark; the UI does not break.
- Different IPv4/IPv6 between browser and server: the IP for signed widget URLs is taken from the browser.
