import { NextResponse } from "next/server";
import { createSandboxCheckout, FundingError } from "@/lib/funding-server";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new FundingError(400, "Expected checkout details.");
    return NextResponse.json(await createSandboxCheckout(request, body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json(
      {
        error:
          cause instanceof FundingError
            ? cause.message
            : "Could not create a sandbox checkout. Try again.",
      },
      {
        status: cause instanceof FundingError ? cause.statusCode : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
