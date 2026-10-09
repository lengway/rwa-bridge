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
import { ProductSummary, ProjectionCalculator } from "@/components/app/earn-detail-parts";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import type { YieldStrategy } from "@/lib/yields";

export function EarnDetail({ strategy }: { strategy: YieldStrategy }) {
  const { positions, cashUsd, displayCurrency, hydrated } = useAppStore();
  const [amount, setAmount] = useState(1000);
  const [investOpen, setInvestOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const position = positions[strategy.id];
  const currentEarned = position?.earnedCarryUsd ?? 0;
  const currentPosition = position
    ? { value: position.valueUsd ?? position.principal + currentEarned, earned: currentEarned }
    : undefined;

  return (
    <div className="space-y-6">
      <ProductSummary strategy={strategy} />
      <ProjectionCalculator
        strategy={strategy}
        amount={amount}
        onAmountChange={setAmount}
        currentPosition={currentPosition}
        currency={displayCurrency}
      />
      <ExplainerSections strategy={strategy} />
      <RiskSection strategy={strategy} />
      <EligibilitySection strategy={strategy} />
      <TechnicalDetails strategy={strategy} />

      <DetailActionBar amount={hydrated ? formatMoney(cashUsd, displayCurrency) : "…"}>
        {position ? (
          <Button
            variant="outline"
            className="h-11 flex-1"
            onClick={() => setWithdrawOpen(true)}
            disabled={!hydrated}
          >
            Вывести
          </Button>
        ) : null}
        <Button
          className="h-11 flex-1"
          onClick={() => setInvestOpen(true)}
          disabled={!hydrated}
        >
          <ArrowRight />Вложить
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
