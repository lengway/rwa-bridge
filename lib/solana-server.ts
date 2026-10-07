import "server-only";

import {
  clusterApiUrl,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
} from "@solana/spl-token";

const TOKEN_DECIMALS = 6;
const TOKEN_SCALE = 10 ** TOKEN_DECIMALS;

function decodeBase58(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(0);
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid authority secret");
    number = number * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > BigInt(0)) {
    bytes.unshift(Number(number & BigInt(255)));
    number >>= BigInt(8);
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function readAuthority() {
  const secret = process.env.DEMO_TOKEN_AUTHORITY_SECRET;
  if (!secret) return null;
  try {
    const secretBytes = secret.trim().startsWith("[")
      ? Uint8Array.from(JSON.parse(secret) as number[])
      : decodeBase58(secret.trim());
    return Keypair.fromSecretKey(secretBytes);
  } catch {
    return null;
  }
}

const authority = readAuthority();
const usdMintAddress = process.env.DEMO_USD_MINT ?? "";
const assetMintAddress = process.env.DEMO_TOKEN_MINT ?? "";

export const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"),
  "confirmed",
);

export const devnetConfig = {
  get configured() {
    if (!authority || !usdMintAddress || !assetMintAddress) return false;
    try {
      new PublicKey(usdMintAddress);
      new PublicKey(assetMintAddress);
      return true;
    } catch {
      return false;
    }
  },
  usdMint: usdMintAddress,
  assetMint: assetMintAddress,
  authority,
  async treasury(): Promise<string | null> {
    if (!this.configured || !authority) return null;
    const address = await getAssociatedTokenAddress(new PublicKey(usdMintAddress), authority.publicKey, true);
    return address.toBase58();
  },
};

function requiredConfig() {
  if (!authority || !usdMintAddress || !assetMintAddress) {
    throw new Error("Сеть Solana devnet не настроена.");
  }
  return {
    authority,
    usdMint: new PublicKey(usdMintAddress),
    assetMint: new PublicKey(assetMintAddress),
  };
}

function toTokenAmount(amountUi: number) {
  if (!Number.isFinite(amountUi) || amountUi < 0) throw new Error("Некорректная сумма.");
  return BigInt(Math.round((amountUi + Number.EPSILON) * TOKEN_SCALE));
}

export async function mintTestDollars(ownerAddress: string, amountUi: number) {
  const { authority: mintAuthority, usdMint } = requiredConfig();
  const owner = new PublicKey(ownerAddress);
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    usdMint,
    owner,
    true,
  );
  return mintTo(
    connection,
    mintAuthority,
    usdMint,
    tokenAccount.address,
    mintAuthority,
    toTokenAmount(amountUi),
  );
}

export async function mintAsset(ownerAddress: string, units: number) {
  const { authority: mintAuthority, assetMint } = requiredConfig();
  const owner = new PublicKey(ownerAddress);
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    assetMint,
    owner,
    true,
  );
  return mintTo(
    connection,
    mintAuthority,
    assetMint,
    tokenAccount.address,
    mintAuthority,
    toTokenAmount(units),
  );
}

export async function sendFromTreasury(ownerAddress: string, amountUi: number) {
  const { authority: mintAuthority, usdMint } = requiredConfig();
  const destinationOwner = new PublicKey(ownerAddress);
  const treasury = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    usdMint,
    mintAuthority.publicKey,
    true,
  );
  const destination = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    usdMint,
    destinationOwner,
    true,
  );
  const amount = toTokenAmount(amountUi);
  const balance = await getAccount(connection, treasury.address);
  if (balance.amount < amount) {
    await mintTo(
      connection,
      mintAuthority,
      usdMint,
      treasury.address,
      mintAuthority,
      amount - balance.amount,
    );
  }
  return transfer(
    connection,
    mintAuthority,
    treasury.address,
    destination.address,
    mintAuthority,
    amount,
  );
}

