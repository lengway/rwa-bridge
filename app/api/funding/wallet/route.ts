import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  requireKaminoLendSession,
  kaminoLendErrorResponse,
} from "@/lib/kamino-lend-api";
import { KAMINO_LEND_DEVNET } from "@/lib/kamino-lend-devnet-config";
import { kaminoWalletTokenAccount } from "@/lib/kamino-token-account";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { walletAddress } = await requireKaminoLendSession(request);
    const connection = new Connection("https://api.devnet.solana.com", {
      commitment: "confirmed",
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(12000) }),
    });
    if (
      (await connection.getGenesisHash()) !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    )
      throw new Error("Invalid cluster");
    const owner = new PublicKey(walletAddress);
    const mint = new PublicKey(KAMINO_LEND_DEVNET.liquidityMint);
    const tokenAccount = kaminoWalletTokenAccount(mint, owner).toBase58();
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
      mint,
    });
    const amount = accounts.value.reduce((sum, account) => {
      const info = account.account.data.parsed?.info;
      if (
        info?.owner !== walletAddress ||
        info?.mint !== mint.toBase58() ||
        info?.tokenAmount?.decimals !== 6 ||
        !/^\d+$/.test(info?.tokenAmount?.amount)
      )
        throw new Error("Invalid token account");
      return sum + BigInt(info.tokenAmount.amount);
    }, BigInt(0));
    return NextResponse.json(
      {
        walletAddress,
        network: "devnet",
        mint: mint.toBase58(),
        tokenAccount,
        amountAtomic: amount.toString(),
        hasTokenAccount: accounts.value.length > 0,
        explorerUrl: `https://solscan.io/account/${walletAddress}?cluster=devnet`,
        tokenAccountExplorerUrl: `https://solscan.io/account/${tokenAccount}?cluster=devnet`,
        checkedAt: Date.now(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return kaminoLendErrorResponse(cause);
  }
}
