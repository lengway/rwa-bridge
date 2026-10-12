"use client";

import Link from "next/link";
import { useState } from "react";
import { AccountGreeting } from "@/components/app/home-account";
import { QuickActions } from "@/components/app/home-actions";
import { KaminoLendDrawer } from "@/components/app/kamino-lend-drawer";
import { SimpleEarnSummary } from "@/components/app/simple-earn-summary";
import type { KaminoLendConfirmation } from "@/components/app/kamino-lend-contract";
import { simpleEarnBalances } from "@/lib/simple-earn-balances";
import { useDevnet } from "@/lib/useDevnet";

export function SimpleEarnScreen({ initialAction, onConfirmed }: {
  initialAction?: "deposit" | "withdraw";
  onConfirmed?: (confirmation: KaminoLendConfirmation) => void;
}) {
  const devnet = useDevnet();
  const balances = simpleEarnBalances(devnet.portfolio);
  const [action, setAction] = useState<"deposit" | "withdraw">(initialAction ?? "deposit");
  const [open, setOpen] = useState(initialAction !== undefined);
  const launch = (next: "deposit" | "withdraw") => { setAction(next); setOpen(true); };
  return (
    <div className="space-y-6">
      <AccountGreeting />
      <SimpleEarnSummary available={balances?.available ?? null} invested={balances?.invested ?? null} unavailable={!!devnet.portfolioError && !balances} />
      <QuickActions onInvest={() => launch("deposit")} onWithdraw={() => launch("withdraw")} />
      {balances?.hasOtherTokens ? <p className="text-xs leading-5 text-muted-foreground">Other demo tokens in your wallet cannot be invested as USDC. You can still view them in <Link className="underline" href="/portfolio">Wallet</Link>.</p> : null}
      {devnet.portfolio?.legacyUnavailable ? <p role="status" className="text-xs leading-5 text-muted-foreground">Earlier assets are temporarily unavailable. Your USDC balances above are separate; no assets were deleted.</p> : null}
      <details className="rounded-2xl border p-4 text-sm">
        <summary className="cursor-pointer font-medium">How does it work?</summary>
        <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
          <p>You invest USDC in Kamino Lend and approve each transaction with your wallet. Withdraw USDC when reserve liquidity is available.</p>
          <p>The lending position is represented by cUSDC. Its estimated USDC value is shown above, not a guaranteed return.</p>
          <p>Variable rate and protocol risk. This is not a bank deposit. The current demo uses test tokens on Solana Devnet, with a maximum of 1 USDC per action.</p>
        </div>
      </details>
      <div className="flex justify-between text-xs text-muted-foreground"><Link className="rounded px-2 py-2 underline underline-offset-4" href="/activity">Activity</Link><Link className="rounded px-2 py-2 underline underline-offset-4" href="/portfolio">Wallet &amp; earlier assets</Link></div>
      <KaminoLendDrawer key={action} open={open} onOpenChange={setOpen} initialAction={action} onConfirmed={onConfirmed} />
    </div>
  );
}
