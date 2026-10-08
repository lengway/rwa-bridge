import { FALLBACK_KZT_DATA } from "@/lib/market-data";
import { readKztRate } from "@/lib/market-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await readKztRate();
  if (data) return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  return Response.json(
    { ...FALLBACK_KZT_DATA, stale: true },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
  );
}
