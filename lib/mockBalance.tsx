"use client";

import { createContext, useContext, useState } from "react";

/**
 * Stand-in for real on-chain balances: no provider account, no network call — just
 * numbers in memory so "пополнить -> купить -> зарабатывать" can be demoed end to end.
 * Swap for wallet balances read from Solana once the onramp and vault deposits are real.
 */
export type YieldPosition = { principal: number; since: number };

type BalanceContextValue = {
  usdc: number;
  addFunds: (amount: number) => void;
  spend: (amount: number) => boolean;
  positions: Record<string, YieldPosition>;
  deposit: (strategyId: string, amount: number) => boolean;
  withdraw: (strategyId: string, payout: number) => void;
};

const BalanceContext = createContext<BalanceContextValue | null>(null);

export function BalanceProvider({ children }: { children: React.ReactNode }) {
  const [usdc, setUsdc] = useState(0);
  const [positions, setPositions] = useState<Record<string, YieldPosition>>({});

  const addFunds = (amount: number) => setUsdc((v) => v + amount);

  const spend = (amount: number) => {
    if (usdc < amount) return false;
    setUsdc((v) => v - amount);
    return true;
  };

  const deposit = (strategyId: string, amount: number) => {
    if (!spend(amount)) return false;
    setPositions((p) => ({ ...p, [strategyId]: { principal: amount, since: Date.now() } }));
    return true;
  };

  const withdraw = (strategyId: string, payout: number) => {
    setPositions((p) => {
      const next = { ...p };
      delete next[strategyId];
      return next;
    });
    setUsdc((v) => v + payout);
  };

  return (
    <BalanceContext.Provider value={{ usdc, addFunds, spend, positions, deposit, withdraw }}>
      {children}
    </BalanceContext.Provider>
  );
}

export function useBalance() {
  const ctx = useContext(BalanceContext);
  if (!ctx) throw new Error("useBalance must be used within a BalanceProvider");
  return ctx;
}