export async function ensureFeeSol(ownerAddress: string) {
  const { authority: feePayer } = requiredConfig();
  const owner = new PublicKey(ownerAddress);
  const balance = await connection.getBalance(owner, "confirmed");
  if (balance >= 0.005 * LAMPORTS_PER_SOL) return null;

  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: feePayer.publicKey,
    toPubkey: owner,
    lamports: 0.01 * LAMPORTS_PER_SOL,
  }));
  return sendAndConfirmTransaction(connection, transaction, [feePayer], { commitment: "confirmed" });
}

// Demo replay protection is kept in memory and resets when the server restarts.
const verifiedSignatures = new Set<string>();
const pendingSignatures = new Set<string>();

function balanceForOwner(
  balances: Array<{ owner?: string; mint: string; uiTokenAmount: { amount: string } }> | null | undefined,
  owner: string,
  mint: string,
) {
  return (balances ?? []).reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint) return total;
    return total + BigInt(balance.uiTokenAmount.amount);
  }, BigInt(0));
}

export async function verifyIncomingPayment({
  signature,
  fromOwner,
  minAmountUi,
}: {
  signature: string;
  fromOwner: string;
  minAmountUi: number;
}) {
  const { authority: mintAuthority, usdMint } = requiredConfig();
  if (verifiedSignatures.has(signature) || pendingSignatures.has(signature)) {
    throw new Error("Эта транзакция уже была использована.");
  }
  pendingSignatures.add(signature);
  try {
    const treasuryAta = await getAssociatedTokenAddress(usdMint, mintAuthority.publicKey, true);
    const minimum = toTokenAmount(minAmountUi);
    let transaction = null;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      transaction = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (transaction) break;
      if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (!transaction) throw new Error("Транзакция пока не найдена в Solana devnet.");
    if (transaction.meta?.err) throw new Error("Перевод не прошёл в сети Solana.");

    const accountKeys = transaction.transaction.message.accountKeys;
    const treasuryIndex = accountKeys.findIndex((key) => key.pubkey.toBase58() === treasuryAta.toBase58());
    if (treasuryIndex < 0) throw new Error("В транзакции не найден перевод в казначейство.");
    const treasuryBefore = (transaction.meta?.preTokenBalances ?? [])
      .filter((balance) => balance.accountIndex === treasuryIndex && balance.mint === usdMint.toBase58())
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
    const treasuryAfter = (transaction.meta?.postTokenBalances ?? [])
      .filter((balance) => balance.accountIndex === treasuryIndex && balance.mint === usdMint.toBase58())
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
    const userBefore = balanceForOwner(transaction.meta?.preTokenBalances, fromOwner, usdMint.toBase58());
    const userAfter = balanceForOwner(transaction.meta?.postTokenBalances, fromOwner, usdMint.toBase58());

    if (treasuryAfter - treasuryBefore < minimum || userBefore - userAfter < minimum) {
      throw new Error("В сети не найден перевод нужной суммы от вашего кошелька в казначейство.");
    }
    verifiedSignatures.add(signature);
    return true;
  } finally {
    pendingSignatures.delete(signature);
  }
}

export async function getWalletTokenBalances(ownerAddress: string) {
  const { usdMint, assetMint } = requiredConfig();
  const owner = new PublicKey(ownerAddress);
  const [usdAta, assetAta] = await Promise.all([
    getAssociatedTokenAddress(usdMint, owner, true),
    getAssociatedTokenAddress(assetMint, owner, true),
  ]);
  const [usd, assetUnits] = await Promise.all([
    readTokenAccountBalance(usdAta),
    readTokenAccountBalance(assetAta),
  ]);
  return { usd, assetUnits };
}

async function readTokenAccountBalance(address: PublicKey) {
  const account = await connection.getAccountInfo(address, "confirmed");
  if (!account) return 0;
  const balance = await connection.getTokenAccountBalance(address, "confirmed");
  return Number(balance.value.uiAmount ?? 0);
}

export function explorerUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
