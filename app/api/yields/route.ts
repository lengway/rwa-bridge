import { FALLBACK_YIELD_DATA } from "@/lib/market-data";
import { readYieldData } from "@/lib/market-data-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await readYieldData();
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      Object.fromEntries(Object.entries(FALLBACK_YIELD_DATA).map(([key, value]) => [key, { ...value, stale: true }])),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
