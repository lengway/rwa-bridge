import { NextResponse } from "next/server";
import { AIFC_MOCK_ASSET } from "@/lib/assets";

/**
 * Mints one demo NFT into the recipient's Crossmint wallet, standing in for a real
 * AIFC-issued RWA token. Uses Crossmint's Minting API server-side:
 * https://docs.crossmint.com/nft-minting-api/introduction
 *
 * Needs CROSSMINT_SERVER_API_KEY + CROSSMINT_COLLECTION_ID (see .env.example).
 * Point CROSSMINT_SERVER_API_KEY at a *staging* key so this mints on devnet.
 */
export async function POST(request: Request) {
  const serverApiKey = process.env.CROSSMINT_SERVER_API_KEY;
  const collectionId = process.env.CROSSMINT_COLLECTION_ID;

  if (!serverApiKey || !collectionId) {
    return NextResponse.json(
      {
        error:
          "добавь CROSSMINT_SERVER_API_KEY и CROSSMINT_COLLECTION_ID в .env.local — см. комментарий в .env.example",
      },
      { status: 501 },
    );
  }

  const body = await request.json().catch(() => null);
  const recipientAddress: string | undefined = body?.recipientAddress;
  if (!recipientAddress) {
    return NextResponse.json({ error: "recipientAddress обязателен" }, { status: 400 });
  }

  const isStaging = serverApiKey.startsWith("sk_staging_");
  const apiBase = isStaging ? "https://staging.crossmint.com" : "https://www.crossmint.com";

  const res = await fetch(`${apiBase}/api/2022-06-09/collections/${collectionId}/nfts`, {
    method: "POST",
    headers: {
      "X-API-KEY": serverApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: `solana:${recipientAddress}`,
      metadata: {
        name: AIFC_MOCK_ASSET.name,
        description: AIFC_MOCK_ASSET.description,
        image: "https://www.crossmint.com/assets/crossmint/logo.png",
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ error: data?.message ?? "Crossmint mint вернул ошибку" }, { status: 502 });
  }

  return NextResponse.json({
    message: `${AIFC_MOCK_ASSET.ticker} отправлен в кошелёк (${isStaging ? "devnet" : "mainnet"})`,
    action: data,
  });
}
