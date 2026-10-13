import type { Metadata } from "next";
import { KaseConsole } from "@/components/kase/kase-console";
import { noIndexMetadata } from "@/lib/noindex";

export const metadata: Metadata = {
  ...noIndexMetadata,
  title: "Corporate actions on Solana",
  description: "Tokenized bond prototype: holder registry, record date, coupon, partial buyback and redemption on Solana devnet.",
};

export default function KasePage() {
  return <KaseConsole />;
}
