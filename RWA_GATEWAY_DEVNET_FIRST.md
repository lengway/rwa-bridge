# RWA Gateway — Devnet-first Implementation Spec

**Версия:** 0.3  
**Статус:** implementation plan  
**Цель:** встроить Devnet-first торговый сценарий в существующий проект, не переписывая приложение и не завися от Intebix, KZTE, закрытых API или mainnet-ликвидности.

> Этот документ описывает demo-инфраструктуру. Он не является подтверждением доступности реальных RWA, работоспособности KZT-платежей или юридической допустимости реальной торговли токенизированными ценными бумагами.

## 1. Product goal

Пользователь должен пройти демонстрационный путь внутри существующего приложения:

1. Открыть каталог RWA.
2. Подключить или создать поддерживаемый Solana wallet.
3. Получить тестовые средства через явно обозначенный **simulated KZT top-up**.
4. Получить test quote token в своём кошельке — это реальная транзакция в Solana Devnet, но не реальный платёж в тенге.
5. Купить `RWA-DEMO` через реальный Meteora DLMM Devnet pool.
6. Увидеть подтверждённый signature, обновлённый баланс и ссылку на Solana Explorer.
7. Продать часть или весь `RWA-DEMO` через тот же пул.
8. Инициировать **simulated KZT payout** после продажи. Никакие настоящие тенге не переводятся.

Главный критерий: **симулируется только фиатная граница. Транзакции покупки/продажи тестовых токенов должны реально исполняться on-chain в Devnet.**

## 2. Explicit non-goals

В этой версии НЕ требуется:

- Intebix integration или какие-либо Intebix credentials;
- KZTE integration;
- реальная обработка KZT, банковских переводов или payout;
- Crossmint on-ramp/off-ramp;
- настоящий KASE mint или утверждение, что `RWA-DEMO` представляет права на реальный актив;
- Jupiter Swap API как обязательная часть Devnet flow;
- mainnet swaps, mainnet assets или реальные деньги;
- custody пользовательских средств командой проекта;
- реализация полноценного production KYC/AML;
- переписывание текущего приложения с нуля.

Intebix, KZTE, Crossmint и Jupiter должны оставаться подключаемыми возможностями, а не блокирующими зависимостями.

## 3. Source-of-truth and technical constraints

Перед изменениями coding agent обязан прочитать существующий репозиторий, его README, package manifests, текущие wallet/payment/token abstractions, стили и тесты. Сохранить текущий стек и conventions, по возможности расширять существующие интерфейсы. Не создавать дублирующее приложение или вторую систему авторизации.

Для Meteora ориентироваться на официальную актуальную документацию SDK:

- DLMM TypeScript SDK getting started: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/getting-started.mdx
- DLMM examples (pool creation, liquidity, swaps): https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx
- DLMM SDK reference: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx
- Meteora DLMM overview/program IDs: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/index.mdx

Официальные документы указывают на поддержку `cluster: "devnet"`; текущий DLMM program ID в документации указан как `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` и для Devnet, и для Mainnet. Не копировать примеры вслепую: проверить версию пакета и сигнатуры методов, которые установлены в проекте.

Дополнительные reference pages:

- Solana token model: https://solana.com/docs/tokens
- Create a token with the CLI: https://solana.com/docs/tokens/quickstart
- Devnet SOL faucet: https://solana.com/developers/cookbook/development/airdrops-and-faucets
- Jupiter integration docs: https://dev.jup.ag/docs

Jupiter не считать Devnet execution provider, пока публичная документация и реальный тест не подтвердят нужный маршрут. В этой версии обязательный roundtrip реализуется через Meteora DLMM непосредственно в Devnet.

## 4. Demo truth model

UI должен недвусмысленно разделять demo-фиат и on-chain тестовые активы.

