export function normalizeWidgetOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

/** Explicit configuration only; never derive trust from a request Host or token jku. */
export function widgetAllowedOrigins(environment: Record<string, string | undefined> = process.env) {
  const appOrigin = normalizeWidgetOrigin(environment.AUTH_JWT_ISSUER) ?? "https://plain.lengway.me";
  const entries = [appOrigin, ...(environment.WIDGET_ALLOWED_ORIGINS?.split(",") ?? []).filter(Boolean).map((value) => value.trim())];
  const normalized = entries.map(normalizeWidgetOrigin);
  if (normalized.some((value) => value === null)) throw new Error("Widget origin configuration is invalid.");
  return [...new Set(normalized as string[])];
}
