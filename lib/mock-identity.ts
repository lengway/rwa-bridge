export type MockIdentityProfile = {
  mode: "MOCK";
  status: "MOCK_COMPLETED";
  country: string;
  adultAttested: true;
  mockAcknowledged: true;
  dataUsageAccepted: true;
  source: "SELF_MOCK" | "PARTNER_MOCK";
  partnerId?: "demo-bank";
  updatedAt: number;
};

export class MockIdentityInputError extends Error {}

export function isMockIdentityProfile(value: unknown): value is MockIdentityProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  return profile.mode === "MOCK" && profile.status === "MOCK_COMPLETED"
    && typeof profile.country === "string" && /^[A-Z]{2}$/.test(profile.country)
    && profile.adultAttested === true && profile.mockAcknowledged === true && profile.dataUsageAccepted === true
    && (profile.source === "SELF_MOCK" || (profile.source === "PARTNER_MOCK" && profile.partnerId === "demo-bank"))
    && typeof profile.updatedAt === "number" && Number.isSafeInteger(profile.updatedAt) && profile.updatedAt > 0;
}

export function createMockIdentityProfile(input: Record<string, unknown>, partnerId?: "demo-bank", now = Date.now()): MockIdentityProfile {
  const country = typeof input.country === "string" ? input.country.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country) || input.adultAttested !== true
    || input.mockAcknowledged !== true || input.dataUsageAccepted !== true) {
    throw new MockIdentityInputError("Choose a two-letter country code and acknowledge the demo declarations. No documents are checked.");
  }
  return { mode: "MOCK", status: "MOCK_COMPLETED", country, adultAttested: true,
    mockAcknowledged: true, dataUsageAccepted: true,
    source: partnerId ? "PARTNER_MOCK" : "SELF_MOCK", ...(partnerId ? { partnerId } : {}), updatedAt: now };
}