| Operation | What is real? | Required label |
|---|---|---|
| Simulated KZT top-up | Только запись в demo order/ledger; настоящий KZT не принимается | `SIMULATED — no fiat payment` |
| Mint/transfer `USDC-DEMO` или quote token | Реальная Solana Devnet transaction | `DEVNET TEST TOKEN — no monetary value` |
| Meteora buy `RWA-DEMO` | Реальная Devnet transaction | `DEVNET SWAP — no real asset rights` |
| Meteora sell `RWA-DEMO` | Реальная Devnet transaction | `DEVNET SWAP — no real asset rights` |
| Simulated KZT payout | Только запись в demo ledger; деньги не переводятся | `SIMULATED — no KZT payout` |

Не называть демонстрационный top-up «банковским переводом», а demo mint — «получением USDC». Использовать точные названия `USDC-DEMO`/`QUOTE-DEMO`, чтобы не путать пользовательский интерфейс с официальным USDC.

## 5. Architecture

Сохранить существующую архитектуру проекта. Следующие компоненты — логические роли; размещать их в существующих frontend/backend folders согласно conventions проекта.

### 5.1 Asset registry

Для каждого demo asset хранить минимум:

- `id` — стабильный внутренний идентификатор;
- `name`, `symbol`, `description`;
- `network: "devnet"`;
- `mintAddress`;
- `tokenProgram` (если доступно);
- `quoteMintAddress`;
- `poolAddress`;
- `demo: true`;
- `rightsDisclosure`;
- `tradeEnabled`;
- ссылки на explorer.

Asset registry не должен представлять `RWA-DEMO` как KASE security или реальную облигацию. Название/description должны явно указывать на тестовый актив.

### 5.2 Wallet provider

Переиспользовать текущий wallet/auth implementation, если он есть.

Предусмотреть узкую абстракцию для:

- public key;
- network/cluster awareness;
- signing transaction(s);
- sending signed transaction(s), если это предусмотрено текущим wallet SDK;
- error handling и connected/disconnected state.

Если Crossmint Wallets уже подключён и совместим с текущим SDK, использовать его. Если нет, не блокировать разработку: поддержать существующий Solana wallet adapter в проекте или добавить стандартный adapter как fallback. Не хранить приватные ключи пользователей на backend и не менять production wallet settings без необходимости.

### 5.3 Demo KZT rail

Это только demo provider, не платежный шлюз.

Рекомендуемые операции:

- create simulated top-up order;
- calculate configured demo conversion into quote-token base units;
- mark simulation as confirmed;
- mint/transfer a capped quantity of quote token to a user wallet, только если включён server-side Devnet faucet;
- create simulated payout record after user sells quote tokens;
- expose explicit status and demo disclosure.

Demo FX value должен быть configurable и помечен в UI как illustrative/demo rate, а не live KZT/USD rate. Не использовать web price feed для вида, будто demo order — настоящий валютный обмен.

### 5.4 Devnet token faucet / issuer

Предпочтительный flow: отдельный bootstrap script создаёт тестовые mint и выдаёт initial supply для пулов. Для пользовательского тестового пополнения допустим backend faucet для quote token, но он обязан иметь жёсткие защиты:

- работает только при `SOLANA_CLUSTER=devnet`;
- требует explicit opt-in flag (`ENABLE_DEVNET_FAUCET=true`);
- fail closed, если cluster не Devnet;
- minter keypair только на сервере/в локальном `.secrets/`, никогда в frontend bundle;
- лимит на один кошелёк и временной интервал;
- лимит количества на выдачу и общий дневной лимит;
- валидация Solana public key;
- rate limiting, audit log и понятные ошибки;
- запрещено переиспользовать minter credentials для mainnet.

Если безопасную backend mint operation нельзя встроить в существующую архитектуру быстро, начальный вариант может требовать запустить CLI faucet локально. Но полноценное демо желательно поддержать одной кнопкой после явного подтверждения симуляции.

`RWA-DEMO` mint authority не должна выдаваться обычным пользователям. Supply RWA токена создаётся bootstrap-скриптом и распределяется в пул; пользователь получает `RWA-DEMO` только через swap.

### 5.5 Meteora execution provider

Реализовать прямое подключение к Meteora DLMM SDK для Devnet.

Основные операции:

