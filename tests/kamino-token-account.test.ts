import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { kaminoWalletTokenAccount } from "../lib/kamino-token-account";

const mint = new PublicKey("So11111111111111111111111111111111111111112");
test("embedded PDA wallets can own canonical SPL token accounts", () => {
  const [owner] = PublicKey.findProgramAddressSync([Buffer.from("embedded-wallet-fixture")], TOKEN_PROGRAM_ID);
  assert.equal(PublicKey.isOnCurve(owner.toBytes()), false);
  assert.throws(() => getAssociatedTokenAddressSync(mint, owner, false));
  assert.equal(kaminoWalletTokenAccount(mint, owner).toBase58(), getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID).toBase58());
});

test("ordinary wallet ATA derivation remains unchanged", () => {
  const owner = new PublicKey("11111111111111111111111111111111");
  assert.equal(PublicKey.isOnCurve(owner.toBytes()), true);
  assert.equal(kaminoWalletTokenAccount(mint, owner).toBase58(), getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID).toBase58());
});
