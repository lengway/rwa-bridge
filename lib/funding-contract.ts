export type FundingProvider = "transak" | "moonpay";
export type FundingMethod = {
  id: string;
  name: string;
  description: string;
  kind: "faucet" | "transfer" | "sandbox" | "planned";
  available: boolean;
  minimumUsd?: number;
  reason?: string;
};

/** Explicit, provider-specific sandbox gates cannot enable a production payment. */
export function sandboxFundingAvailable(
  provider: FundingProvider,
  environment: Record<string, string | undefined>,
) {
  if (environment.SOLANA_CLUSTER !== "devnet") return false;
  if (provider === "transak")
    return (
      environment.ENABLE_TRANSAK_STAGING === "true" &&
      Boolean(
        environment.NEXT_PUBLIC_TRANSAK_API_KEY?.trim() &&
        environment.TRANSAK_API_SECRET?.trim(),
      )
    );
  return (
    environment.ENABLE_MOONPAY_SANDBOX === "true" &&
    /^pk_test_[A-Za-z0-9_-]+$/.test(
      environment.NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY?.trim() ?? "",
    ) &&
    Boolean(environment.MOONPAY_SECRET_KEY?.trim())
  );
}

export function fundingMethods(
  environment: Record<string, string | undefined>,
): FundingMethod[] {
  return [
    {
      id: "circle",
      name: "Free demo USDC",
      description: "Circle faucet · USDC on Solana Devnet",
      kind: "faucet",
      available: true,
    },
    {
      id: "transfer",
      name: "From another wallet",
      description: "Receive USDC on Solana Devnet at your Plain address",
      kind: "transfer",
      available: true,
    },
    ...(["transak", "moonpay"] as const).map((provider) => ({
      id: provider,
      name: provider === "transak" ? "Transak" : "MoonPay",
      kind: "sandbox" as const,
      available: sandboxFundingAvailable(provider, environment),
      minimumUsd: provider === "transak" ? 30 : 5,
      description:
        provider === "transak"
          ? "Test a card checkout · staging"
          : "Test a card checkout · sandbox",
      reason:
        "Sandbox checkout is separate from USDC delivery to Solana Devnet.",
    })),
    {
      id: "crossmint",
      name: "Crossmint",
      description: "Card funding adapter · Devnet delivery not verified",
      kind: "planned",
      available: false,
    },
    {
      id: "bank",
      name: "Bank transfer / KZT",
      description: "Partner payment rail · not connected",
      kind: "planned",
      available: false,
    },
  ];
}

export function providerCheckoutStatus(
  status: string,
): "PROVIDER_COMPLETED" | "FAILED" | "PENDING" {
  const normalized = status.toUpperCase();
  if (normalized === "COMPLETED") return "PROVIDER_COMPLETED";
  if (
    ["FAILED", "CANCELLED", "CANCELED", "EXPIRED", "REFUNDED"].includes(
      normalized,
    )
  )
    return "FAILED";
  return "PENDING";
}

export function isSandboxWidgetUrl(provider: FundingProvider, value: string) {
  try {
    const url = new URL(value);
    return (
      url.origin ===
        (provider === "transak"
          ? "https://global-stg.transak.com"
          : "https://buy-sandbox.moonpay.com") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
