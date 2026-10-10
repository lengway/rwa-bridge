# Plain

**A seamless yield layer between everyday money and tokenized real-world assets, on Solana.**

Sign in with email (the only way in), get an embedded Solana wallet, add money, and earn yield from tokenized US Treasuries or own fractional real estate. No seed phrases, no gas, no jargon. Every balance in the app is a token in the user's own wallet.

- **Live app (Solana devnet, test money):** https://plain.lengway.me
- **Bank embedding example:** https://plain.lengway.me/bank
- **Architecture and money flows:** [docs/architecture.md](docs/architecture.md)
- **User stories:** [docs/user-stories.md](docs/user-stories.md)
- **Video script:** [docs/demo-script.md](docs/demo-script.md)

## What works today

| Flow | What happens on Solana devnet |
|---|---|
| Email login | Crossmint smart wallet created for the user |
| Add money: test ATM | Server mints test dollars (USDC stand-in) to the wallet |
| Add money: card (Transak, MoonPay test modes) | Provider order verified server-side, then test dollars minted |
| Add money: inside a bank | Bank-style confirmation in tenge, then test dollars minted |
| Add money: tenge · Intebix | Fixed-supply KZTE transfers from the issuer reserve; the mint authority is revoked |
| Deposit into a yield vault | User-signed transfer to the treasury, verified, then vault share tokens (vUSDY / vKZGB) minted; share price follows the live APY |
| Withdraw | Shares sent back and burned, dollars paid at the current share price |
| Buy a fractional asset | Payment verified, OFFICE tokens minted 1:1 |
| Send to any wallet / card off-ramp | Plain SPL transfer / MoonPay sell widget (deposit simulated on devnet) |
| Portfolio | Read from the wallet's token accounts with explorer links and on-chain history |
| Receipts | Email per operation via Gmail SMTP, only to the verified login email |

Live data: USD/KZT from the National Bank of Kazakhstan, USDY APY from DefiLlama, 3-month T-bill from the US Treasury, quotes from Transak and MoonPay. Each number shows its source and date.

## On-chain addresses (devnet)

| Token | Mint |
|---|---|
| Test dollar | `Hx7e212hfKYHNV5jdfV4R9NQ5JHCdt9w1g4aGYk7cSaV` |
| vUSDY | `NybngzX175W1p8xoL1yikAV2WnpQzHihMKgGnmifPD4` |
| vKZGB | `Fn1idY7FZB4C3JaV5yZorqPUTg8sZN3ZHgqCp7mMJiAi` |
| OFFICE | `51UTD1qdeMmfudZdcWXgBVUoZNu4etKRDzRbkfBi9NR9` |
| Treasury owner | `8Mdmu9GN72J1scQC15SAa9pvDGpNMNJhxrPbCi3nQ6iD` |

## Status

The product runs on Solana devnet with test dollars. Vault shares and asset tokens are issued by the app on devnet; vault prices follow the live USDY yield. Going to mainnet means holding real issuer tokens (e.g. USDY) and licensed fiat partners; those steps are described as user stories, not built yet. Card providers run in their test environments. No bank, exchange or issuer named in the docs is a partner.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui on Base UI, Crossmint embedded wallets, @solana/web3.js, @solana/spl-token, Transak and MoonPay APIs, nodemailer. Deployed on a VPS behind nginx and Cloudflare (`scripts/deploy.sh`).

## Run locally

```bash
cp .env.example .env.local   # fill in Crossmint, Transak, MoonPay keys
npm install
node scripts/setup-devnet.mjs   # creates the devnet mints, needs devnet SOL on the authority
npm run dev
node scripts/devnet-smoke.mjs   # end-to-end check of every money flow
```

## Deploy

The canonical repository is private at `https://github.com/lengway/rwa-bridge`.
The VPS has a read-only GitHub deploy key and a checkout at
`/home/plain/worktrees/rwa-bridge`. After committing a change, deploy with:

```bash
scripts/deploy.sh stapp
```

The script pushes committed `HEAD` to `origin/main`, runs `git pull --ff-only`
on the VPS, installs from the lockfile, builds, and atomically repoints the
running app only after the build succeeds. Shared runtime configuration remains
outside Git in `/home/plain/shared/.env.local`.

