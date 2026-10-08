import "server-only";

const CACHE_TTL_MS = 10_000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

export function readCachedDevnetPortfolio<T>(walletAddress: string) {
  const cached = cache.get(walletAddress);
  if (!cached || cached.expiresAt <= Date.now()) {
    cache.delete(walletAddress);
    return null;
  }
  return cached.value as T;
}

export function cacheDevnetPortfolio(walletAddress: string, value: unknown) {
  cache.set(walletAddress, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateDevnetPortfolio(walletAddress: string) {
  cache.delete(walletAddress);
}
