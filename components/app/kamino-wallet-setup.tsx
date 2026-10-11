"use client";

import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatAtomicAmount } from "@/components/app/kamino-lend-contract";
import type { KaminoWalletSnapshot } from "@/lib/kamino-wallet-snapshot";

export function KaminoWalletSetup({ walletAddress, snapshot, loading, error, onRefresh, onCopy, action = "deposit" }: {
  walletAddress: string;
  snapshot: KaminoWalletSnapshot | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCopy: () => void;
  action?: "deposit" | "withdraw";
}) {
  const needsUsdc = action === "deposit" && snapshot?.liquidityAmountAtomic === "0";
  const needsSol = snapshot?.solBalanceLamports === "0";
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Your test wallet</h3>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} aria-label="Refresh wallet balances">
          <RefreshCw className={loading ? "animate-spin" : ""} />{loading ? "Checking…" : "Refresh"}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-3">
        <div><p className="text-xs text-muted-foreground">Devnet USDC</p><p className="mt-1 text-sm font-semibold tabular-nums">
          {snapshot ? formatAtomicAmount(snapshot.liquidityAmountAtomic, 6) : "—"}</p></div>
        <div><p className="text-xs text-muted-foreground">Devnet SOL · fees</p><p className="mt-1 text-sm font-semibold tabular-nums">
          {snapshot ? formatAtomicAmount(snapshot.solBalanceLamports, 9) : "—"}</p></div>
      </div>
      {error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}
      <details open={needsUsdc || needsSol} className="rounded-xl border p-3 text-xs leading-5">
        <summary className="cursor-pointer font-medium">Prepare free test funds</summary>
        <ol className="mt-3 list-decimal space-y-3 pl-4 text-muted-foreground">
          <li>Copy your wallet address below. No private key or seed phrase is needed.</li>
          {action === "deposit" ? <li>Open Circle&apos;s faucet, select <strong className="text-foreground">USDC → Solana Devnet</strong>, and paste this address.
            <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" className="mt-1 flex w-fit items-center gap-1 font-medium text-foreground underline underline-offset-4">Open USDC faucet <ExternalLink className="size-3" /></a></li> : <li>You do not need to add USDC to withdraw an existing position. Only Devnet SOL is needed for transaction fees and any token-account rent.</li>}
          <li>Get Devnet SOL for network fees and any refundable token-account rent.
            <a href="https://faucet.solana.com/" target="_blank" rel="noopener noreferrer" className="mt-1 flex w-fit items-center gap-1 font-medium text-foreground underline underline-offset-4">Open SOL faucet <ExternalLink className="size-3" /></a></li>
          <li>Return here and select <strong className="text-foreground">Refresh</strong>. Faucets have their own rate limits and may require a manual verification.</li>
        </ol>
        <p className="mt-3 break-all rounded-lg bg-muted/50 p-2 font-mono text-[11px]">{walletAddress}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onCopy}><Copy />Copy wallet address</Button>
        <p className="mt-3 text-muted-foreground">Use test tokens only. This is not a card payment, a fiat top-up, or a Mainnet transfer. Test funds have no monetary value.</p>
      </details>
    </Card>
  );
}
