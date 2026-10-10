# Plain

**A Devnet-only Universal Earn demonstration with one explicitly simulated strategy.**

Plain currently demonstrates the shape of an Earn journey on Solana Devnet. It
is not an investment, bank account, on/off-ramp, issuer, or production RWA
service. The test tokens, demo shares, balances, and simulated payout records
described here have **NO MONETARY VALUE**.

- **Live app (Solana devnet, test money):** https://plain.lengway.me
- **Bank embedding example:** https://plain.lengway.me/bank
- **Universal Earn Gateway contract:** [docs/UNIVERSAL_EARN_GATEWAY_SPEC.md](docs/UNIVERSAL_EARN_GATEWAY_SPEC.md)
- **Implementation and verification report:** [docs/earn-implementation-report.md](docs/earn-implementation-report.md)
- **Provider feasibility evidence:** [docs/earn-provider-research.md](docs/earn-provider-research.md)
- **Security review and follow-up:** [docs/earn-security-review.md](docs/earn-security-review.md)
- **Architecture and money flows:** [docs/architecture.md](docs/architecture.md)
- **User stories:** [docs/user-stories.md](docs/user-stories.md)
- **Video script:** [docs/demo-script.md](docs/demo-script.md)

The older architecture, story, and video documents are product-design material;
they do not establish that a provider, asset, country rail, or partner is live.
The Universal Earn Gateway contract above is the current source of truth for
the Earn demo.

## Current Earn truth model

| Area | What the current demo actually represents |
|---|---|
| Network | **DEVNET DEMO.** Write-capable routes are restricted to canonical Solana Devnet; Mainnet writes are disabled. |
| Funding | **SIMULATED FUNDING.** The demo never collects fiat. The legacy test issuer is off by default and requires `ENABLE_LEGACY_DEVNET_FAUCET=true`; if deliberately enabled, its test-token issuance is a real Devnet transaction only after its signature is confirmed. |
| Deposit and exit | A user may sign a Devnet transfer of the configured test token or demo share. The server verifies that transfer before it performs the corresponding app-controlled test-token/share movement. A preview or client-side success state is not confirmation. |
| Yield | **ILLUSTRATIVE YIELD.** Any rate is reference-only: it does not reprice a demo share, increase a balance, or enter redemption accounting. |
| Value | **NO MONETARY VALUE.** A Devnet token name, mint address, or displayed price does not make it USDC, USDY, KZT, a security, a deposit, or a claim on an issuer. |
| Payout | **SIMULATED PAYOUT.** A payout record is not a bank transfer or off-ramp. Returning a Devnet test token is still not fiat settlement. |
| Providers | Kamino, native staking, KZT/KZTE rails, Crossmint, card providers, and off-ramps are not enabled Earn providers merely because code, credentials, or UI affordances may exist. |

## What works today

| Flow | Current behavior and boundary |
|---|---|
| Demo session / wallet | Email authentication establishes an application demo session. An embedded wallet requires separately configured sandbox infrastructure; the Earn demo does not promise Crossmint availability or eligibility. |
| Earn discovery | Exactly one new strategy is discoverable: **Devnet Demo Strategy**. It uses an internal Devnet demo ledger, not Ondo, Kamino, KASE, a bank, or a live staking provider. |
| Funding | The Earn experience labels funding as **SIMULATED FUNDING**. Test-token issuance is disabled by default; it requires a configured issuer plus `ENABLE_LEGACY_DEVNET_FAUCET=true`, and must be evidenced by a confirmed signature. |
| Deposit | A user-signed, configured Devnet test-token transfer to the demo treasury is verified before the app issues a demo share. The current UI label is `vUSDY-DEMO`; it is not an Ondo USDY token. |
| Exit | A user-signed demo-share transfer is verified before the app returns configured Devnet test tokens and burns the returned demo shares. The fixed demo redemption value excludes illustrative yield. |
| Portfolio and receipts | The portfolio can show configured Devnet token accounts and confirmed signatures. Email receipts require separately configured SMTP and do not prove an external payment or payout. |
| Deferred providers | Kamino and native SOL staking are typed, fail-closed placeholders pending a verified Devnet route and lifecycle. KZT/KZTE, Intebix, card rails, Crossmint, Transak, MoonPay, and other providers remain unverified/disabled for the Earn gateway. |
| RWA-DEMO | A separately documented Devnet-only Meteora test scenario. It is not part of the Earn provider catalog and is not a real-world asset or fiat rail. |

