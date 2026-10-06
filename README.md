# RWA Bridge — фундамент для хакатона

**Полный ресерч рынка, конкурентов, регуляторных рисков и плана запуска:**
[reports/Web3 asset onramp layer.md](../reports/Web3%20asset%20onramp%20layer.md)

Один вход (email, без seed-фразы) → пополнение баланса картой → портфель из
токенизированных активов из разных источников на одном экране. Контекст и полный
план — в документе «RWA-агрегатор — план проекта» (см. родительский репозиторий).

Что уже реально работает, если добавить ключи:

- **Вход и кошелёк** — Crossmint embedded wallet (email login, без seed-фразы),
  Solana. Staging-ключ = devnet, бесплатно.
- **Пополнение баланса** — основной способ: онрамп Crossmint (карта → USDC прямо на
  кошелёк пользователя, KYC внутри; в staging тестовая карта 4242 4242 4242 4242).
  Запасной — Mercuryo по ключу. Freedom и Kaspi — концепт. Без входа зачисляется
  демо-баланс.
- **Доход на реальных активах (RWA)** — две карточки (см. `lib/yields.ts`):
  - «Долларовый вклад» — Ondo USDY на Solana (гособлигации США). Адрес токена взят из
    официальной документации Ondo, ставка из ondo.finance с датой. Покупка пока демо:
    на DEX в Solana мало ликвидности USDY, для реального выпуска нужен KYC у Ondo.
  - «Тенговые облигации (демо)» — `mKZGB-DEMO`, такого токена не существует; рядом
    ориентир доходности индекса гособлигаций KASE. Только демонстрация.
  - Начисление идёт в браузере, 1 секунда = 1 день.
- **Покупка демо-актива** — доля `AIFC_MOCK_ASSET` выдаётся как наш SPL-токен
  `ICT-DEMO` (1 токен = $1 доли) на кошелёк пользователя в Solana devnet. Это
  настоящая транзакция, но токен — заглушка, пока нет лицензированного эмитента.
  Токен создаётся один раз: `node scripts/setup-demo-token.mjs`.

Что **не** подключено намеренно (см. `lib/assets.ts`):

- `XSTOCKS_DEMO_ASSET` — карточка показывает актив, но кнопка покупки отключена:
  адрес контракта в коде — placeholder, не проверен по официальной документации
  Backed/xStocks. Перед тем как это заработает по-настоящему, нужно (1) подставить
  реальный mint address, (2) провести маршрут свопа USDC → AAPLx через DEX.

## Настройка

```bash
cp .env.example .env.local
npm install
npm run dev
```

Открой [http://localhost:3000](http://localhost:3000). Без ключей в `.env.local`
приложение всё равно открывается — просто вход и кнопки покажут, чего не хватает,
вместо падения.

Ключи по порядку (весь пилот можно поднять бесплатно на тестовых/staging-ключах):

1. **`NEXT_PUBLIC_CROSSMINT_API_KEY`** — staging client key с
   [console.crossmint.com](https://staging.crossmint.com/console), scope Wallets.
   Включает вход и кошелёк.
2. **`CROSSMINT_SERVER_API_KEY`** — staging server key (`sk_staging_…`) из той же
   консоли. Включает онрамп Crossmint (сервер создаёт заказ на USDC).
3. **`DEMO_TOKEN_MINT` + `DEMO_TOKEN_AUTHORITY_SECRET`** — их печатает
   `node scripts/setup-demo-token.mjs`. Скрипту нужен devnet SOL на комиссии: если
   авто-раздача не сработала, пополни выведенный адрес на faucet.solana.com и запусти
   скрипт ещё раз (ключ сохраняется в `.demo-authority.json`, он в `.gitignore`).
   Включает кнопку «купить долю» на демо-активе.
4. **`NEXT_PUBLIC_MERCURYO_WIDGET_ID`** (+ `NEXT_PUBLIC_MERCURYO_WIDGET_HOST` для
   песочницы) — запасной онрамп Mercuryo.

## Структура

```
app/
  page.tsx              — вход
  portfolio/page.tsx     — портфель: пополнить → зарабатывать → купить
  demo-bank/page.tsx     — фейковый банк, плитка «Токены» открывает мост внутри
  api/mint-demo-asset/   — выдаёт SPL-токен ICT-DEMO на кошелёк (devnet)
  api/onramp-order/      — создаёт заказ онрампа Crossmint (карта → USDC)
components/
  CrossmintOnramp.tsx     — встроенная оплата картой Crossmint
  providers.tsx          — обёртка Crossmint (рендерится и без ключа)
  LoginPanel.tsx          — вход/выход, адрес кошелька
  OnrampButton.tsx        — выбор способа пополнения
  YieldCard.tsx           — хранилище с доходом: вложить, начисление, вывести
  AssetCard.tsx           — карточка актива + кнопка покупки
  BalanceBadge.tsx        — демо-баланс
lib/
  assets.ts               — список активов (что реально, что мок)
  yields.ts               — RWA-доходность (USDY, демо тенговых облигаций) и демо-начисление
  onramps.ts              — способы пополнения (Crossmint, Mercuryo, Freedom, Kaspi)
scripts/
  setup-demo-token.mjs    — один раз создаёт SPL-токен ICT-DEMO на devnet
  mockBalance.tsx         — демо-баланс и yield-позиции в памяти
  config.ts                — чтение env, флаги "настроено ли"
```

## Дальше (после хакатона, не сейчас)

Собственный кастоди, лицензия AFSA, реальный SPV и вторичный рынок — см. раздел
«Что НЕ строим на хакатоне» в документе плана. Этот репозиторий — только фундамент
для демо одного сценария.