- read pool/configuration;
- quote exact-input buy;
- build swap transaction;
- quote exact-input sell;
- build reverse swap transaction;
- confirm transaction and re-fetch token balances;
- build/display Solana Explorer URL.

Транзакции должны подписываться подключённым кошельком. Не хранить пользовательские подписи/ключи на backend.

SDK API меняется, поэтому implementation должен использовать актуальные package typings и official examples вместо угадывания методов. Применять `cluster: "devnet"` при создании Meteora pool client. Для exact-input swap использовать minimum output / slippage protection; не отправлять транзакцию с неограниченным минимальным output.

### 5.6 Jupiter provider

В этой версии:

- создать интерфейс `ExecutionProvider` или расширить уже существующий;
- добавить документацию/placeholder adapter для будущего Jupiter integration;
- не выполнять fake Jupiter quote и не показывать маршрутизатор Jupiter как реально использованный, если операция была исполнена напрямую через Meteora;
- не блокировать Devnet end-to-end flow ожиданием Jupiter API key или подтверждения devnet route.

## 6. Suggested domain model

Адаптировать названия/таблицы к существующей ORM и схеме. Не вводить новую БД, если текущая структура может хранить эти сущности.

### Asset

- `id`
- `name`
- `symbol`
- `network`
- `mint_address`
- `quote_mint_address`
- `pool_address`
- `is_demo`
- `is_trade_enabled`
- `rights_disclosure`
- `created_at`, `updated_at`

### DemoOrder

- `id` / `order_id`
- `user_id` (если текущая auth модель это поддерживает; иначе wallet address)
- `wallet_address`
- `side`: `BUY | SELL`
- `asset_id`
- `input_amount_atomic`
- `expected_output_atomic`
- `minimum_output_atomic`
- `quote_price`
- `simulated_kzt_amount`
- `status`
- `network = devnet`
- `transaction_signature` nullable
- `error_code`, `error_message` sanitized
- timestamps

### DemoFundingEvent

- `id`
- `wallet_address`
- `requested_kzt_amount`
- `demo_rate`
- `quote_token_amount_atomic`
- `status`: `SIMULATED_CREATED | SIMULATED_CONFIRMED | TEST_TOKEN_ISSUED | FAILED`
- `mint_signature` nullable
- timestamps

### DemoPayoutEvent

- `id`
- `wallet_address`
- `quote_token_amount_atomic`
- `simulated_kzt_amount`
- `status`: `SIMULATED_CREATED | SIMULATED_CONFIRMED`
- `disclosure`
- timestamps

Store atomic integers/strings for token amounts. Do not use JS floating-point values for token arithmetic or money amounts. Convert to display amounts at UI boundary with mint decimals.

## 7. Suggested API surface

Use the current project’s routing conventions and validation library. These are logical contracts, not an instruction to duplicate existing endpoints.

### `GET /api/demo/assets`

Returns active demo assets with mint, pool, decimals, disclosure and explorer metadata.

### `POST /api/demo/funding`

Input: `walletAddress`, `requestedKztAmount`.  
Behavior: validate wallet and amount; create simulated funding event; show configurable demo rate; if Devnet faucet is enabled, issue quote test tokens and return mint signature. Must clearly state no real KZT was collected.

### `POST /api/demo/quotes`

Input: `assetId`, `side`, `inputAmountAtomic`, `walletAddress`.  
Output: quote-token in/out, estimated price impact where supported, fee info, slippage bps, minimum output, quote expiry if applicable, route `meteora-dlmm-devnet`, `network=devnet`, `isDemo=true`.

Do not use a stale quote as a guarantee. Recompute before transaction build/submit.

### `POST /api/demo/orders`

Creates an order intent, records the selected quote params, and returns an identifier. Do not treat this as proof of a completed transaction.

### `POST /api/demo/orders/:id/confirm`

Accepts the real transaction signature after wallet submission; backend or client verifies the transaction on Devnet, checks expected wallet/mint/direction/amount as far as reliable transaction parsing allows, and updates status only after confirmation. Do not trust client-only success state.

### `POST /api/demo/payouts`

