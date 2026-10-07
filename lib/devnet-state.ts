import "server-only";

// These in-memory demo records intentionally reset when the dev server restarts.
export const devnetDeposits = new Map<string, number>();
