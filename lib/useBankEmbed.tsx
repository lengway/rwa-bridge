"use client";

import { createContext, Suspense, useContext, useEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

const BANK_EMBED_STORAGE_KEY = "rwa-bridge-embed-bank";
const BankEmbedContext = createContext(false);

function BankEmbedRuntime({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("embed") === "bank";

  const enabled = useSyncExternalStore(
    subscribeToSessionStorage,
    () => requested || (window.self !== window.top && isBankEmbedPersisted()),
    () => false,
  );

  useEffect(() => {
    if (!requested) return;
    try {
      window.sessionStorage.setItem(BANK_EMBED_STORAGE_KEY, "1");
    } catch {
      // The URL flag still enables the bank flow when storage is unavailable.
    }
  }, [requested]);

  return <BankEmbedContext.Provider value={enabled}>{children}</BankEmbedContext.Provider>;
}

function isBankEmbedPersisted() {
  try {
    return window.sessionStorage.getItem(BANK_EMBED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeToSessionStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

export function BankEmbedProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<BankEmbedContext.Provider value={false}>{children}</BankEmbedContext.Provider>}>
      <BankEmbedRuntime>{children}</BankEmbedRuntime>
    </Suspense>
  );
}

export function useBankEmbed() {
  return useContext(BankEmbedContext);
}
