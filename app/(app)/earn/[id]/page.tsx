import { notFound, redirect } from "next/navigation";
import { EarnDetail } from "@/components/app/earn-screens";
import { ALL_YIELD_STRATEGIES } from "@/lib/yields";

export function generateStaticParams() {
  return ALL_YIELD_STRATEGIES.flatMap(({ id, slug }) => [...new Set([id, slug])].map((value) => ({ id: value })));
}

export default async function EarnDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string | string[] }>;
}) {
  const { id } = await params;
  const strategy = ALL_YIELD_STRATEGIES.find((item) => item.id === id || item.slug === id);
  if (!strategy) notFound();
  const query = await searchParams;
  const initialAction = query.action === "withdraw" ? "withdraw" : query.action === "deposit" ? "deposit" : undefined;
  if (id !== strategy.slug) redirect(`/earn/${strategy.slug}${initialAction ? `?action=${initialAction}` : ""}`);
  return <EarnDetail key={`${strategy.id}:${initialAction ?? "default"}`} strategy={strategy} initialAction={initialAction} />;
}
