"use client";

import { createContext, useContext, useState } from "react";

/**
 * Stand-in for a real onramp balance. No provider account, no KYC, no network call —
 * just a number in memory so the "пополнить -> купить" flow can be demoed end to end
 * without depending on any fiat-onramp provider's sign-up flow.
 *
 * Swap this out for a real provider (Coinbase Onramp, MoonPay, Transak — whichever
 * one actually lets your users complete verification) once one is wired up; nothing
 * else in the app needs to change, since AssetCard only reads `usdc` and `spend`.
 */
type BalanceContextValue = {
  usdc: number;
  addFunds: (amount: number) => void;
  spend: (amount: number) => boolean;
};

const BalanceContext = createContext<BalanceContextValue | null>(null);

export function BalanceProvider({ children }: { children: React.ReactNode }) {
  const [usdc, setUsdc] = useState(0);

  const addFunds = (amount: number) => setUsdc((v) => v + amount);
  const spend = (amount: number) => {
    let ok = false;
    setUsdc((v) => {
      if (v < amount) return v;
      ok = true;
      return v - amount;
    });
    return ok;
  };

  return <BalanceContext.Provider value={{ usdc, addFunds, spend }}>{children}</BalanceContext.Provider>;
}

export function useBalance() {
  const ctx = useContext(BalanceContext);
  if (!ctx) throw new Error("useBalance must be used within a BalanceProvider");
  return ctx;
}
