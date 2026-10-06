import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { AIFC_MOCK_ASSET } from "@/lib/assets";

const DECIMALS = 6;

/**
 * Issues ICT-DEMO SPL tokens (1 token = $1 of the demo asset) into the buyer's wallet
 * on Solana devnet. Stands in for a real AIFC-issued token; devnet only, no value.
 * Mint and authority come from `node scripts/setup-demo-token.mjs`.
 */
export async function POST(request: Request) {
  const mintAddress = process.env.DEMO_TOKEN_MINT;
  const authoritySecret = process.env.DEMO_TOKEN_AUTHORITY_SECRET;
  if (!mintAddress || !authoritySecret) {
    return NextResponse.json(
      { error: "запусти node scripts/setup-demo-token.mjs и добавь DEMO_TOKEN_MINT и DEMO_TOKEN_AUTHORITY_SECRET в .env.local" },
      { status: 501 },
    );
  }

  const body = await request.json().catch(() => null);
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(body?.recipientAddress);
  } catch {
    return NextResponse.json({ error: "некорректный recipientAddress" }, { status: 400 });
  }

  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(authoritySecret)));
  const mint = new PublicKey(mintAddress);

  try {
    // allowOwnerOffCurve: Crossmint smart wallets can be PDAs rather than on-curve keys.
    const ata = await getOrCreateAssociatedTokenAccount(connection, authority, mint, recipient, true);
    const amount = BigInt(AIFC_MOCK_ASSET.demoPriceUsd) * BigInt(10 ** DECIMALS);
    const signature = await mintTo(connection, authority, mint, ata.address, authority, amount);
    return NextResponse.json({
      message: `${AIFC_MOCK_ASSET.demoPriceUsd} ${AIFC_MOCK_ASSET.ticker} отправлены в кошелёк (devnet)`,
      signature,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ошибка выпуска токена";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
