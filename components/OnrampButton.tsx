"use client";

import { useWallet } from "@crossmint/client-sdk-react-ui";
import { coinbaseOnrampAppId, isCrossmintConfigured, isOnrampConfigured } from "@/lib/config";

/**
 * Builds a Coinbase Onramp "one-click-buy" URL for the connected wallet.
 * Docs: https://docs.cdp.coinbase.com/onramp/docs/generating-onramp-url
 * This constructs the link client-side (fine for a demo); a production build should
 * generate it server-side with a session token instead of a bare appId.
 */
function buildOnrampUrl(address: string) {
  const addresses = encodeURIComponent(JSON.stringify({ [address]: ["solana"] }));
  const params = new URLSearchParams({
    appId: coinbaseOnrampAppId,
    defaultAsset: "USDC",
    defaultPaymentMethod: "CARD",
    presetFiatAmount: "50",
    fiatCurrency: "USD",
  });
  return `https://pay.coinbase.com/buy/select-asset?addresses=${addresses}&${params.toString()}`;
}

export function OnrampButton() {
  if (!isCrossmintConfigured) {
    return <OnrampButtonInner address={undefined} />;
  }
  return <OnrampButtonWithWallet />;
}

function OnrampButtonWithWallet() {
  const { wallet } = useWallet();
  return <OnrampButtonInner address={wallet?.address} />;
}

function OnrampButtonInner({ address }: { address: string | undefined }) {
  const disabledReason = !isOnrampConfigured
    ? "добавь NEXT_PUBLIC_COINBASE_ONRAMP_APP_ID"
    : !address
      ? "сначала войди — нужен адрес кошелька"
      : null;

  if (disabledReason) {
    return (
      <button disabled className="rounded-full border border-zinc-300 dark:border-zinc-700 px-5 py-3 text-sm text-zinc-400 cursor-not-allowed">
        Пополнить баланс — {disabledReason}
      </button>
    );
  }

  return (
    <a
      href={buildOnrampUrl(address!)}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-full bg-foreground text-background px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity inline-block"
    >
      Пополнить баланс картой (Coinbase Onramp)
    </a>
  );
}
