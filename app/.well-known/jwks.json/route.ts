import { NextResponse } from "next/server";
import { getAuthJwks } from "@/lib/auth-server";

// Read the signing key at request time so a key rotation is published immediately.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAuthJwks(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
