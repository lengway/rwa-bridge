import type { Metadata } from "next";
import { AppProviders } from "@/components/app-providers";
import { noIndexMetadata } from "@/lib/noindex";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: "Embedded Earn in a partner bank",
};

export default function Layout({ children }: LayoutProps<"/widget-demo">) {
  return <AppProviders>{children}</AppProviders>;
}
