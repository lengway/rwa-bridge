import { readKztRate } from "@/lib/market-data-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await readKztRate();
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
