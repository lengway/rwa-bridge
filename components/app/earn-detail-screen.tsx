"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { InvestDrawer, WithdrawDrawer } from "@/components/app/drawers";
import { KaminoLendDrawer } from "@/components/app/kamino-lend-drawer";
import { DetailActionBar } from "@/components/app/detail-action-bar";
import {
  RiskSection,
  TechnicalDetails,
} from "@/components/app/earn-explainer-parts";
import {
  ProductSummary,
  ProjectionCalculator,
  canInvestInStrategy,
  canRedeemStrategy,
} from "@/components/app/earn-detail-parts";
import {
  KaminoPositionCard,
  KaminoPositionEmpty,
  hasKaminoPosition,
} from "@/components/app/kamino-position-card";
import { Button } from "@/components/ui/button";
import { formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { useEarnOverview } from "@/lib/useEarnOverview";
import type { YieldStrategy } from "@/lib/yields";
import type { KaminoLendConfirmation } from "@/components/app/kamino-lend-contract";

export function EarnDetail({ strategy, initialAction, onConfirmed }: { strategy: YieldStrategy; initialAction?: "deposit" | "withdraw"; onConfirmed?: (confirmation: KaminoLendConfirmation) => void }) {
  const { positions, cashUsd, hydrated } = useAppStore();
  const [amount, setAmount] = useState(1000);
  const [investOpen, setInvestOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [kaminoOpen, setKaminoOpen] = useState(strategy.gateway.provider === "KAMINO" && initialAction !== undefined);
  const [kaminoAction, setKaminoAction] = useState<"deposit" | "withdraw">(initialAction ?? "deposit");
  const position = positions[strategy.id];
  const currentEarned = position?.earnedCarryUsd ?? 0;
  const currentPosition = position
    ? { value: position.valueUsd ?? position.principal + currentEarned, earned: currentEarned }
    : undefined;
  const canInvest = canInvestInStrategy(strategy);
  const canRedeem = canRedeemStrategy(strategy);
  const isKaminoLend = strategy.gateway.provider === "KAMINO";
  const { overview, loading: overviewLoading } = useEarnOverview();
  const kaminoOverview = isKaminoLend ? overview : null;
  const showKaminoPosition = hasKaminoPosition(kaminoOverview);

  return (
    <div className="space-y-6">
      {showKaminoPosition && kaminoOverview ? <KaminoPositionCard overview={kaminoOverview} /> : null}
      <ProductSummary strategy={strategy} liveApy={kaminoOverview?.supplyApy ?? null} />
      {isKaminoLend && kaminoOverview && !showKaminoPosition && !overviewLoading ? <KaminoPositionEmpty /> : null}
      <ProjectionCalculator
        strategy={strategy}
        amount={amount}
        onAmountChange={setAmount}
        currentPosition={currentPosition}
      />
      <RiskSection strategy={strategy} />
      <TechnicalDetails strategy={strategy} />

      {!isKaminoLend && !canInvest ? (
        <p className="text-xs leading-5 text-muted-foreground">
          New deposits unavailable.
        </p>
      ) : null}
      {position && !canRedeem ? (
        <p className="text-xs leading-5 text-muted-foreground">
          Withdrawals temporarily unavailable.
        </p>
      ) : null}
      <DetailActionBar amount={isKaminoLend ? "USDC" : hydrated ? `${formatQuantity(cashUsd)} TEST QUOTE` : "…"}>
        {isKaminoLend ? (
          <Button
            variant="outline"
            className="h-11 flex-1"
            onClick={() => {
              setKaminoAction("withdraw");
              setKaminoOpen(true);
            }}
            disabled={!canRedeem}
          >
            {canRedeem ? "Withdraw" : "Withdraw unavailable"}
          </Button>
        ) : position ? (
          <Button
            variant="outline"
            className="h-11 flex-1"
            onClick={() => {
              if (canRedeem) setWithdrawOpen(true);
            }}
            disabled={!hydrated || !canRedeem}
          >
            {canRedeem ? "Redeem test shares" : "Exit unavailable"}
          </Button>
        ) : null}
        <Button
          className="h-11 flex-1"
          onClick={() => {
            if (isKaminoLend) {
              setKaminoAction("deposit");
              setKaminoOpen(true);
            } else if (canInvest) {
              setInvestOpen(true);
            }
          }}
          disabled={(!isKaminoLend && !hydrated) || !canInvest}
        >
          <ArrowRight />{canInvest ? isKaminoLend ? "Invest" : "Continue" : "Unavailable"}
        </Button>
      </DetailActionBar>
      {isKaminoLend ? (
        <KaminoLendDrawer
          key={kaminoAction}
          open={kaminoOpen}
          onOpenChange={setKaminoOpen}
          initialAction={kaminoAction}
          onConfirmed={onConfirmed}
        />
      ) : (
        <>
          <InvestDrawer
            open={investOpen}
            onOpenChange={setInvestOpen}
            strategy={strategy}
          />
          <WithdrawDrawer
            open={withdrawOpen}
            onOpenChange={setWithdrawOpen}
          />
        </>
      )}
    </div>
  );
}