## RWA-DEMO: direct Meteora DLMM Devnet flow

`RWA-DEMO` is a separate, Devnet-only test scenario. It is not an asset, a security,
or a claim on property, KASE, Intebix, KZTE, or any other real-world asset. `QUOTE-DEMO`
is a test SPL token with no monetary value. The KZT boundary is a UI/ledger simulation
only: no payment is accepted and no payout is sent.

The only real parts of this specific demo are the Devnet token mint/transfer (when the
guarded faucet is enabled) and the user-signed, direct Meteora DLMM swaps. Jupiter is
not used as an execution route in this flow.

### Configure and bootstrap

1. Copy the example configuration and set an explicit Devnet RPC:

   ```bash
   cp .env.example .env.local
   # Set SOLANA_CLUSTER=devnet and SOLANA_RPC_URL to a Devnet-only endpoint.
   ```

2. Create a **test-only** payer outside the tracked source tree, then fund its public
   address with Devnet SOL. Never place this file in `public/`, commit it, or paste its
   contents into an environment variable or chat.

   ```bash
   mkdir -p .secrets
   solana-keygen new --outfile .secrets/devnet-payer.json
   chmod 600 .secrets/devnet-payer.json
   # Fund the printed public address through https://faucet.solana.com/
   ```

3. Set `DEVNET_PAYER_KEYPAIR_PATH=.secrets/devnet-payer.json`. With
   `ENABLE_DEVNET_DEMO=false`, opt in to creating missing public Devnet configuration
   and run the bootstrap (it only accepts Devnet and never writes a secret):

   ```bash
   WRITE_DEVNET_DEMO_CONFIG=true npm run devnet:bootstrap
   ```

For the VPS release layout, `.env.local` is intentionally a symlink to the
shared secret configuration. Keep that guard in place and set
`DEVNET_PUBLIC_CONFIG_PATH=/home/plain/shared/.env.local` for the bootstrap
command; the target itself must be a regular, owner-restricted file. The script
writes only the resulting public mint, pool, and LP position IDs there.

4. Review the printed Devnet Explorer links and public `DEVNET_QUOTE_MINT`,
   `DEVNET_RWA_MINT`, and `DEVNET_METEORA_POOL` values. Set
   `ENABLE_DEVNET_DEMO=true`; set `ENABLE_DEVNET_FAUCET=true` only on a guarded local
   or staging deployment where issuing test tokens is intended. Restart `npm run dev`.

The bootstrap discovers a currently valid Devnet `PresetParameter2`, creates/reuses the
pair and its LP position idempotently, and confirms the public pool/mint accounts before
it reports success. It does not fall back to Mainnet or create a replacement pool if the
configured one is invalid.

### Demo walkthrough

1. Sign in and open **Assets → RWA-DEMO**. Confirm the screen says `DEVNET DEMO` and
   the network is Devnet.
2. Create a simulated KZT top-up. The displayed conversion is an illustrative configured
   rate and the UI must say `SIMULATED — no fiat payment`.
3. If the guarded faucet is enabled, receive `QUOTE-DEMO` through a real Devnet mint
   transaction. The UI identifies it as `DEVNET TEST TOKEN — no monetary value`.
4. Request a fresh direct Meteora quote, review its slippage and minimum output, then
   approve the swap in the connected wallet. The app confirms the signature on-chain and
   refreshes balances before marking the order complete.
5. Sell part or all of `RWA-DEMO` via a fresh reverse quote. Once the sell is confirmed,
   the app can create an explicitly simulated KZT payout receipt only; it never sends a
   bank transfer.

### RWA demo configuration