### Quote-token naming

The separate direct RWA demo calls its default test quote token `QUOTE-DEMO`.
An explicit external-quote configuration may display a supplied Devnet mint as
`USDC` (or another configured symbol), but Plain neither issues nor certifies
that external token, and it still does not create a fiat, bank, or production
settlement path. The Earn flow uses its configured Devnet test token and
app-controlled demo shares; labels such as `USD`, `USDY`, `KZT`, or `USDC` are
never evidence of value or issuer backing.

## Legacy test-asset addresses (Devnet only)

These are legacy app-test addresses, not canonical asset identifiers, provider
integrations, or a guarantee that they are configured in a given deployment.
Read the runtime Devnet configuration and a confirmed Explorer signature before
treating any test-token movement as observed.

| Token | Mint |
|---|---|
| App-issued Devnet test token | `Hx7e212hfKYHNV5jdfV4R9NQ5JHCdt9w1g4aGYk7cSaV` |
| Legacy Devnet demo share (`vUSDY-DEMO` display label) | `NybngzX175W1p8xoL1yikAV2WnpQzHihMKgGnmifPD4` |
| Historic Devnet KZT demo share (new deposits disabled) | `Fn1idY7FZB4C3JaV5yZorqPUTg8sZN3ZHgqCp7mMJiAi` |
| Separate app-test asset token | `51UTD1qdeMmfudZdcWXgBVUoZNu4etKRDzRbkfBi9NR9` |
| Legacy Devnet test issuer / treasury | `8Mdmu9GN72J1scQC15SAa9pvDGpNMNJhxrPbCi3nQ6iD` |

## Status

The product is Devnet-only and its first Earn strategy is intentionally
simulated. Mainnet writes are disabled. A transaction is described as a real
Devnet action only when the application has verified it and can return its
signature/Explorer link; simulated funding, payout, yield, and reference data
are not converted into an on-chain or fiat claim. No bank, exchange, wallet
provider, issuer, KZT rail, or protocol named in this repository is a confirmed
partner or enabled production integration. This is not audited, production
ready, or compliance-approved.

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui on Base
UI, @solana/web3.js, @solana/spl-token, and nodemailer. Crossmint, Transak,
MoonPay, and other provider SDKs/configuration are optional development
adapters, not evidence of an enabled Earn route. The app is deployed on a VPS
behind nginx and Cloudflare (`scripts/deploy.sh`).

## Run locally

```bash
cp .env.example .env.local   # set only the Devnet test configuration you intentionally use
npm install
# The following is an opt-in Devnet write: it creates/reuses test-only assets
# and needs Devnet SOL on a server-side test authority.
node scripts/setup-devnet.mjs
npm run dev
# Optional, write-capable Devnet smoke check; do not run it without explicit
# intent to create test transactions.
node scripts/devnet-smoke.mjs
```

Use only a Devnet RPC and test authority. Do not use production keys, Mainnet
assets, or real payment credentials to exercise the demo.

### Earn demo safety switches

| Variable | Default and effect |
|---|---|
| `ENABLE_LEGACY_DEVNET_FAUCET` | `false`. Enables the authenticated, rate-limited legacy Devnet test-token issuer only after the canonical-Devnet check succeeds. It does not enable fiat funding. |
| `ENABLE_LEGACY_EARN_IMPORT` | `false`. Allows a controlled one-time reconciliation of historic pre-Gateway Devnet transfer records; ordinary portfolio reads never trigger it. |
| `ENABLE_LEGACY_FIAT_ADAPTERS` | `false`. Keeps legacy Crossmint/card/Transak/MoonPay/KZT/KZTE server routes fail-closed. |
| `NEXT_PUBLIC_ENABLE_LEGACY_FIAT_ADAPTERS` | `false`. Hides the legacy provider UI. It must be coordinated with the server flag, but neither flag proves provider, regional, or compliance availability. |

