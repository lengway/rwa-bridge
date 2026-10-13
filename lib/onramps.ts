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
    name: "Solana devnet faucet",
    hint: "Instant · test dollars for devnet",
  },
  {
    id: "kzte-intebix",
    name: "In tenge · Intebix",
    hint: "Transfer from the Intebix reserve · 0 ₸ fee",
  },
  {
    id: "transak",
    name: "Card · Transak",
    hint: "",
  },
  {
    id: "moonpay",
    name: "Card · MoonPay",
    hint: "Card purchase · USD/EUR, Kazakhstan supported",
  },
  {
    id: "crossmint",
    name: "Card · Crossmint",
    hint: "",
  },
];
