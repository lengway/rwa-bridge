import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const connection = new Connection(process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"), "confirmed");
const user = Keypair.generate();

async function request(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${path}: ${data?.error ?? response.statusText}`);
  return data;
}

async function post(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const status = await request("/api/devnet/status");
if (!status.configured || !status.usdMint || !status.treasury || !status.assetMint) {
  throw new Error("The app has not been configured for Solana devnet.");
}

const faucet = await post("/api/devnet/faucet", { walletAddress: user.publicKey.toBase58(), amountUsd: 100 });
const usdMint = new PublicKey(status.usdMint);
const treasury = new PublicKey(status.treasury);
const userUsdAta = await getAssociatedTokenAddress(usdMint, user.publicKey, true);

let usdBalance = 0;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    usdBalance = Number((await connection.getTokenAccountBalance(userUsdAta, "confirmed")).value.uiAmount ?? 0);
  } catch {
    usdBalance = 0;
  }
  if (usdBalance >= 100) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (usdBalance < 100) throw new Error("Faucet balance did not appear within 60 seconds.");

async function sendToTreasury(amountUsd) {
  const transaction = new Transaction().add(createTransferInstruction(
    userUsdAta,
    treasury,
    user.publicKey,
    BigInt(Math.round(amountUsd * 1_000_000)),
  ));
  return sendAndConfirmTransaction(connection, transaction, [user], { commitment: "confirmed" });
}

const investPayment = await sendToTreasury(40);
const investment = await post("/api/devnet/invest", {
  walletAddress: user.publicKey.toBase58(),
  productId: "ondo-usdy",
  amountUsd: 40,
  signature: investPayment,
});
const withdrawal = await post("/api/devnet/withdraw", {
  walletAddress: user.publicKey.toBase58(),
  productId: "ondo-usdy",
  principalUsd: 40,
  earnedUsd: 1,
});

const buyPayment = await sendToTreasury(10);
const purchase = await post("/api/devnet/buy-asset", {
  walletAddress: user.publicKey.toBase58(),
  assetId: "demo-office",
  amountUsd: 10,
  signature: buyPayment,
});
const balance = await request(`/api/devnet/balance?wallet=${encodeURIComponent(user.publicKey.toBase58())}`);

console.log(JSON.stringify({
  wallet: user.publicKey.toBase58(),
  usd: balance.usd,
  assetUnits: balance.assetUnits,
  explorerUrls: {
    faucet: faucet.explorerUrl,
    invest: investment.explorerUrl,
    withdraw: withdrawal.explorerUrl,
    buyPayment: `https://explorer.solana.com/tx/${buyPayment}?cluster=devnet`,
    buyAssetMint: purchase.explorerUrl,
  },
}, null, 2));
