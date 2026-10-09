export type OnrampOption = {
  id: string;
  name: string;
  hint: string;
};

export const TRANSAK_STAGING_WIDGET_ORIGIN = "https://global-stg.transak.com";
export const TRANSAK_MIN_USD = 30;

export const ONRAMP_OPTIONS: OnrampOption[] = [
  {
    id: "devnet-faucet",
    name: "Кран Solana devnet",
    hint: "Мгновенно · тестовые доллары для сети devnet",
  },
  {
    id: "transak",
    name: "Карта · Transak",
    hint: "",
  },
  {
    id: "crossmint",
    name: "Карта · Crossmint",
    hint: "",
  },
];
