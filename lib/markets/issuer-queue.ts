import "server-only";

import { createSerialQueue } from "./api-guard";

/**
 * The one queue every issuer-signed transaction goes through (console routes and investor
 * allocations), so the server never has two issuer transactions in flight. Kept on globalThis so
 * every route bundle in the process shares it.
 */
const store = globalThis as typeof globalThis & { __plainMarketsIssuerQueue?: ReturnType<typeof createSerialQueue> };

export const issuerQueue = (store.__plainMarketsIssuerQueue ??= createSerialQueue(8));
