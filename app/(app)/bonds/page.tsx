import type { Metadata } from "next";
import { BondsScreen } from "@/components/app/bonds/bonds-screen";

export const metadata: Metadata = { title: "Bonds" };

export default function BondsPage() {
  return <BondsScreen />;
}
