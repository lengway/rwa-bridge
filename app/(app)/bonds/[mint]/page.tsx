import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BondDetailScreen } from "@/components/app/bonds/bond-detail-screen";

export const metadata: Metadata = { title: "Bond" };

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default async function BondPage({ params }: PageProps<"/bonds/[mint]">) {
  const { mint } = await params;
  if (!ADDRESS.test(mint)) notFound();
  return <BondDetailScreen key={mint} mint={mint} />;
}
