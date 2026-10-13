import type { Metadata } from "next";
import { connection } from "next/server";
import { ActionVerifier } from "@/components/markets/verifier";
import { MarketsFootnote } from "@/components/markets/footnote";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { marketsPublicConfig } from "@/lib/markets/server";

export async function generateMetadata({ params }: PageProps<"/verify/[actionId]">): Promise<Metadata> {
  const { actionId } = await params;
  return {
    title: "Verify a corporate action",
    description: "Re-derive a Plain Markets corporate action in your browser: rebuild the register Merkle root, recompute every entitlement and compare with on-chain values.",
    alternates: { canonical: `/verify/${actionId}` },
  };
}

export default async function VerifyPage({ params }: PageProps<"/verify/[actionId]">) {
  const { actionId } = await params;
  await connection();
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <ActionVerifier actionId={actionId} config={marketsPublicConfig()} />
        <MarketsFootnote />
      </main>
      <SiteFooter />
    </>
  );
}
