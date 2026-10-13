import type { Metadata } from "next";
import { AppProviders } from "@/components/app-providers";
import { noIndexMetadata } from "@/lib/noindex";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: "Plain widget",
};

export default function Layout({ children }: LayoutProps<"/widget">) {
  return <AppProviders>{children}</AppProviders>;
}
