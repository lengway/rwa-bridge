"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useCrossmint, useWallet } from "@crossmint/client-sdk-react-ui";
import { CrossmintWallets, WalletNotAvailableError } from "@crossmint/wallets-sdk";
import type { Chain, Wallet } from "@crossmint/wallets-sdk";
import { walletChain } from "@/lib/config";

export type AuthStatus = "loading" | "signed-out" | "signed-in";

type AuthContextValue = {
  status: AuthStatus;
  email: string | null;
  walletAddress: string | null;
  wallet: Wallet<Chain> | null;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  crossmintEnabled,
}: {
  children: React.ReactNode;
  crossmintEnabled: boolean;
}) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet<Chain> | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (response.status === 401) {
        setStatus("signed-out");
        setEmail(null);
        setJwt(null);
        setWallet(null);
        return false;
      }
      const result = await response.json() as { email?: unknown; jwt?: unknown };
      if (!response.ok || typeof result.email !== "string" || typeof result.jwt !== "string") {
        throw new Error("Не удалось загрузить сессию.");
      }
      setEmail(result.email);
      setJwt(result.jwt);
      setStatus("signed-in");
      return true;
    } catch {
      setStatus((current) => current === "loading" ? "signed-out" : current);
      return false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSession(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshSession]);

  useEffect(() => {
    if (status !== "signed-in" || !jwt) return;
    const parts = jwt.split(".");
    let expiresAt = 0;
    try {
      const claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
      if (typeof claims.exp === "number") expiresAt = claims.exp * 1_000;
    } catch {
      expiresAt = 0;
    }
    const refreshIn = expiresAt ? Math.max(5_000, expiresAt - Date.now() - 60_000) : 50 * 60_000;
    let cancelled = false;
    let retryTimer: number | undefined;
    const attemptRefresh = async () => {
      const refreshed = await refreshSession();
      if (!refreshed && !cancelled) retryTimer = window.setTimeout(() => void attemptRefresh(), 30_000);
    };
    const timer = window.setTimeout(() => void attemptRefresh(), refreshIn);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [jwt, refreshSession, status]);

  const signOut = useCallback(async () => {
    let requestError: Error | null = null;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) requestError = new Error("Не удалось завершить сессию на сервере.");
    } catch {
      requestError = new Error("Не удалось завершить сессию на сервере.");
    } finally {
      setJwt(null);
      setEmail(null);
      setWallet(null);
      setStatus("signed-out");
    }
    if (requestError) throw requestError;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    email,
    walletAddress: wallet?.address ?? null,
    wallet,
    signOut,
    refreshSession,
  }), [email, refreshSession, signOut, status, wallet]);

  return (
    <AuthContext.Provider value={value}>
      {crossmintEnabled
        ? <CrossmintWalletBridge jwt={jwt} email={email} onWallet={setWallet}>{children}</CrossmintWalletBridge>
        : children}
    </AuthContext.Provider>
  );
}

function CrossmintWalletBridge({
  jwt,
  email,
  onWallet,
  children,
}: {
  jwt: string | null;
  email: string | null;
  onWallet: (wallet: Wallet<Chain> | null) => void;
  children: React.ReactNode;
}) {
  const { crossmint, setJwt } = useCrossmint();
  const walletContext = useWallet();
  const getWalletRef = useRef(walletContext.getWallet);
  const createWalletRef = useRef(walletContext.createWallet);

  useEffect(() => {
    getWalletRef.current = walletContext.getWallet;
    createWalletRef.current = walletContext.createWallet;
  }, [walletContext.createWallet, walletContext.getWallet]);

  useEffect(() => {
    setJwt(jwt ?? undefined);
    if (!jwt || !email) {
      onWallet(null);
      return;
    }

    const recoveryEmail = email;
    let cancelled = false;
    async function loadWallet() {
      const wallets = CrossmintWallets.from(crossmint);
      try {
        // The raw SDK call preserves WalletNotAvailableError; useWallet maps errors into UI state.
        await wallets.getWallet({ chain: walletChain });
        const existing = await getWalletRef.current({ chain: walletChain });
        if (!existing) throw new Error("Не удалось загрузить кошелёк.");
        if (!cancelled) onWallet(existing);
      } catch (error) {
        if (!(error instanceof WalletNotAvailableError)) {
          console.error("RWA Bridge: wallet could not be loaded.");
          return;
        }
        try {
          const created = await createWalletRef.current({
            chain: walletChain,
            recoveryMethods: [{ type: "email", email: recoveryEmail }],
          });
          if (!created) throw new Error("Не удалось создать кошелёк.");
          if (!cancelled) onWallet(created);
        } catch {
          console.error("RWA Bridge: wallet could not be created.");
        }
      }
    }

    void loadWallet();
    return () => { cancelled = true; };
  }, [crossmint, email, jwt, onWallet, setJwt]);

  return children;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within AuthProvider");
  return auth;
}
