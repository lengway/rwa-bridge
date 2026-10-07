import { notFound, redirect } from "next/navigation";
import { AssetDetailScreen } from "@/components/app/asset-detail-screen";
import { DEMO_ASSETS } from "@/lib/assets";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (id === "aifc-mock-iconic-tower") redirect("/assets/demo-office");
  const asset = DEMO_ASSETS.find((item) => item.id === id);
  if (!asset) notFound();
  return <AssetDetailScreen asset={asset} />;
}
