export type KaminoConfirmationCheck = "confirmed" | "failed" | "pending" | "unknown";
export type KaminoPollingResult = KaminoConfirmationCheck | "cancelled";

function waitForNextCheck(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Checks an existing signature only. Never builds, signs or resends an action. */
export async function pollKaminoConfirmation({
  check, signal, maxAttempts = 10, intervalMs = 3_000, wait = waitForNextCheck,
}: {
  check: (signal: AbortSignal) => Promise<KaminoConfirmationCheck>;
  signal: AbortSignal;
  maxAttempts?: number;
  intervalMs?: number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}): Promise<KaminoPollingResult> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20
    || !Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("Invalid confirmation polling limits.");
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal.aborted) return "cancelled";
    let result: KaminoConfirmationCheck;
    try {
      result = await check(signal);
    } catch {
      return signal.aborted ? "cancelled" : "unknown";
    }
    if (signal.aborted) return "cancelled";
    if (result !== "pending") return result;
    if (attempt + 1 < maxAttempts) await wait(intervalMs, signal);
  }
  return "pending";
}
