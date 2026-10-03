export type OnrampOption = {
  id: string;
  name: string;
  hint: string;
  /** "live" can open a real provider widget when its env keys are set; "concept" is a clearly labelled stand-in. */
  kind: "live" | "concept";
};

export const mercuryoWidgetId = process.env.NEXT_PUBLIC_MERCURYO_WIDGET_ID ?? "";
// Production host by default; set NEXT_PUBLIC_MERCURYO_WIDGET_HOST to the sandbox host from Mercuryo's docs while testing.
export const mercuryoWidgetHost = process.env.NEXT_PUBLIC_MERCURYO_WIDGET_HOST ?? "https://exchange.mercuryo.io";
export const isMercuryoConfigured = mercuryoWidgetId.length > 0;

export const ONRAMP_OPTIONS: OnrampOption[] = [
  {
    id: "mercuryo",
    name: "Банковская карта (Mercuryo)",
    hint: "Реальный провайдер, в списке поддерживаемых валют есть тенге",
    kind: "live",
  },
  {
    id: "binance-link",
    name: "Binance Kazakhstan (Link)",
    hint: "Концепт: лицензия AFSA, white-label крипто-сервис для финансовых организаций",
    kind: "concept",
  },
  {
    id: "kaspi",
    name: "Kaspi Pay, тенге",
    hint: "Концепт: так выглядело бы пополнение прямо в тенге",
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
