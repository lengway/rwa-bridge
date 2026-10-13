const TECHNICAL = /(\bRPC\b|0x[0-9a-f]{6,}|TypeError|ReferenceError|SyntaxError|ECONN|ENOTFOUND|fetch failed|\bat .+:\d+|[{}<>]|https?:\/\/)/i;

/** True when an error message is a short, curated sentence safe to show to users. */
export function isUserFacingMessage(message: string): boolean {
  return message.length > 0 && message.length <= 240 && !TECHNICAL.test(message);
}

export function russianActionError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  return isUserFacingMessage(message) ? message : fallback;
}