Creates a clearly simulated payout record after sell proceeds are verified. It must never initiate a real bank transfer.

### `GET /api/demo/orders/:id`

Returns state, signatures, confirmations, user-facing disclosure and errors.

## 8. Transaction state machine

Recommended buy flow:

`QUOTE_READY → ORDER_CREATED → WALLET_APPROVAL_PENDING → TRANSACTION_SUBMITTED → ONCHAIN_CONFIRMED → COMPLETED`

Failure states:

`QUOTE_EXPIRED`, `USER_REJECTED`, `TRANSACTION_FAILED`, `CONFIRMATION_TIMEOUT`, `NEEDS_REVIEW`.

Recommended sell flow follows the same pattern, with `SIMULATED_PAYOUT_PENDING` and `SIMULATED_PAYOUT_COMPLETED` after the real Devnet swap is confirmed.

Rules:

- do not mark transaction complete on wallet signature alone;
- after RPC confirmation, re-read balances/account state;
- use idempotent order IDs and prevent duplicate submissions where possible;
- if a request is retried, inspect existing order/transaction state before re-submitting;
- distinguish user rejection from RPC/provider failure;
- don't claim fiat was received or paid out;
- if the swap executed but a follow-up DB request failed, reconcile by signature instead of blindly repeating the swap.

## 9. UI requirements

Add to the existing app, keeping current design system and layout:

- visible `DEVNET DEMO` indicator on demo trading screens;
- network indicator with a guard against accidental Mainnet use;
- RWA demo asset card with price/pool/route info where available;
- quote view: input, expected output, slippage, fees, min output and expiry where possible;
- Buy and Sell actions;
- wallet connection / signing state;
- simulated top-up flow with explicit no-fiat disclosure;
- post-transaction confirmation with signature and Explorer link;
- portfolio/balance refresh after confirmed swap;
- simulated KZT payout receipt with explicit no-bank-transfer disclosure;
- empty, loading, rejected, failed and retry states.

Never present Devnet token price as a real market price. Use “demo pool price” or “Devnet pool quote”. Never imply RWA-DEMO represents a real legal claim or security.

## 10. Configuration and safety guards

Follow existing env naming where possible. Required logical configuration:

```dotenv
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
ENABLE_DEVNET_DEMO=true
ENABLE_DEVNET_FAUCET=false
DEVNET_PAYER_KEYPAIR_PATH=.secrets/devnet-payer.json
DEVNET_QUOTE_MINT=
DEVNET_RWA_MINT=
DEVNET_METEORA_POOL=
DEMO_KZT_PER_QUOTE_TOKEN=500
DEMO_FUNDING_MAX_KZT=1000000
DEMO_FAUCET_MAX_QUOTE_TOKENS=1000
```

These are illustrative variable names/defaults; adapt to current config schema and token decimals. The configured `500` is a **demo scenario rate only**, not a live exchange rate. UI and docs must say so.

Safety requirements:

- `.secrets/` and keypair JSON files must be gitignored;
- never log secret key material;
- fail startup/operation if demo mode is enabled but cluster is not Devnet;
- avoid hard-coding the demo mint/pool address in frontend code;
- never default to Mainnet when config is missing;
- show the actual cluster for every transaction;
- faucet limits are server-side and atomic where the storage layer allows;
- use the standard token program for simplest demo unless testing Token-2022 compatibility intentionally;
- validate requested amounts and integer bounds;
- do not expose privileged mint operations to arbitrary public production deployments.

Do not commit a real API key or any private key. Include a `.env.example` with blanks/placeholders only.

## 11. Bootstrap script

Create a script using the repo’s existing package manager and script conventions (for example, `devnet:bootstrap`) that:

1. verifies RPC cluster is Devnet;
2. loads a local devnet payer keypair only from ignored path or safe secret source;
3. checks payer balance and gives actionable instructions if SOL is insufficient;
4. creates `QUOTE-DEMO` and `RWA-DEMO` mints (or reuses configured mints when valid);
5. creates token accounts and initial supplies;
6. creates a Meteora DLMM permissionless V2 pool using an official SDK method and a valid Devnet preset;
7. initializes and funds the LP position with configured seed amounts;
8. confirms pool and mint accounts exist;
9. writes resulting public addresses into local `.env` or a generated local config without leaking secrets;
10. outputs Explorer links, mint addresses, pool address, token decimals and seed balances.

