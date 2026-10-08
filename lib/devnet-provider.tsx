"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import {
  DevnetContext,
  type DevnetBalance,
  type DevnetPortfolio,
  type DevnetState,
  type DevnetStatus,
} from "@/lib/useDevnet";

export function DevnetProvider({
  children,
  crossmintEnabled,
}: {
  children: React.ReactNode;
  crossmintEnabled: boolean;
}) {
  const [status, setStatus] = useState<DevnetStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/devnet/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("status unavailable");
        return response.json() as Promise<DevnetStatus>;
      })
      .then((value) => {
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false, usdMint: null, assetMint: null, treasury: null, treasuryOwner: null });
      });
    return () => { cancelled = true; };
  }, []);

  if (crossmintEnabled) {
    return (
      <CrossmintDevnetRuntime status={status}>
        {children}
      </CrossmintDevnetRuntime>
    );
  }
  return <DevnetRuntime status={status} authStatus="logged-out" walletAddress={null}>{children}</DevnetRuntime>;
}

function CrossmintDevnetRuntime({
  status,
  children,
}: {
  status: DevnetStatus | null;
  children: React.ReactNode;
}) {
  const { status: authStatus } = useCrossmintAuth();
  const { wallet } = useWallet();
  return (
    <DevnetRuntime status={status} authStatus={authStatus} walletAddress={wallet?.address ?? null}>
      {children}
    </DevnetRuntime>
  );
}

function DevnetRuntime({
  status,
  authStatus,
  walletAddress,
  children,
}: {
  status: DevnetStatus | null;
  authStatus: string;
  walletAddress: string | null;
  children: React.ReactNode;
}) {
  const loggedInAddress = authStatus === "logged-in" ? walletAddress : null;
  const mode = status?.configured && loggedInAddress ? "devnet" : "demo";
  const [balanceState, setBalanceState] = useState<{ walletAddress: string; balance: DevnetBalance } | null>(null);
  const [portfolioState, setPortfolioState] = useState<{ walletAddress: string; portfolio: DevnetPortfolio } | null>(null);

  const refreshBalance = useCallback(async () => {
    if (mode !== "devnet" || !loggedInAddress) {
      return;
    }
    try {
      const response = await fetch(`/api/devnet/balance?wallet=${encodeURIComponent(loggedInAddress)}`, { cache: "no-store" });
      if (!response.ok) return;
      const value = await response.json() as DevnetBalance;
      if (Number.isFinite(value.usd) && Number.isFinite(value.assetUnits)) {
        setBalanceState({ walletAddress: loggedInAddress, balance: value });
      }
    } catch {
      // Leave the last confirmed balance visible during transient RPC failures.
    }
  }, [loggedInAddress, mode]);

  const refreshPortfolio = useCallback(async () => {
    if (mode !== "devnet" || !loggedInAddress) return;
    try {
      const response = await fetch(`/api/devnet/portfolio?wallet=${encodeURIComponent(loggedInAddress)}`, { cache: "no-store" });
      if (!response.ok) return;
      const value = await response.json() as DevnetPortfolio;
      if (Array.isArray(value.positions) && Array.isArray(value.holdings) && Array.isArray(value.activity)) {
        setPortfolioState({ walletAddress: loggedInAddress, portfolio: value });
      }
    } catch {
      // Retain the last confirmed portfolio during transient RPC failures.
    }
  }, [loggedInAddress, mode]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshBalance(), refreshPortfolio()]);
  }, [refreshBalance, refreshPortfolio]);

  useEffect(() => {
    if (mode !== "devnet") {
      return;
    }
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshBalance();
    }, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshBalance();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [mode, refresh, refreshBalance]);

  const onchain = mode === "devnet" && balanceState?.walletAddress === loggedInAddress
    ? balanceState.balance
    : null;
  const portfolio = mode === "devnet" && portfolioState?.walletAddress === loggedInAddress
    ? portfolioState.portfolio
    : null;
  const value = useMemo<DevnetState>(() => ({
    mode,
    walletAddress: loggedInAddress,
    usdMint: status?.usdMint ?? null,
    treasury: status?.treasury ?? null,
    treasuryOwner: status?.treasuryOwner ?? null,
    onchain,
    portfolio,
    refresh,
    refreshPortfolio,
  }), [loggedInAddress, mode, onchain, portfolio, refresh, refreshPortfolio, status?.treasury, status?.treasuryOwner, status?.usdMint]);

  return <DevnetContext.Provider value={value}>{children}</DevnetContext.Provider>;
}
