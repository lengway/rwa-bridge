"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { InvestDrawer, WithdrawDrawer } from "@/components/app/drawers";
import { DetailActionBar } from "@/components/app/detail-action-bar";
import {
  EligibilitySection,
  ExplainerSections,
  RiskSection,
  TechnicalDetails,
} from "@/components/app/earn-explainer-parts";
import {
  ProductSummary,
  ProjectionCalculator,
  canInvestInStrategy,
  canRedeemStrategy,
} from "@/components/app/earn-detail-parts";
import { Button } from "@/components/ui/button";
import { formatQuantity } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { YieldStrategy } from "@/lib/yields";

export function EarnDetail({ strategy }: { strategy: YieldStrategy }) {
  const { positions, cashUsd, hydrated } = useAppStore();
  const [amount, setAmount] = useState(1000);
  const [investOpen, setInvestOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const position = positions[strategy.id];
  const currentEarned = position?.earnedCarryUsd ?? 0;
  const currentPosition = position
    ? { value: position.valueUsd ?? position.principal + currentEarned, earned: currentEarned }
    : undefined;
  const canInvest = canInvestInStrategy(strategy);
  const canRedeem = canRedeemStrategy(strategy);

  return (
    <div className="space-y-6">
      <ProductSummary strategy={strategy} />
      <ProjectionCalculator
        strategy={strategy}
        amount={amount}
        onAmountChange={setAmount}
        currentPosition={currentPosition}
      />
      <ExplainerSections strategy={strategy} />
      <RiskSection strategy={strategy} />
      <EligibilitySection strategy={strategy} />
      <TechnicalDetails strategy={strategy} />

      {!canInvest ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">
          RESEARCH / UNSUPPORTED: новые пополнения для этой карточки отключены. Она не является предложением вложить
          реальные средства.
        </p>
      ) : null}
      {position && !canRedeem ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">
          TEST-TOKEN REDEMPTION сейчас не поддерживается для этой позиции. Не создавайте новую операцию, пока
          совместимый путь выхода не будет подтверждён.
        </p>
      ) : null}
      <DetailActionBar amount={hydrated ? `${formatQuantity(cashUsd)} TEST QUOTE` : "…"}>
        {position ? (
          <Button
            variant="outline"
            className="h-11 flex-1"
            onClick={() => {
              if (canRedeem) setWithdrawOpen(true);
            }}
            disabled={!hydrated || !canRedeem}
          >
            {canRedeem ? "Погасить тестовые доли" : "Выход недоступен"}
          </Button>
        ) : null}
        <Button
          className="h-11 flex-1"
          onClick={() => {
            if (canInvest) setInvestOpen(true);
          }}
          disabled={!hydrated || !canInvest}
        >
          <ArrowRight />{canInvest ? "Открыть Devnet-демо" : "Недоступно"}
        </Button>
      </DetailActionBar>
      <InvestDrawer
        open={investOpen}
        onOpenChange={setInvestOpen}
        strategy={strategy}
      />
      <WithdrawDrawer
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
      />
    </div>
  );
}