| Variable | Purpose |
|---|---|
| `SOLANA_CLUSTER` | Must be exactly `devnet`; a missing/other value is rejected. |
| `SOLANA_RPC_URL` | Explicit Devnet RPC endpoint, verified against Devnet at runtime. |
| `ENABLE_DEVNET_DEMO` | Explicitly enables the RWA demo routes/UI. |
| `ENABLE_DEVNET_FAUCET` | Enables the server-side `QUOTE-DEMO` test-token issuer; keep `false` by default. |
| `AUTH_SESSION_SECRET` | Existing server-only session secret, also used to hash faucet IP audit data; never expose it to the client. |
| `DEVNET_PAYER_KEYPAIR_PATH` | Server-only test payer/mint-authority file path. |
| `WRITE_DEVNET_DEMO_CONFIG` | Must be `true` only when bootstrap is allowed to create missing mints and write their public addresses to `.env.local`. |
| `DEVNET_PUBLIC_CONFIG_PATH` | Optional regular-file target for bootstrap's public IDs when release `.env.local` is a symlink. |
| `DEVNET_QUOTE_MINT`, `DEVNET_RWA_MINT`, `DEVNET_METEORA_POOL` | Public addresses emitted by the bootstrap. |
| `DEVNET_RWA_LP_POSITION` | Public LP position emitted by the bootstrap; used for safe reuse checks. |
| `DEMO_KZT_PER_QUOTE_TOKEN` | Illustrative demo scenario rate, not market FX. |
| `DEMO_FUNDING_MAX_KZT`, `DEMO_FAUCET_MAX_QUOTE_TOKENS`, `DEMO_FAUCET_DAILY_MAX_QUOTE_TOKENS` | Server-side funding/faucet caps. |
| `DEMO_SWAP_SLIPPAGE_BPS` | Maximum allowed direct-DLMM quote slippage. |

### Troubleshooting and limits

- **“Devnet demo is not configured”** — verify every required public mint/pool value,
  `SOLANA_CLUSTER=devnet`, and an RPC that returns the Devnet genesis hash; restart the
  server after changing `.env.local`.
- **Insufficient SOL / pool bootstrap fails** — fund the configured test payer with
  Devnet SOL, then rerun the bootstrap. Do not substitute a Mainnet key or endpoint.
- **No quote / stale quote / rejected signature** — request a new quote. A quote is not
  a price guarantee and an order is never completed from a client success flag alone.
- **Faucet unavailable** — this is intentional unless the explicit server-side flag,
  test-only payer, caps, and public mint configuration are present. Enable it only in
  guarded local or staging infrastructure; never expose an authority key in the browser.
- **Crossmint signing unavailable** — use a staging Crossmint wallet configured for
  Solana Devnet. The integration is designed to pass a serialized transaction to the
  wallet; it never exports or stores a user private key.

Before a production or horizontally scaled deployment, replace the local JSON demo
ledger/rate limiter with a durable transactional datastore and shared rate limiter.
The IP limiter assumes your trusted reverse proxy strips and overwrites forwarded-IP
headers; do not expose the faucet directly to the public internet behind an untrusted
proxy. Wallet and aggregate caps remain enforced server-side.
Real KASE/Intebix/KZTE assets, real KZT rails, KYC/AML, custody, Mainnet, and a live
Jupiter execution route remain out of scope and disabled.

---

# Приложение (RU)

Plain работает в сети Solana devnet. Вход через Crossmint по email обязателен; после входа Solana-кошелёк создаётся автоматически. Главная страница `/` и банковская витрина `/bank` доступны публично, а приложение внутри банковской витрины требует такую же авторизованную сессию.

Баланс, позиции, доли активов и история операций загружаются из on-chain портфеля пользователя. Локально сохраняется только выбранная валюта отображения. Локальных балансов и финансовой истории в приложении нет.

## Доступные операции

- **Кран Solana devnet** — выпускает тестовые доллары SPL в кошелёк пользователя.
- **Карта · Transak** — staging-заказ проверяется сервером; подтверждённая сумма зачисляется тестовыми долларами в devnet.
- **Карта · Crossmint** — заказ создаётся через серверный Crossmint onramp.
- **Со счёта в банке** — доступно внутри `/bank`; после подтверждения оплаты в банковской витрине тестовые доллары выпускаются в кошелёк.
- **Вклад** — доллары переводятся в казначейство, а доли `vUSDY` или `vKZGB` выпускаются как SPL-токены. Цена доли обновляется в реальном времени.
- **Погашение вклада** — доли отправляются в казначейство и сжигаются, доллары возвращаются в кошелёк.
- **Доля недвижимости** — оплата проверяется в сети, после чего токены `OFFICE` выпускаются в кошелёк; 1 `OFFICE` соответствует $1 доли объекта.
- **MoonPay** доступен только во вкладке вывода на карту. Перевод в MoonPay в сети devnet перемещает тестовые доллары в казначейство.

