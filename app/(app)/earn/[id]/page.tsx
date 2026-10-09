import { notFound, redirect } from "next/navigation";
import { EarnDetail } from "@/components/app/earn-screens";
import { YIELD_STRATEGIES } from "@/lib/yields";

export function generateStaticParams() {
  return YIELD_STRATEGIES.flatMap(({ id, slug }) => [...new Set([id, slug])].map((value) => ({ id: value })));
}

export default async function EarnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const strategy = YIELD_STRATEGIES.find((item) => item.id === id || item.slug === id);
  if (!strategy) notFound();
  if (id !== strategy.slug) redirect(`/earn/${strategy.slug}`);
  return <EarnDetail strategy={strategy} />;
}
