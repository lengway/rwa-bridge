import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** Embedded smart wallets may be PDAs. ATA ownership does not require an
 * Ed25519 public key; authorization remains the session and wallet's job. */
export function kaminoWalletTokenAccount(mint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);
}
