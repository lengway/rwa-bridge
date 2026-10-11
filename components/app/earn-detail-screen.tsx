"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { InvestDrawer, WithdrawDrawer } from "@/components/app/drawers";
import { KaminoLendDrawer } from "@/components/app/kamino-lend-drawer";
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

export function EarnDetail({ strategy, initialAction }: { strategy: YieldStrategy; initialAction?: "deposit" | "withdraw" }) {
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

      {!isKaminoLend && !canInvest ? (
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
      <DetailActionBar amount={isKaminoLend ? "Devnet USDC" : hydrated ? `${formatQuantity(cashUsd)} TEST QUOTE` : "…"}>
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
            {canRedeem ? "Вывести" : "Вывод недоступен"}
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
            {canRedeem ? "Погасить тестовые доли" : "Выход недоступен"}
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
          <ArrowRight />{canInvest ? isKaminoLend ? "Пополнить Kamino" : "Открыть Solana Devnet" : "Недоступно"}
        </Button>
      </DetailActionBar>
      {isKaminoLend ? (
        <KaminoLendDrawer
          key={kaminoAction}
          open={kaminoOpen}
          onOpenChange={setKaminoOpen}
          initialAction={kaminoAction}
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
