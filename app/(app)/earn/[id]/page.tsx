import { notFound } from "next/navigation";
import { EarnDetail } from "@/components/app/earn-screens";
import { YIELD_STRATEGIES } from "@/lib/yields";

export function generateStaticParams() {
  return YIELD_STRATEGIES.map(({ id }) => ({ id }));
}

export default async function EarnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const strategy = YIELD_STRATEGIES.find((item) => item.id === id);
  if (!strategy) notFound();
  return <EarnDetail strategy={strategy} />;
}
