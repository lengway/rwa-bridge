"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/useAuth";
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
        if (!cancelled) setStatus({
          configured: false,
          usdMint: null,
          assetMint: null,
          vaultUsdyMint: null,
          vaultKzgbMint: null,
          treasury: null,
          treasuryOwner: null,
        });
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
  const { status: authStatus, walletAddress } = useAuth();
  useEffect(() => {
    if (authStatus !== "signed-in") return;
    void fetch("/api/me/session", {
      method: "POST",
    }).catch(() => undefined);
  }, [authStatus]);
  return (
    <DevnetRuntime
      status={status}
      authStatus={authStatus === "signed-in" ? "logged-in" : authStatus === "signed-out" ? "logged-out" : "initializing"}
      walletAddress={walletAddress}
    >
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
  const [portfolioState, setPortfolioState] = useState<{ walletAddress: string; portfolio: DevnetPortfolio } | null>(null);

  const refreshPortfolio = useCallback(async () => {
    if (!loggedInAddress) return;
    try {
      const response = await fetch(`/api/devnet/portfolio?wallet=${encodeURIComponent(loggedInAddress)}`, { cache: "no-store" });
      if (!response.ok) return;
      const value = await response.json() as DevnetPortfolio;
      if (Array.isArray(value.positions)
        && Array.isArray(value.holdings)
        && Array.isArray(value.activity)
        && Array.isArray(value.history)
        && value.wallet?.address === loggedInAddress) {
        setPortfolioState({ walletAddress: loggedInAddress, portfolio: value });
      }
    } catch {
      // Retain the last confirmed portfolio during transient RPC failures.
    }
  }, [loggedInAddress]);

  const refresh = refreshPortfolio;

  useEffect(() => {
    if (!loggedInAddress) {
      return;
    }
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPortfolio();
    }, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshPortfolio();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loggedInAddress, refresh, refreshPortfolio]);

  const portfolio = portfolioState?.walletAddress === loggedInAddress
    ? portfolioState.portfolio
    : null;
  const onchain = useMemo<DevnetBalance | null>(() => portfolio ? {
    usd: portfolio.cashUsd,
    assetUnits: portfolio.holdings
      .filter((holding) => holding.kind === "asset")
      .reduce((total, holding) => total + holding.balance, 0),
  } : null, [portfolio]);
  const value = useMemo<DevnetState>(() => ({
    walletAddress: loggedInAddress,
    usdMint: status?.usdMint ?? null,
    assetMint: status?.assetMint ?? null,
    vaultUsdyMint: status?.vaultUsdyMint ?? null,
    vaultKzgbMint: status?.vaultKzgbMint ?? null,
    treasury: status?.treasury ?? null,
    treasuryOwner: status?.treasuryOwner ?? null,
    onchain,
    portfolio,
    refresh,
    refreshPortfolio,
  }), [loggedInAddress, onchain, portfolio, refresh, refreshPortfolio, status?.assetMint, status?.treasury, status?.treasuryOwner, status?.usdMint, status?.vaultKzgbMint, status?.vaultUsdyMint]);

  return <DevnetContext.Provider value={value}>{children}</DevnetContext.Provider>;
}
