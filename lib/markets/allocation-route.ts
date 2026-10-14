/**
 * The "Get allocation" request, as a plain function so the guard chain is testable without Next:
 *
 *   signed-in session → listed instrument → per-wallet + per-IP + global rate limit →
 *   Idempotency-Key (scoped to the wallet) → issuer single-flight queue → issuer.allocate
 *   (which re-reads the wallet balance and enforces the window and the per-investor cap).
 *
 * The cash leg is simulated: nothing is charged. The response says so.
 */
import { GuardError, createIdempotencyStore, createRateLimiter } from "./api-guard";
import type { TxResult } from "./service";

export type AllocationResult = TxResult & { units: string };

export type AllocationDeps = {
  /** The signed-in user's smart wallet, or null when there is no valid session. */
  sessionWallet(request: Request): Promise<{ walletAddress: string } | null>;
  /** True when allocation can run at all (devnet mode with the issuer key). */
  writable(): boolean;
  isListed(mint: string): Promise<boolean>;
  allocate(mint: string, wallet: string, units: unknown): Promise<AllocationResult>;
  /** Serializes issuer transactions (shared with the console routes). */
  queue<T>(task: () => Promise<T>): Promise<T>;
  /** Maps issuer errors to HTTP statuses; null for unexpected errors. */
  knownError(error: unknown): { message: string; status: number } | null;
};

export type AllocationResponse = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function createAllocationHandler(
  deps: AllocationDeps,
  options: {
    perWallet?: { windowMs: number; max: number };
    perIp?: { windowMs: number; max: number };
    global?: number;
  } = {},
) {
  const perWallet = options.perWallet ?? { windowMs: 60 * 60_000, max: 6 };
  const perIp = options.perIp ?? { windowMs: 60_000, max: 10 };
  const walletLimiter = createRateLimiter({ windowMs: perWallet.windowMs, perClient: perWallet.max, global: options.global ?? 120 });
  const ipLimiter = createRateLimiter({ windowMs: perIp.windowMs, perClient: perIp.max, global: options.global ?? 120 });
  const idempotent = createIdempotencyStore<AllocationResult>();

  return async function handle(request: Request, mint: string): Promise<AllocationResponse> {
    const fail = (error: string, status: number, headers?: Record<string, string>): AllocationResponse => ({ status, body: { error }, headers });

    const session = await deps.sessionWallet(request);
    if (!session) return fail("Sign in to request an allocation.", 401);
    if (!deps.writable()) return fail("Bond allocations are not available right now.", 503);
    if (!ADDRESS.test(mint)) return fail("Unknown bond.", 404);

    const key = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!/^[\w-]{8,100}$/.test(key)) return fail("An Idempotency-Key header (8–100 characters) is required.", 400);

    const raw = await request.text();
    if (raw.length > 1_000) return fail("Request too large.", 413);
    let body: { units?: unknown };
    try {
      body = JSON.parse(raw) as { units?: unknown };
    } catch {
      return fail("Invalid JSON.", 400);
    }
    if (!body || typeof body !== "object") return fail("Invalid JSON.", 400);

    if (!(await deps.isListed(mint))) return fail("Unknown bond.", 404);

    const wallet = session.walletAddress;
    const ip = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || request.headers.get("x-real-ip") || "local";
    const fingerprint = JSON.stringify({ mint, units: body.units });
    const scopedKey = `${wallet}:${key}`;

    try {
      // A retry with the same key returns the first result without spending rate-limit budget.
      const result = await idempotent(scopedKey, fingerprint, () => {
        for (const [limiter, client] of [[ipLimiter, ip], [walletLimiter, wallet]] as const) {
          const limit = limiter(client);
          if (!limit.ok) return Promise.reject(Object.assign(new GuardError("Too many allocation requests. Try again later.", 429), { retryAfter: limit.retryAfter }));
        }
        return deps.queue(() => deps.allocate(mint, wallet, body.units));
      });
      return { status: 200, body: { ...result, simulatedCashLeg: true } };
    } catch (error) {
      if (error instanceof GuardError) {
        const retryAfter = (error as GuardError & { retryAfter?: number }).retryAfter;
        return fail(error.message, error.status, retryAfter ? { "retry-after": String(retryAfter) } : undefined);
      }
      const known = deps.knownError(error);
      if (known) return fail(known.message, known.status);
      console.error("[bonds] allocation failed", error);
      return fail("Solana devnet request failed. Try again in a moment.", 502);
    }
  };
}
