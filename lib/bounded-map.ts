/** Avoid RPC bursts when hydrating historical transactions. */
export async function boundedMap<T, R>(items: readonly T[], load: (item: T) => Promise<R>, concurrency = 2) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await load(items[index]);
    }
  }));
  return results;
}
