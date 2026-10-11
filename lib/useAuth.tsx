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
  walletError: string | null;
  retryWallet: () => void;
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
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletAttempt, setWalletAttempt] = useState(0);
  const retryWallet = useCallback(() => {
    setWalletError(null);
    setWalletAttempt((attempt) => attempt + 1);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (response.status === 401) {
        setStatus("signed-out");
        setEmail(null);
        setJwt(null);
        setWallet(null);
        setWalletError(null);
        return false;
      }
      const result = await response.json() as { email?: unknown; jwt?: unknown };
      if (!response.ok || typeof result.email !== "string" || typeof result.jwt !== "string") {
        throw new Error("Could not load the session.");
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
      if (!response.ok) requestError = new Error("Could not end the server session.");
    } catch {
      requestError = new Error("Could not end the server session.");
    } finally {
      setJwt(null);
      setEmail(null);
      setWallet(null);
      setWalletError(null);
      setStatus("signed-out");
    }
    if (requestError) throw requestError;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    email,
    walletAddress: wallet?.address ?? null,
    wallet,
    walletError,
    retryWallet,
    signOut,
    refreshSession,
  }), [email, refreshSession, retryWallet, signOut, status, wallet, walletError]);

  return (
    <AuthContext.Provider value={value}>
      {crossmintEnabled
        ? <CrossmintWalletBridge jwt={jwt} email={email} attempt={walletAttempt} onWallet={setWallet} onError={setWalletError}>{children}</CrossmintWalletBridge>
        : children}
    </AuthContext.Provider>
  );
}

function CrossmintWalletBridge({
  jwt,
  email,
  attempt,
  onWallet,
  onError,
  children,
}: {
  jwt: string | null;
  email: string | null;
  attempt: number;
  onWallet: (wallet: Wallet<Chain> | null) => void;
  onError: (error: string | null) => void;
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
    const timeout = window.setTimeout(() => {
      cancelled = true;
      onError("The wallet did not respond in time. Try connecting again; no transaction was submitted.");
    }, 30_000);
    async function acceptWallet(loaded: Wallet<Chain>) {
      if (cancelled) return;
      // Do not expose a usable wallet before the server has acknowledged its
      // session binding; all Earn APIs depend on that durable association.
      const response = await fetch("/api/me/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: loaded.address }),
        signal: AbortSignal.timeout(15_000),
      });
      const result = await response.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
      if (!response.ok || result?.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "Could not link the wallet to the session. Try connecting again.");
      }
      if (!cancelled) {
        onError(null);
        onWallet(loaded);
      }
    }
    async function loadWallet() {
      try {
        const wallets = CrossmintWallets.from(crossmint);
        // The raw SDK call preserves WalletNotAvailableError; useWallet maps errors into UI state.
        await wallets.getWallet({ chain: walletChain });
        if (cancelled) return;
        const existing = await getWalletRef.current({ chain: walletChain });
        if (!existing) throw new Error("Could not load the wallet.");
        await acceptWallet(existing);
      } catch (error) {
        if (cancelled) return;
        if (!(error instanceof WalletNotAvailableError)) {
          onError(error instanceof Error && error.message.startsWith("Could not")
            ? error.message : "Could not connect the wallet. Check your connection and try again.");
          return;
        }
        try {
          const created = await createWalletRef.current({
            chain: walletChain,
            recoveryMethods: [{ type: "email", email: recoveryEmail }],
          });
          if (!created) throw new Error("Could not create the wallet.");
          await acceptWallet(created);
        } catch {
          if (!cancelled) onError("Could not create or connect the wallet. Try again.");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadWallet();
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [attempt, crossmint, email, jwt, onError, onWallet, setJwt]);

  return children;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used within AuthProvider");
  return auth;
}
