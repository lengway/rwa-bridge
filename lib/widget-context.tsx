"use client";

import { createContext, useContext } from "react";

export type WidgetSession = {
  token: string;
  partnerId: "demo-bank";
  parentOrigin: string;
  mode: "SANDBOX";
  mockCountry: "KZ";
  mockAdult: true;
  expiresAt: number;
};

const WidgetSessionContext = createContext<WidgetSession | null>(null);

export function WidgetSessionProvider({
  session,
  children,
}: {
  session: WidgetSession | null;
  children: React.ReactNode;
}) {
  return <WidgetSessionContext.Provider value={session}>{children}</WidgetSessionContext.Provider>;
}

export function useWidgetSession() {
  return { session: useContext(WidgetSessionContext) };
}