The exact SDK call must match the currently installed Meteora version and official docs. Never invent a preset address. Discover Devnet presets through the SDK/API or require an explicit validated setting. Make the script idempotent: if the pool already exists, reuse it after verifying token pair and cluster rather than creating duplicates.

If one-shot creation is too large or unreliable for the existing app, split it into `create-mints`, `create-pool`, and `seed-pool` scripts. Record which operations have succeeded so reruns can safely resume.

## 12. Testing requirements

### Unit tests

- atomic token amount ↔ UI formatting;
- demo KZT conversion uses configured illustrative rate and rounds down safely;
- input validation and max funding/faucet caps;
- state-machine transitions;
- no transaction completed before verification;
- network guard fails closed for non-Devnet;
- funding and payout disclosures always include simulated/no-fiat wording.

### Integration tests

Where Devnet/RPC credentials are available:

- wallet has/receives quote test token;
- fetch quote from Meteora SDK;
- buy swap transaction confirms;
- RWA token balance increases;
- sell swap transaction confirms;
- quote-token balance increases after sell;
- explorer signature opens the expected transaction;
- duplicate order confirmation is idempotent.

Where the environment cannot access Devnet, make unit tests and build pass and report network-dependent tests as `NOT RUN` with the reason. Do not claim they passed.

### Manual smoke-test checklist

- [ ] Connect wallet and confirm cluster is Devnet.
- [ ] Create a simulated top-up; the UI explicitly states no KZT payment took place.
- [ ] Receive `QUOTE-DEMO` with Devnet mint signature.
- [ ] Buy `RWA-DEMO` through Meteora; inspect confirmed signature.
- [ ] Refresh/reopen page and confirm balances/state remain accurate.
- [ ] Sell `RWA-DEMO` through Meteora and verify quote balance increases.
- [ ] Trigger simulated payout; verify no bank transfer is claimed.
- [ ] Try wrong cluster / missing config and confirm the app fails safely.
- [ ] Try stale quote, rejected signature, failed transaction and repeated callback.

## 13. Definition of Done

The implementation is considered done when:

1. It is integrated into the existing codebase, not a disconnected demo app.
2. The app clearly identifies Devnet and blocks demo operations on Mainnet.
3. Bootstrap can create or verify demo mints and a real Meteora DLMM Devnet pool.
4. The user can receive quote test tokens through the explicitly simulated funding flow.
5. The user can execute an actual Meteora buy and sell on Devnet.
6. Confirmed signatures and balances are shown and independently inspectable.
7. Failed/rejected/expired operations have visible recoverable states.
8. No KZT, KZTE, Intebix or real-RWA claim is made when none occurred.
9. Existing project tests/build still work, and new tests pass where runnable.
10. README documents setup, env config, bootstrap, how to demo, and known limitations.

## 14. Delivery report required from implementation agent

At completion, report:

- files changed and why;
- packages added/updated and versions;
- commands run and actual results;
- test status: `PASS`, `FAIL`, or `NOT RUN`;
- required env keys (without secrets);
- how to create/fund demo pool;
- mint/pool addresses if bootstrapped;
- any blocker requiring human/partner action;
- explicit confirmation that no production/mainnet/fiat integration is represented as completed.

## 15. Current official references

- Meteora DLMM TypeScript SDK examples: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx
- Meteora DLMM SDK getting started: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/getting-started.mdx
- Meteora DLMM SDK reference: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx
- Meteora DLMM overview and program IDs: https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/index.mdx
- Solana token model: https://solana.com/docs/tokens
- Solana token CLI quickstart: https://solana.com/docs/tokens/quickstart
- Solana Devnet airdrops/faucets: https://solana.com/developers/cookbook/development/airdrops-and-faucets
- Jupiter developer docs: https://dev.jup.ag/docs
