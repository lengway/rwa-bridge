# RWA Bridge — фундамент для хакатона

Один вход (email, без seed-фразы) → пополнение баланса картой → портфель из
токенизированных активов из разных источников на одном экране. Контекст и полный
план — в документе «RWA-агрегатор — план проекта» (см. родительский репозиторий).

Что уже реально работает, если добавить ключи:

- **Вход и кошелёк** — Crossmint embedded wallet (email login, без seed-фразы),
  Solana. Staging-ключ = devnet, бесплатно.
- **Пополнение баланса** — кнопка ведёт в Coinbase Onramp (карта → USDC).
- **Покупка демо-актива** — `AIFC_MOCK_ASSET` минтится как NFT в кошелёк
  пользователя через Crossmint Minting API (реальная транзакция на devnet, просто
  вместо настоящего RWA-токена — заглушка, пока нет лицензированного партнёра).

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
2. **`CROSSMINT_SERVER_API_KEY` + `CROSSMINT_COLLECTION_ID`** — staging server key
   (scope Minting API) и id коллекции, которую нужно создать в том же консоли.
   Включает кнопку «купить долю» на демо-активе.
3. **`NEXT_PUBLIC_COINBASE_ONRAMP_APP_ID`** — App ID с
   [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/products/onramp).
   Включает кнопку пополнения баланса.

## Структура

```
app/
  page.tsx              — вход
  portfolio/page.tsx     — портфель, два шага: пополнить → купить
  api/mint-demo-asset/   — сервер-роут, минтит демо-RWA-токен через Crossmint
components/
  providers.tsx          — обёртка Crossmint (рендерится и без ключа)
  LoginPanel.tsx          — вход/выход, адрес кошелька
  OnrampButton.tsx        — ссылка на Coinbase Onramp
  AssetCard.tsx           — карточка актива + кнопка покупки
lib/
  assets.ts               — список активов (что реально, что мок)
  config.ts                — чтение env, флаги "настроено ли"
```

## Дальше (после хакатона, не сейчас)

Собственный кастоди, лицензия AFSA, реальный SPV и вторичный рынок — см. раздел
«Что НЕ строим на хакатоне» в документе плана. Этот репозиторий — только фундамент
для демо одного сценария.
