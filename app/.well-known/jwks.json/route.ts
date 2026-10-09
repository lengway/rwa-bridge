import { NextResponse } from "next/server";
import { getAuthJwks } from "@/lib/auth-server";

export const revalidate = 3600;

export async function GET() {
  return NextResponse.json(getAuthJwks(), {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}