Токены `vUSDY` отслеживают доходность USDY, публикуемую Ondo через DefiLlama. `vKZGB` ссылается на индекс государственных облигаций KASE. Данные курса USD/KZT, APY и котировок показывают источник и дату.

## KZTE · тенге

Intebix и Евразийский банк выпустили Evo (KZTE), тенговый стейблкоин 1:1 в пилоте песочницы Нацбанка РК. Официальный адрес KZTE в основной сети пока не опубликован; для этого приложения setup-devnet.mjs создаёт отдельный SPL-токен KZTE в Solana devnet. В приложении доступны перевод KZTE из резерва Intebix, обмен KZTE ↔ USD и выплата в тенге. Выпущен фиксированный объём 1 000 000 000 KZTE с 6 знаками после запятой; authority выпуска отозвана. Входящие KZTE остаются в резерве.

## Запуск и настройка

```bash
cp .env.example .env.local
npm install
node scripts/setup-devnet.mjs
npm run dev
```

Для работы задайте staging-ключи Crossmint и ключи нужных платёжных провайдеров. Серверные переменные для devnet mint сохраняют текущие имена:

Mint KZTE хранится в переменной DEMO_KZTE_MINT. setup-devnet.mjs выпускает 1 000 000 000 KZTE в token account казначейства и отзывает mint authority. При повторном запуске существующий выпуск не дублируется; прежний mint с нулевым supply и authority казначейства будет однократно заполнен и отозван.

`scripts/devnet-smoke.mjs` читает `AUTH_SESSION_SECRET` из окружения или `.env.local`, создаёт одноразовый кошелёк и подписывает часовой session cookie с `smoke: true` и его `walletAddress`. Сервер использует этот адрес только из cookie с действительной HMAC-подписью; обычные сессии продолжают брать адрес из серверной связи email → wallet. Ни один HTTP endpoint не выпускает smoke-cookie, а `/api/auth/session` не обменивает его на JWT.

- `DEMO_TOKEN_MINT`
- `DEMO_USD_MINT`
- `DEMO_VAULT_USDY_MINT`
- `DEMO_VAULT_KZGB_MINT`
- `DEMO_KZTE_MINT`
- `DEMO_TOKEN_AUTHORITY_SECRET`

`node scripts/setup-devnet.mjs` создаёт mint `OFFICE`, тестовый доллар, два mint долей, KZTE и token accounts казначейства. Если автоматическая выдача SOL не сработает, пополните адрес полномочий через Solana devnet faucet и повторите запуск. При необходимости можно указать `SOLANA_RPC_URL`.

Для карточного пополнения Transak задайте `NEXT_PUBLIC_TRANSAK_API_KEY` и `TRANSAK_API_SECRET`. Для Crossmint — `CROSSMINT_SERVER_API_KEY`. MoonPay использует `NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY` и `MOONPAY_SECRET_KEY`; он остаётся доступен для вывода на карту. Настройки писем необязательны: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` и `MAIL_FROM`.

## On-chain адреса (devnet)

| Токен | Mint |
|---|---|
| Тестовый доллар | `Hx7e212hfKYHNV5jdfV4R9NQ5JHCdt9w1g4aGYk7cSaV` |
| vUSDY | `NybngzX175W1p8xoL1yikAV2WnpQzHihMKgGnmifPD4` |
| vKZGB | `Fn1idY7FZB4C3JaV5yZorqPUTg8sZN3ZHgqCp7mMJiAi` |
| OFFICE | `51UTD1qdeMmfudZdcWXgBVUoZNu4etKRDzRbkfBi9NR9` |
| Казначейство | `8Mdmu9GN72J1scQC15SAa9pvDGpNMNJhxrPbCi3nQ6iD` |

## Источники данных

- **USD/KZT** — Национальный банк Казахстана.
- **Доходность USDY** — DefiLlama, данные пула USDY в Solana.
- **3-месячные казначейские векселя США** — Daily Treasury Rates.
- **Индекс KZGB** — индекс государственных облигаций KASE.
- **Котировки Transak и MoonPay** — API провайдеров.
