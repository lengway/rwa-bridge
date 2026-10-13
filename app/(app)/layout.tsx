import type { Metadata } from "next";
import { AppProviders } from "@/components/app-providers";
import { AppShell } from "@/components/app/shell";
import { noIndexMetadata } from "@/lib/noindex";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: { default: "App", template: "%s · Plain" },
  description: "Your Plain account: balances, Kamino Lend positions and activity.",
};

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppProviders><AppShell>{children}</AppShell></AppProviders>;
}
