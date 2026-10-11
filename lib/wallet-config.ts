/** This release signs Devnet payloads only with the staging wallet bridge. */
export function isDevnetWalletKey(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && /^ck_staging_[A-Za-z0-9_-]+$/.test(value);
}
