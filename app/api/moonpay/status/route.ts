import "server-only";

import { NextResponse } from "next/server";
import { legacyFiatAdapterUnavailableResponse, legacyFiatAdaptersEnabled } from "@/lib/legacy-fiat-adapters";
import { moonpayConfig } from "@/lib/moonpay";

export async function GET() {
  if (!legacyFiatAdaptersEnabled()) return legacyFiatAdapterUnavailableResponse("moonpay");

  return NextResponse.json({
    configured: moonpayConfig.configured,
    environment: moonpayConfig.environment,
    canSign: moonpayConfig.canSign,
  }, { headers: { "Cache-Control": "no-store" } });
}
