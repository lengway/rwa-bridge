import "server-only";

import { NextResponse } from "next/server";
import { appendDeposits, getLedgerWallet, hasLedgerSignature, type LedgerDeposit } from "@/lib/devnet-ledger";
import { isConfigured, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import { APP_CONTROLLED_LEGACY_YIELD_STRATEGIES } from "@/lib/yields";
import { getUnassignedIncomingPayments, verifyIncomingPayment } from "@/lib/solana-server";
import { invalidateDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { getSessionWallet } from "@/lib/session-wallet";

export async function POST(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  // Automatic attribution predates the exact action ledger. It remains
  // opt-in for controlled migration only, never part of the Earn Gateway.
  if (process.env.ENABLE_LEGACY_EARN_IMPORT !== "true") {
    return NextResponse.json({
      error: "Automatic assignment of historical transfers is disabled. Use the Solana Devnet log to reconcile.",
      code: "LEGACY_IMPORT_DISABLED",
    }, { status: 410 });
  }
  const body = await request.json().catch(() => null) as {
    walletAddress?: unknown;
    productId?: unknown;
  } | null;
  if (!isValidWalletAddress(body?.walletAddress)) {
    return NextResponse.json({ error: "Provide a valid Solana wallet address." }, { status: 400 });
  }
  if (
    typeof body?.productId !== "string"
    || !APP_CONTROLLED_LEGACY_YIELD_STRATEGIES.some((item) => item.id === body.productId)
  ) {
    return NextResponse.json({ error: "Unknown yield product." }, { status: 400 });
  }

  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "An authenticated session is required." }, { status: 401 });
  if (session.walletAddress !== body.walletAddress) {
    return NextResponse.json({ error: "The wallet address does not match the current session." }, { status: 403 });
  }
  const walletAddress = session.walletAddress;

  try {
    const wallet = await getLedgerWallet(walletAddress);
    if (wallet.deposits.length > 0) {
      return NextResponse.json({ error: "Deposits are already linked for this wallet." }, { status: 409 });
    }
    const incoming = await getUnassignedIncomingPayments(walletAddress);
    const deposits: LedgerDeposit[] = [];
    for (const item of incoming) {
      if (await hasLedgerSignature(item.signature)) continue;
      await verifyIncomingPayment({
        signature: item.signature,
        fromOwner: walletAddress,
        minAmountUi: item.amountUsd,
      });
      deposits.push({
        productId: body.productId,
        amountUsd: item.amountUsd,
        signature: item.signature,
        at: item.at,
      });
    }
    if (deposits.length === 0) {
      return NextResponse.json({ error: "No unconfirmed transfers to the treasury found." }, { status: 400 });
    }
    const updated = await appendDeposits(walletAddress, deposits);
    invalidateDevnetPortfolio(walletAddress);
    const assignedUsd = deposits.reduce((total, item) => total + item.amountUsd, 0);
    return NextResponse.json({ ok: true, assignedUsd, count: updated.deposits.length });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Couldn't link the transfers to the deposit."),
    }, { status: 400 });
  }
}
