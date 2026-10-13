/**
 * Request guards for the issuer routes: per-client rate limit, a single-flight queue so only one
 * issuer transaction is in flight at a time (no racing blockhashes, no double sends), and
 * idempotency keys so a retried request returns the first result instead of sending again.
 * In-memory and per server instance, which matches one issuer key per deployment.
 */

export class GuardError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

export function createRateLimiter({ windowMs, perClient, global }: { windowMs: number; perClient: number; global: number }) {
  const hits = new Map<string, number[]>();
  let all: number[] = [];
  return function check(client: string, now = Date.now()) {
    all = all.filter((t) => now - t < windowMs);
    const recent = (hits.get(client) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= perClient || all.length >= global) {
      hits.set(client, recent);
      const oldest = Math.min(...(recent.length >= perClient ? recent : all));
      return { ok: false as const, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
    }
    recent.push(now);
    all.push(now);
    hits.set(client, recent);
    if (hits.size > 5_000) hits.clear();
    return { ok: true as const, retryAfter: 0 };
  };
}

/** Runs tasks one at a time, in arrival order. Rejects new work when `maxPending` are waiting. */
export function createSerialQueue(maxPending = 8) {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (pending >= maxPending) return Promise.reject(new GuardError("The issuer is busy with other transactions. Try again in a few seconds.", 503));
    pending += 1;
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      pending -= 1;
    });
  };
}

/**
 * Same key + same request → the same (possibly still running) result. Same key + different
 * request → 409. Failed attempts are forgotten so the client may retry with the same key.
 */
export function createIdempotencyStore<T>(ttlMs = 10 * 60_000, maxEntries = 2_000) {
  const entries = new Map<string, { fingerprint: string; at: number; result: Promise<T> }>();
  return function run(key: string, fingerprint: string, task: () => Promise<T>, now = Date.now()): Promise<T> {
    for (const [k, e] of entries) if (now - e.at > ttlMs || entries.size > maxEntries) entries.delete(k);
    const hit = entries.get(key);
    if (hit) {
      if (hit.fingerprint !== fingerprint) return Promise.reject(new GuardError("This idempotency key was already used for a different request.", 409));
      return hit.result;
    }
    const result = task();
    entries.set(key, { fingerprint, at: now, result });
    result.catch(() => {
      if (entries.get(key)?.result === result) entries.delete(key);
    });
    return result;
  };
}
