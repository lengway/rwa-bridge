// One-off: creates the ICT-DEMO SPL mint on Solana devnet and prints the env lines to add.
// Usage: node scripts/setup-demo-token.mjs  (rerun after funding if the airdrop fails)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";

const KEY_FILE = ".demo-authority.json"; // gitignored via .demo-*

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const authority = existsSync(KEY_FILE)
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_FILE, "utf8"))))
  : Keypair.generate();
if (!existsSync(KEY_FILE)) writeFileSync(KEY_FILE, JSON.stringify(Array.from(authority.secretKey)));

console.log(`Mint authority: ${authority.publicKey.toBase58()}`);

const balance = await connection.getBalance(authority.publicKey);
if (balance < 0.05 * LAMPORTS_PER_SOL) {
  console.log("Requesting 1 devnet SOL for fees...");
  try {
    const sig = await connection.requestAirdrop(authority.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  } catch (err) {
    console.error(`Airdrop failed (${err.message}).`);
    console.error("Fund the authority above with devnet SOL at https://faucet.solana.com, then rerun this script.");
    process.exit(1);
  }
}

// 6 decimals so a share can be split; 1 token = $1 of the demo asset.
const mint = await createMint(connection, authority, authority.publicKey, null, 6);

console.log("\nAdd to .env.local:\n");
console.log(`DEMO_TOKEN_MINT=${mint.toBase58()}`);
console.log(`DEMO_TOKEN_AUTHORITY_SECRET=${JSON.stringify(Array.from(authority.secretKey))}`);
