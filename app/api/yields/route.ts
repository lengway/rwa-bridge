import { FALLBACK_YIELD_DATA } from "@/lib/market-data";
import { readYieldData } from "@/lib/market-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await readYieldData();
  if (data) {
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    Object.fromEntries(Object.entries(FALLBACK_YIELD_DATA).map(([key, value]) => [key, { ...value, stale: true }])),
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
  );
}
