import { notFound, redirect } from "next/navigation";
import { AssetDetailScreen } from "@/components/app/asset-detail-screen";
import { BRIDGE_ASSETS } from "@/lib/assets";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "aifc-mock-iconic-tower") redirect("/assets/office-building");
  const asset = BRIDGE_ASSETS.find((item) => item.id === id || item.slug === id);
  if (!asset) notFound();
  if (id !== asset.slug) redirect(`/assets/${asset.slug}`);
  return <AssetDetailScreen asset={asset} />;
}