The Earn gateway does not need any of these flags for discovery. Do not set a
legacy flag merely to make a provider-looking screen appear: each provider
requires separate credentials, terms, eligibility, and deployment review.

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
or a claim on property, KASE, Intebix, KZTE, or any other real-world asset. By default,
`QUOTE-DEMO` is a test SPL token with no monetary value. An operator can explicitly opt
into an existing externally minted **Devnet-only** quote token (for example, a token
configured with a `USDC` display symbol) instead. In that external-quote mode, the
journey is only an on-chain Devnet quote-token
↔ `RWA-DEMO` swap: the app offers no KZT top-up, faucet, payout, or KZT ledger record.

The only potentially on-chain parts of this specific demo are configured Devnet
test-token mint/transfers (when the guarded faucet is enabled) and user-signed,
direct Meteora DLMM swaps. Call either action a real Devnet transaction only after
the app has verified its confirmation and returned its signature. Jupiter is not
used as an execution route in this flow.

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

   To use an externally minted Devnet quote token instead of creating `QUOTE-DEMO`, set
   all of the following before running the same command:

   ```bash
   DEVNET_EXTERNAL_QUOTE_MINT=true
   DEVNET_QUOTE_MINT=<existing-devnet-spl-token-mint>
   DEVNET_QUOTE_SYMBOL=USDC
   DEVNET_QUOTE_DECIMALS=6
   ENABLE_DEVNET_FAUCET=false
   # Keep the Devnet seed intentionally small; adjust both sides together.
   DEVNET_INITIAL_QUOTE_PER_RWA=100
   DEVNET_INITIAL_QUOTE_LIQUIDITY=100
   DEVNET_INITIAL_RWA_LIQUIDITY=1
   ```

   The payer's associated token account for that mint must already exist and contain at
   least `DEVNET_INITIAL_QUOTE_LIQUIDITY`. The bootstrap neither creates that ATA nor
   mints or faucets the external quote token; obtain its Devnet liquidity independently.
   It performs this read-only balance check before creating an RWA mint, pool, LP
   position, or writing public configuration.

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
2. With the default `QUOTE-DEMO`, create a simulated KZT-labelled funding record. No KZT
   is accepted; the displayed conversion is illustrative. If the guarded faucet is enabled
   it can issue a Devnet test token after confirmation. With
   `DEVNET_EXTERNAL_QUOTE_MINT=true`, acquire the external Devnet quote token outside the
   app instead—there is no KZT top-up or payout path in this mode.
3. Request a fresh direct Meteora quote, review its slippage and minimum output, then
   approve the swap in the connected wallet. The app confirms the signature on-chain and
   refreshes balances before marking the order complete.
4. Sell part or all of `RWA-DEMO` via a fresh reverse quote. In external-quote mode, the
   confirmed output is returned to the wallet as the external Devnet quote token. In the
   default mode, the app may create an explicitly simulated KZT payout receipt only; it
   never sends a bank transfer.

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
| `DEVNET_EXTERNAL_QUOTE_MINT` | Explicit opt-in for an existing third-party Devnet quote mint. Requires `DEVNET_QUOTE_MINT`; the bootstrap never creates its ATA or mints it. |
| `DEVNET_QUOTE_SYMBOL` | Safe uppercase display label; defaults to `USDC` in external-quote mode and `QUOTE-DEMO` otherwise. |
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
- **External quote liquidity missing** — create and fund the configured payer's ATA for
  `DEVNET_QUOTE_MINT` outside this app with at least
  `DEVNET_INITIAL_QUOTE_LIQUIDITY`; external quote mode intentionally never mints it.
- **No quote / stale quote / rejected signature** — request a new quote. A quote is not
  a price guarantee and an order is never completed from a client success flag alone.
- **Faucet unavailable** — this is intentional unless the explicit server-side flag,
  test-only payer, caps, and public mint configuration are present. Enable it only in
  guarded local or staging infrastructure; never expose an authority key in the browser.
