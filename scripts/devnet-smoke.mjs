import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
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

function sessionSecretFromDotEnv() {
  let contents = "";
  try {
    contents = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    // The orchestrator may provide the secret directly in the process environment.
  }
  const line = contents.split(/\r?\n/).find((entry) => /^\s*(?:export\s+)?AUTH_SESSION_SECRET\s*=/.test(entry));
  if (!line) return "";
  let value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
    if (line.includes('"')) value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }
  return value;
}

function createSmokeSessionCookie(walletAddress) {
  // This local-only script signs the same payload.HMAC cookie used by auth-server.ts.
  // The server honors walletAddress only when this HMAC-signed payload has smoke: true.
  const secret = process.env.AUTH_SESSION_SECRET?.trim() || sessionSecretFromDotEnv().trim();
  if (!secret) throw new Error("Set AUTH_SESSION_SECRET in .env.local or the environment to run the devnet smoke script.");
  const now = Math.floor(Date.now() / 1_000);
  const payload = Buffer.from(JSON.stringify({
    email: "devnet-smoke@example.com",
    iat: now,
    exp: now + 60 * 60,
    walletAddress,
    smoke: true,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

const smokeSessionCookie = createSmokeSessionCookie(user.publicKey.toBase58());

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
if (!status.configured || !status.usdMint || !status.treasury || !status.treasuryOwner || !status.assetMint || !status.kzteMint) {
  throw new Error("The app has not been configured for Solana devnet.");
}
async function postAuthenticated(path, body) {
  return request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "rwa_bridge_session=" + smokeSessionCookie,
    },
    body: JSON.stringify(body),
  });
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
if (!status.vaultUsdyMint || !investment.sharesMinted) {
  throw new Error("The USDY vault share mint is not configured or no shares were issued.");
}
const vaultMint = new PublicKey(status.vaultUsdyMint);
const treasuryVaultAta = await getAssociatedTokenAddress(vaultMint, new PublicKey(status.treasuryOwner), true);
const userVaultAta = await getAssociatedTokenAddress(vaultMint, user.publicKey, true);
let shareBalance = 0;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    shareBalance = Number((await connection.getTokenAccountBalance(userVaultAta, "confirmed")).value.uiAmount ?? 0);
  } catch {
    shareBalance = 0;
  }
  if (shareBalance >= investment.sharesMinted) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (shareBalance < investment.sharesMinted) throw new Error("Vault share balance did not appear within 60 seconds.");
const sharesToRedeem = investment.sharesMinted;
const redemptionTransfer = new Transaction().add(createTransferInstruction(
  userVaultAta,
  treasuryVaultAta,
  user.publicKey,
  BigInt(Math.round(sharesToRedeem * 1_000_000)),
));
const redemptionSignature = await sendAndConfirmTransaction(connection, redemptionTransfer, [user], { commitment: "confirmed" });
const withdrawal = await post("/api/devnet/withdraw", {
  walletAddress: user.publicKey.toBase58(),
  productId: "ondo-usdy",
  signature: redemptionSignature,
  shares: sharesToRedeem,
});

const buyPayment = await sendToTreasury(10);
const purchase = await post("/api/devnet/buy-asset", {
  walletAddress: user.publicKey.toBase58(),
  assetId: "demo-office",
  amountUsd: 10,
  signature: buyPayment,
});

const kzteMint = new PublicKey(status.kzteMint);
const userKzteAta = await getAssociatedTokenAddress(kzteMint, user.publicKey, true);
const treasuryKzteAta = await getAssociatedTokenAddress(kzteMint, new PublicKey(status.treasuryOwner), true);
const kzteTopup = await postAuthenticated("/api/devnet/kzte/mint", { amountKzt: 12_000 });
let kzteBalance = 0;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    kzteBalance = Number((await connection.getTokenAccountBalance(userKzteAta, "confirmed")).value.uiAmount ?? 0);
  } catch {
    kzteBalance = 0;
  }
  if (kzteBalance >= 12_000) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (kzteBalance < 12_000) throw new Error("KZTE balance did not appear within 60 seconds.");

const exchangeTransfer = new Transaction().add(createTransferInstruction(
  userKzteAta,
  treasuryKzteAta,
  user.publicKey,
  BigInt(4_000 * 1_000_000),
));
const exchangeSignature = await sendAndConfirmTransaction(connection, exchangeTransfer, [user], { commitment: "confirmed" });
const exchange = await postAuthenticated("/api/devnet/exchange", {
  signature: exchangeSignature,
  from: user.publicKey.toBase58(),
  amount: 4_000,
});

const redemptionTransferKzte = new Transaction().add(createTransferInstruction(
  userKzteAta,
  treasuryKzteAta,
  user.publicKey,
  BigInt(3_000 * 1_000_000),
));
const redemptionSignatureKzte = await sendAndConfirmTransaction(connection, redemptionTransferKzte, [user], { commitment: "confirmed" });
const kzteRedemption = await postAuthenticated("/api/devnet/kzte/redeem", { signature: redemptionSignatureKzte });
const balance = await request(`/api/devnet/balance?wallet=${encodeURIComponent(user.publicKey.toBase58())}`);

console.log(JSON.stringify({
  wallet: user.publicKey.toBase58(),
  usd: balance.usd,
  assetUnits: balance.assetUnits,
  kzte: kzteBalance,
  kzteReceived: kzteTopup.amountKzt,
  exchangeUsd: exchange.amountUsd,
  kzteRedeemed: kzteRedemption.amountKzt,
  sharesMinted: investment.sharesMinted,
  sharesRedeemed: withdrawal.sharesRedeemed,
  amountReturnedUsd: withdrawal.amountUsd,
  explorerUrls: {
    faucet: faucet.explorerUrl,
    invest: investment.explorerUrl,
    withdraw: withdrawal.explorerUrl,
    redeemShares: `https://explorer.solana.com/tx/${redemptionSignature}?cluster=devnet`,
    buyPayment: `https://explorer.solana.com/tx/${buyPayment}?cluster=devnet`,
    buyAssetMint: purchase.explorerUrl,
    kzteReserveTransfer: kzteTopup.explorerUrl,
    kzteExchangeTransfer: "https://explorer.solana.com/tx/" + exchangeSignature + "?cluster=devnet",
    kzteExchangeCredit: exchange.targetExplorerUrl,
    kzteRedemptionTransfer: "https://explorer.solana.com/tx/" + redemptionSignatureKzte + "?cluster=devnet",
  },
}, null, 2));
