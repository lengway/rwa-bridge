import "server-only";

import { getVerifiedSessionFromRequest } from "@/lib/auth-server";
import { getEmailWalletAddress } from "@/lib/devnet-ledger";
import { isValidWalletAddress } from "@/lib/devnet-route";

export async function getSessionWallet(request: Request) {
  const session = await getVerifiedSessionFromRequest(request);
  if (!session) return null;
  if (session.smoke) {
    return isValidWalletAddress(session.walletAddress)
      ? { email: session.email, walletAddress: session.walletAddress }
      : null;
  }
  const walletAddress = await getEmailWalletAddress(session.email);
  return walletAddress ? { email: session.email, walletAddress } : null;
}