- **Crossmint signing unavailable** — this is expected unless an eligible Devnet sandbox
  wallet is independently configured. Crossmint is optional here; its presence in source
  code or configuration does not establish user availability, eligibility, or a provider
  relationship. The integration never exports or stores a user private key.

Before a production or horizontally scaled deployment, replace the local JSON demo
ledger/rate limiter with a durable transactional datastore and shared rate limiter.
The IP limiter assumes your trusted reverse proxy strips and overwrites forwarded-IP
headers; do not expose the faucet directly to the public internet behind an untrusted
proxy. Wallet and aggregate caps remain enforced server-side.
Real KASE/Intebix/KZTE assets, real KZT rails, KYC/AML, custody, Mainnet, and a live
Jupiter execution route remain out of scope and disabled.

---

# Приложение (RU)

Plain сейчас — Devnet-only демонстрация Universal Earn с одной намеренно
симулированной стратегией. Это не инвестиционный продукт, счёт в банке,
on/off-ramp, выпуск реального токена или RWA-сервис. Тестовые токены, demo-доли,
балансы и записи о выплатах не имеют денежной стоимости. Страница `/bank` —
интерфейсный пример, а не подтверждение банковской интеграции.

Авторизация по email создаёт demo-сессию приложения. Встроенный кошелёк требует
отдельно настроенной sandbox-инфраструктуры; наличие Crossmint в коде не означает
доступность, географическую применимость или партнёрство.

## Текущая модель Earn

- **DEVNET DEMO.** Записывающие операции допускаются только в канонической сети
  Solana Devnet; Mainnet-запись отключена.
- **SIMULATED FUNDING.** Фиат не принимается. При явном включении серверного
  Devnet test issuer может быть выпущен тестовый токен; это реальная Devnet-
  транзакция только после подтверждения подписи.
- **Погашение и депозит.** Сервер сначала проверяет подписанный пользователем
  Devnet-перевод настроенного тестового токена или demo-доли, и лишь затем
  выполняет соответствующее app-controlled действие. Предпросмотр или сообщение
  клиента не являются подтверждением.
- **ILLUSTRATIVE YIELD.** Любая отображаемая ставка — только справочная: она не
  меняет цену demo-доли, баланс или сумму погашения.
- **SIMULATED PAYOUT / NO MONETARY VALUE.** Запись о выплате не является
  банковским переводом. Даже возвращённый Devnet test token не является фиатом,
  USDC, USDY, KZT, ценной бумагой или обязательством эмитента.

## Доступные операции

- **Одна новая стратегия.** В каталоге доступна только **Devnet Demo Strategy**:
  внутренний Devnet demo ledger, а не Ondo, Kamino, KASE, банк или staking-
  провайдер. UI-метка demo-доли — `vUSDY-DEMO`, и это не токен Ondo USDY.
- **Пополнение.** Earn явно помечает его как `SIMULATED FUNDING`. При
  настроенном и включённом Devnet test issuer выпуск test token остаётся
  test-only действием и должен сопровождаться подтверждённой подписью.
- **Депозит.** После проверки пользовательского Devnet-перевода test token в
  demo treasury приложение может выпустить demo-долю.
- **Выход.** После проверки пользовательского перевода demo-доли приложение
  может вернуть настроенный Devnet test token и сжечь полученную demo-долю.
  Сумма не включает illustrative yield.
- **Портфель.** В нём допустимо показывать настроенные Devnet token accounts и
  подтверждённые подписи. Email-квитанция требует отдельной SMTP-настройки и не
  подтверждает реальный платёж или выплату.
- **RWA-DEMO.** Отдельный Devnet-only сценарий Meteora, описанный выше; он не
  входит в каталог Earn и не является долей реального актива.

## KZT / KZTE и провайдеры

Kamino и native SOL staking — только typed, fail-closed placeholders до
проверки конкретного Devnet-маршрута и полного жизненного цикла. KZT/KZTE,
Intebix, банковские и карточные рельсы, Crossmint, Transak, MoonPay и другие
провайдеры не являются включёнными или проверенными Earn-провайдерами. В том
числе исторический KZT-labelled Devnet test mint не представляет KZTE, тенге
или обязательство какого-либо эмитента.

