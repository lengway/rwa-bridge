/** Short read-only snapshots. Never use for preparation, signing or settlement. */
export function createReadCoalescer<T>(ttlMs: number, failureCooldownMs = 5_000, maxEntries = 200) {
  const entries = new Map<string, { value?: T; expiresAt: number; pending?: Promise<T>; error?: unknown }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const current = entries.get(key);
    if (current?.pending) return current.pending;
    if (current && current.expiresAt > now) {
      if (current.error !== undefined) return Promise.reject(current.error);
      return Promise.resolve(current.value as T);
    }
    const entry: { value?: T; expiresAt: number; pending?: Promise<T>; error?: unknown } = { expiresAt: 0 };
    entries.delete(key);
    // Do not evict active work: that would permit duplicate RPC requests.
    for (const [oldKey, old] of entries) {
      if (entries.size < maxEntries) break;
      if (!old.pending) entries.delete(oldKey);
    }
    entries.set(key, entry);
    entry.pending = Promise.resolve().then(load).then((value) => {
      entry.value = value;
      entry.expiresAt = Date.now() + ttlMs;
      return value;
    }, (cause) => {
      entry.error = cause;
      entry.expiresAt = Date.now() + failureCooldownMs;
      throw cause;
    }).finally(() => { entry.pending = undefined; });
    return entry.pending;
  };
}
