import { FundingScreen } from "@/components/app/funding-screen";
import { fundingMethods } from "@/lib/funding-contract";
export const dynamic = "force-dynamic";
export default function FundingPage() {
  return <FundingScreen initialMethods={fundingMethods(process.env)} />;
}