## Запуск и настройка

```bash
cp .env.example .env.local
npm install
node scripts/setup-devnet.mjs
npm run dev
```

`node scripts/setup-devnet.mjs` — opt-in операция записи в Devnet: она
создаёт/повторно использует только тестовые активы и требует Devnet SOL на
серверном test authority. Не используйте production-ключи, Mainnet-активы или
реальные платёжные реквизиты. `scripts/devnet-smoke.mjs` также создаёт
тестовые Devnet-транзакции и запускается только при явном намерении это сделать.

Необязательные sandbox-ключи Crossmint и платёжных провайдеров задаются только
после отдельной проверки; они не включают и не подтверждают Earn-маршрут.
Серверные переменные legacy Devnet test mints сохраняют текущие имена:

`DEMO_KZTE_MINT` — историческое имя переменной для Devnet test mint; оно не
обозначает настоящий KZTE. При повторном запуске `setup-devnet.mjs` использует
существующие тестовые mint-ы идемпотентно в пределах Devnet demo.

`scripts/devnet-smoke.mjs` читает `AUTH_SESSION_SECRET` из окружения или `.env.local`, создаёт одноразовый кошелёк и подписывает часовой session cookie с `smoke: true` и его `walletAddress`. Сервер использует этот адрес только из cookie с действительной HMAC-подписью; обычные сессии продолжают брать адрес из серверной связи email → wallet. Ни один HTTP endpoint не выпускает smoke-cookie, а `/api/auth/session` не обменивает его на JWT.

- `DEMO_TOKEN_MINT`
- `DEMO_USD_MINT`
- `DEMO_VAULT_USDY_MINT`
- `DEMO_VAULT_KZGB_MINT`
- `DEMO_KZTE_MINT`
- `DEMO_TOKEN_AUTHORITY_SECRET`

`node scripts/setup-devnet.mjs` создаёт/использует legacy test mint-ы (`OFFICE`,
test token и demo-доли) и token accounts test treasury в Devnet. Никакой такой
mint не является долей недвижимости, USDY, KZTE или фиатом. Если Devnet SOL
закончился, пополните test authority через Solana Devnet faucet и повторите
запуск. При необходимости укажите Devnet-only `SOLANA_RPC_URL`.

Настройки email необязательны: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS` и `MAIL_FROM`. Платёжные или wallet-provider ключи не должны
использоваться для описания реальной карты, off-ramp или KZT-выплаты в этой
демонстрации.

## Legacy test-адреса (только Devnet)

Это app-test адреса, а не канонические адреса активов или подтверждённые
интеграции. Проверяйте runtime-конфигурацию и подтверждённую Explorer-подпись
перед тем, как считать движение test token наблюдённым.

| Токен | Mint |
|---|---|
| App-issued Devnet test token | `Hx7e212hfKYHNV5jdfV4R9NQ5JHCdt9w1g4aGYk7cSaV` |
| Legacy demo-доля (`vUSDY-DEMO` в UI) | `NybngzX175W1p8xoL1yikAV2WnpQzHihMKgGnmifPD4` |
| Историческая KZT-labelled demo-доля (новые депозиты отключены) | `Fn1idY7FZB4C3JaV5yZorqPUTg8sZN3ZHgqCp7mMJiAi` |
| Отдельный app-test asset token | `51UTD1qdeMmfudZdcWXgBVUoZNu4etKRDzRbkfBi9NR9` |
| Legacy Devnet test issuer / treasury | `8Mdmu9GN72J1scQC15SAa9pvDGpNMNJhxrPbCi3nQ6iD` |

## Источники данных

- Любые FX, APY, доходность облигаций или provider quotes могут использоваться
  только как справочные/иллюстративные данные. Они не создают Earn-доход,
  provider-интеграцию, курс исполнения или цену погашения.
- DefiLlama, National Bank of Kazakhstan, Daily Treasury Rates, KASE, Transak
  и MoonPay не являются источником включённого продукта только потому, что их
  имена или данные встречаются в коде/документации.
