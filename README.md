# RWA Bridge

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

---

# Приложение (RU)

RWA Bridge работает в сети Solana devnet. Вход через Crossmint по email обязателен; после входа Solana-кошелёк создаётся автоматически. Главная страница `/` и банковская витрина `/bank` доступны публично, а приложение внутри банковской витрины требует такую же авторизованную сессию.

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

## Запуск и настройка

```bash
cp .env.example .env.local
npm install
node scripts/setup-devnet.mjs
npm run dev
```

Для работы задайте staging-ключи Crossmint и ключи нужных платёжных провайдеров. Серверные переменные для devnet mint сохраняют текущие имена:

- `DEMO_TOKEN_MINT`
- `DEMO_USD_MINT`
- `DEMO_VAULT_USDY_MINT`
- `DEMO_VAULT_KZGB_MINT`
- `DEMO_TOKEN_AUTHORITY_SECRET`

`node scripts/setup-devnet.mjs` создаёт mint `OFFICE`, тестовый доллар, два mint долей и адрес казначейства. Если автоматическая выдача SOL не сработает, пополните адрес полномочий через Solana devnet faucet и повторите запуск. При необходимости можно указать `SOLANA_RPC_URL`.

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

