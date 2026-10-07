import "server-only";

import { NextResponse } from "next/server";
import { moonpayConfig } from "@/lib/moonpay";

export async function GET() {
  return NextResponse.json({
    configured: moonpayConfig.configured,
    environment: moonpayConfig.environment,
    canSign: moonpayConfig.canSign,
  }, { headers: { "Cache-Control": "no-store" } });
}
