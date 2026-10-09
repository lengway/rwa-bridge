"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { InvestDrawer, WithdrawDrawer } from "@/components/app/drawers";
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
    <div className="space-y-6 pb-12">
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

      <div className="fixed inset-x-0 bottom-[4.5rem] z-30 mx-auto w-full max-w-md border-t bg-background/95 p-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Доступно</p>
            <p className="truncate text-sm font-semibold tabular-nums">
              {hydrated ? formatMoney(cashUsd, displayCurrency) : "…"}
            </p>
          </div>
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
        </div>
      </div>
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
