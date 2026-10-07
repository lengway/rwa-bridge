export type OnrampOption = {
  id: string;
  name: string;
  hint: string;
  /** "live" can open a real provider widget when its env keys are set; "concept" is a clearly labelled stand-in. */
  kind: "live" | "concept";
};

export const TRANSAK_STAGING_WIDGET_ORIGIN = "https://global-stg.transak.com";
export const TRANSAK_MIN_USD = 30;

export const mercuryoWidgetId = process.env.NEXT_PUBLIC_MERCURYO_WIDGET_ID ?? "";
// Production host by default; set NEXT_PUBLIC_MERCURYO_WIDGET_HOST to the sandbox host from Mercuryo's docs while testing.
export const mercuryoWidgetHost = process.env.NEXT_PUBLIC_MERCURYO_WIDGET_HOST ?? "https://exchange.mercuryo.io";
export const isMercuryoConfigured = mercuryoWidgetId.length > 0;

export const ONRAMP_OPTIONS: OnrampOption[] = [
  {
    id: "devnet-faucet",
    name: "Тестовый банкомат",
    hint: "Мгновенно · тестовые доллары в сети Solana, без карты и проверки",
    kind: "live",
  },
  {
    id: "moonpay",
    name: "Карта · MoonPay",
    hint: "Покупка и вывод на карту · работает в Казахстане",
    kind: "live",
  },
  {
    id: "crossmint",
    name: "Карта · Crossmint",
    hint: "Оплата прямо в приложении · упрощённая проверка до $1 000",
    kind: "live",
  },
  {
    id: "transak",
    name: "Карта · Transak",
    hint: "Запасной способ · тестовый режим",
    kind: "live",
  },
  {
    id: "mercuryo",
    name: "Карта · Mercuryo",
    hint: "Нужен партнёрский доступ (KYB)",
    kind: "live",
  },
  {
    id: "kaspi",
    name: "Kaspi Pay, тенге",
    hint: "Концепт: так выглядело бы пополнение прямо в тенге",
    kind: "concept",
  },
  {
    id: "freedom",
    name: "Freedom (счёт в тенге)",
    hint: "Концепт: пополнение со счёта Freedom, как это выглядело бы при партнёрстве",
    kind: "concept",
  },
];

export function buildMercuryoUrl(address: string) {
  const params = new URLSearchParams({
    widget_id: mercuryoWidgetId,
    currency: "USDC",
    network: "SOLANA",
    fiat_currency: "USD",
    address,
  });
  return `${mercuryoWidgetHost}/?${params.toString()}`;
}
