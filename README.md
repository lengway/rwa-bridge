# RWA Bridge — фундамент для хакатона

**Полный ресерч рынка, конкурентов, регуляторных рисков и плана запуска:**
[reports/Web3 asset onramp layer.md](../reports/Web3%20asset%20onramp%20layer.md)

Один вход (email, без seed-фразы) → пополнение баланса картой → портфель из
токенизированных активов из разных источников на одном экране. Контекст и полный
план — в документе «RWA-агрегатор — план проекта» (см. родительский репозиторий).

Что уже реально работает, если добавить ключи:

- **Вход и кошелёк** — Crossmint embedded wallet (email login, без seed-фразы),
  Solana. Staging-ключ = devnet, бесплатно.
- **Пополнение баланса** — Crossmint embedded onramp (staging) — основной карточный
  способ; Crossmint заявляет доступность в 160+ странах и упрощённую проверку до
  $1 000. В Казахстане онрамп Crossmint сейчас показывает «Not available in your
  country yet», поэтому тестировать нужно из поддерживаемого региона. Transak STAGING —
  запасной способ, работает из Казахстана; тестовая KYC-персона Transak предзаполнена.
  Mercuryo требует партнёрского доступа (KYB), Kaspi и Freedom — концепты. Без входа
  доступно демо-зачисление.
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
5. **`NEXT_PUBLIC_TRANSAK_API_KEY` + `TRANSAK_API_SECRET`** — тестовый виджет Transak.
   API secret хранится только на сервере; обе staging-учётные записи нужны из
   [кабинета Transak](https://dashboard.transak.com/).

Для проверки Transak STAGING документация даёт Visa `4024764449971519` (срок `10/33`,
CVV `123`, USD, 3DS) и пароль 3DS `Checkout1!`. Для тестового US KYC: first name `Doe`,
last name `Jane`, телефон `+12125550142`, дата рождения `01-01-1998`, адрес
`179 Richmond Oak`, `California`, `CA`, `94016`, SSN `123456789`. Staging KYC использует
фиктивные проверки и подтверждает прохождение. В staging-виджете заранее заполняется
тестовая персона Transak, поэтому останется ввести код из письма и данные тестовой карты.
[Инструкция Transak по тестовым данным](https://docs.transak.com/guides/sandbox-credentials).

## Структура

```
app/
  page.tsx               — публичная главная и описание сценария
  (app)/                 — мобильное приложение с общей навигацией
    home/                 — баланс, вклады, активы и быстрые действия
    earn/                 — продукты дохода и детали вклада
    assets/               — список активов, карточки и покупка доли
    activity/             — история операций по дням
    profile/              — аккаунт, настройки и демо-данные
  portfolio/page.tsx      — перенаправление на /home
  demo-bank/page.tsx      — нейтральный экран банка с мостом внутри
  api/mint-demo-asset/   — выдаёт SPL-токен ICT-DEMO на кошелёк (devnet)
  api/onramp-order/      — создаёт заказ онрампа Crossmint (карта → USDC)
  api/transak-session/   — создаёт тестовую сессию виджета Transak
components/
  app/                   — экраны, карточки, оболочка и выдвижные панели
  ui/                    — компоненты интерфейса на Base UI
  CrossmintOnramp.tsx     — встроенная оплата картой Crossmint
  providers.tsx           — тема, уведомления, состояние и Crossmint
lib/
  assets.ts               — список активов (что реально, что мок)
  yields.ts               — продукты дохода и ускоренные демо-начисления
  onramps.ts              — способы пополнения (Crossmint, Transak, Mercuryo, Kaspi, Freedom)
  store.tsx               — общее состояние и сохранение демо-данных в браузере
  format.ts               — форматы сумм, ставок и дат операций
  useNow.ts               — ускоренные часы для начислений
scripts/
  setup-demo-token.mjs    — один раз создаёт SPL-токен ICT-DEMO на devnet
lib/config.ts             — чтение env и флаги подключения
```

## Дальше (после хакатона, не сейчас)

Собственный кастоди, лицензия AFSA, реальный SPV и вторичный рынок — см. раздел
«Что НЕ строим на хакатоне» в документе плана. Этот репозиторий — только фундамент
для демо одного сценария.
