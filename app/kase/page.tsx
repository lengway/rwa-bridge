import type { Metadata } from "next";
import { KaseConsole } from "@/components/kase/kase-console";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";

export const metadata: Metadata = {
  title: "For issuers",
  description:
    "Plain for Issuers: run a tokenized bond through issuance, record date, coupon, buyback and redemption on Solana devnet.",
  alternates: { canonical: "/kase" },
};

export default function KasePage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <KaseConsole />
      </main>
      <SiteFooter />
    </>
  );
}
