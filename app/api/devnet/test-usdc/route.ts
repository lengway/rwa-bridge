import "server-only";

import { NextResponse } from "next/server";
import bs58 from "bs58";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, transfer } from "@solana/spl-token";
import { getSessionWallet } from "@/lib/session-wallet";

// Circle's faucet can't fund off-curve smart-wallet addresses, so judges get a
// one-time 1 USDC drip from the project's devnet pool instead.
const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const DRIP_ATOMIC = BigInt(1_000_000);
const served = new Set<string>();

export async function POST(request: Request) {
  const session = await getSessionWallet(request);
  if (!session) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const raw = process.env.DEMO_TOKEN_AUTHORITY_SECRET?.trim();
  if (process.env.SOLANA_CLUSTER !== "devnet" || !raw) {
    return NextResponse.json({ error: "Test USDC is unavailable right now." }, { status: 503 });
  }
  if (served.has(session.walletAddress)) {
    return NextResponse.json({ error: "This wallet already received test USDC." }, { status: 429 });
  }
  served.add(session.walletAddress);
  try {
    const authority = Keypair.fromSecretKey(raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
    const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
    const source = await getOrCreateAssociatedTokenAccount(connection, authority, DEVNET_USDC_MINT, authority.publicKey);
    if (source.amount < DRIP_ATOMIC) {
      served.delete(session.walletAddress);
      return NextResponse.json({ error: "The test USDC pool is empty. Please try again later." }, { status: 503 });
    }
    const destination = await getOrCreateAssociatedTokenAccount(
      connection, authority, DEVNET_USDC_MINT, new PublicKey(session.walletAddress), true,
    );
    const signature = await transfer(connection, authority, source.address, destination.address, authority, DRIP_ATOMIC);
    return NextResponse.json({ signature, explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet` });
  } catch (cause) {
    served.delete(session.walletAddress);
    console.error("[test-usdc] drip failed:", cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: "Couldn't send test USDC. Please try again." }, { status: 500 });
  }
}
