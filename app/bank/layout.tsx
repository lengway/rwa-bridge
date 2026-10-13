import type { Metadata } from "next";
import { AppProviders } from "@/components/app-providers";
import { noIndexMetadata } from "@/lib/noindex";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: "Partner bank embed",
};

export default function Layout({ children }: LayoutProps<"/bank">) {
  return <AppProviders>{children}</AppProviders>;
}
