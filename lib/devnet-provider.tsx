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
    const loadStatus = async () => {
      try {
        const response = await fetch("/api/devnet/status", { cache: "no-store" });
        if (!response.ok) throw new Error("status unavailable");
        const value = await response.json() as DevnetStatus;
        if (!cancelled) setStatus(value);
      } catch {
        if (!cancelled) setStatus((current) => current ?? {
          configured: false,
          legacyFaucetEnabled: false,
          usdMint: null,
          assetMint: null,
          vaultUsdyMint: null,
          vaultKzgbMint: null,
          kzteMint: null,
          kzteReserve: null,
          kzteSupply: null,
          treasury: null,
          treasuryOwner: null,
        });
      }
    };
    void loadStatus();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadStatus();
    }, 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadStatus();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
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
  // AuthProvider exposes the wallet only after /api/me/session acknowledges
  // its binding. Do not race portfolio/Earn requests with an unobserved POST.
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
  const [portfolioFailure, setPortfolioFailure] = useState<{ walletAddress: string; error: string } | null>(null);

  const refreshPortfolio = useCallback(async () => {
    if (!loggedInAddress) return;
    try {
      const response = await fetch(`/api/devnet/portfolio?wallet=${encodeURIComponent(loggedInAddress)}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
      if (!response.ok) throw new Error("Could not load the Devnet portfolio. The latest data may be stale; do not treat an unavailable balance as zero.");
      const value = await response.json() as DevnetPortfolio;
      if (Array.isArray(value.positions)
        && Array.isArray(value.holdings)
        && Array.isArray(value.activity)
        && Array.isArray(value.history)
        && value.wallet?.address === loggedInAddress) {
        setPortfolioState({ walletAddress: loggedInAddress, portfolio: value });
        setPortfolioFailure(null);
      } else {
        throw new Error("Incomplete portfolio data received. Refresh and try again.");
      }
    } catch (cause) {
      // Retain the last confirmed portfolio during transient RPC failures.
      setPortfolioFailure({ walletAddress: loggedInAddress, error: cause instanceof Error && cause.message.startsWith("Could not")
        ? cause.message : "The portfolio is temporarily unavailable. Check your connection and refresh." });
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
  const portfolioError = portfolioFailure?.walletAddress === loggedInAddress ? portfolioFailure.error : null;
  const onchain = useMemo<DevnetBalance | null>(() => portfolio ? {
    usd: portfolio.cashUsd,
    assetUnits: portfolio.holdings
      .filter((holding) => holding.kind === "asset")
      .reduce((total, holding) => total + holding.balance, 0),
  } : null, [portfolio]);
  const value = useMemo<DevnetState>(() => ({
    walletAddress: loggedInAddress,
    legacyFaucetEnabled: status?.legacyFaucetEnabled === true,
    usdMint: status?.usdMint ?? null,
    assetMint: status?.assetMint ?? null,
    vaultUsdyMint: status?.vaultUsdyMint ?? null,
    vaultKzgbMint: status?.vaultKzgbMint ?? null,
    kzteMint: status?.kzteMint ?? null,
    kzteReserve: status?.kzteReserve ?? null,
    kzteSupply: status?.kzteSupply ?? null,
    treasury: status?.treasury ?? null,
    treasuryOwner: status?.treasuryOwner ?? null,
    onchain,
    portfolio,
    portfolioError,
    refresh,
    refreshPortfolio,
  }), [loggedInAddress, onchain, portfolio, portfolioError, refresh, refreshPortfolio, status?.assetMint, status?.kzteMint, status?.kzteReserve, status?.kzteSupply, status?.legacyFaucetEnabled, status?.treasury, status?.treasuryOwner, status?.usdMint, status?.vaultKzgbMint, status?.vaultUsdyMint]);

  return <DevnetContext.Provider value={value}>{children}</DevnetContext.Provider>;
}
