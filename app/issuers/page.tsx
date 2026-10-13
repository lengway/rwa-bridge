import type { Metadata } from "next";
import { Suspense } from "react";
import { ConsoleSkeleton, IssuerConsole } from "@/components/markets/issuer-console";
import { MarketsFootnote } from "@/components/markets/footnote";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";

export const metadata: Metadata = {
  title: "Plain Markets for issuers",
  description:
    "Run coupons, redemptions and bondholder votes for tokenized bonds on Solana: record-date lock, Merkle snapshot, funded paying vault and verifiable payments.",
  alternates: { canonical: "/issuers" },
};

export default function IssuersPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Suspense fallback={<ConsoleSkeleton />}>
          <IssuerConsole />
        </Suspense>
        <MarketsFootnote />
      </main>
      <SiteFooter />
    </>
  );
}
