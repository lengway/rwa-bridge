import "server-only";

import { NextResponse } from "next/server";
import { getRwaDemoOrderForWallet } from "@/lib/devnet-ledger";
import {
  RwaDemoRequestError,
  demoErrorResponse,
  demoOrderResponse,
  requireDemoSession,
} from "@/lib/rwa-demo-api";
import { RWA_DEMO_SWAP_DISCLOSURE } from "@/lib/rwa-demo";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireDemoSession(request);
    const { id } = await params;
    const order = await getRwaDemoOrderForWallet(id, session.walletAddress);
    if (!order) throw new RwaDemoRequestError(404, "ORDER_NOT_FOUND", "The requested demo order was not found.");
    return NextResponse.json({ order: demoOrderResponse(order), disclosure: RWA_DEMO_SWAP_DISCLOSURE });
  } catch (error) {
    return demoErrorResponse(error);
  }
}
