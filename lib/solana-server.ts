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
  getMint,
  getOrCreateAssociatedTokenAccount,
  burn,
  mintTo,
  transfer,
  TOKEN_PROGRAM_ID,
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
const vaultUsdyMintAddress = process.env.DEMO_VAULT_USDY_MINT ?? "";
const vaultKzgbMintAddress = process.env.DEMO_VAULT_KZGB_MINT ?? "";
const kzteMintAddress = process.env.DEMO_KZTE_MINT ?? "";

export const connection = new Connection(
  process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet"),
  "confirmed",
);

export const devnetConfig = {
  get configured() {
    if (!authority || !usdMintAddress || !assetMintAddress || !vaultUsdyMintAddress || !vaultKzgbMintAddress || !kzteMintAddress) return false;
    try {
      new PublicKey(usdMintAddress);
      new PublicKey(assetMintAddress);
      new PublicKey(vaultUsdyMintAddress);
      new PublicKey(vaultKzgbMintAddress);
      new PublicKey(kzteMintAddress);
      return true;
    } catch {
      return false;
    }
  },
  usdMint: usdMintAddress,
  assetMint: assetMintAddress,
  vaultUsdyMint: vaultUsdyMintAddress,
  vaultKzgbMint: vaultKzgbMintAddress,
  kzteMint: kzteMintAddress,
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

export function vaultMintAddress(productId: string) {
  if (productId === "ondo-usdy" && vaultUsdyMintAddress) return new PublicKey(vaultUsdyMintAddress);
  if (productId === "kz-bond-demo" && vaultKzgbMintAddress) return new PublicKey(vaultKzgbMintAddress);
  throw new Error("Неизвестный продукт дохода.");
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

export async function treasuryKzteTokenAccount() {
  const { authority: mintAuthority } = requiredConfig();
  if (!kzteMintAddress) throw new Error("Mint KZTE не настроен.");
  return getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    new PublicKey(kzteMintAddress),
    mintAuthority.publicKey,
    true,
  );
}

export async function sendKzteFromTreasury(ownerAddress: string, amountUi: number) {
  const { authority: mintAuthority } = requiredConfig();
  if (!kzteMintAddress) throw new Error("Mint KZTE не настроен.");
  const mint = new PublicKey(kzteMintAddress);
  const treasury = await treasuryKzteTokenAccount();
  const amount = toTokenAmount(amountUi);
  const balance = await getAccount(connection, treasury.address);
  if (balance.amount < amount) throw new Error("В резерве Intebix недостаточно KZTE");
  const destination = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    new PublicKey(ownerAddress),
    true,
  );
  try {
    return await transfer(connection, mintAuthority, treasury.address, destination.address, mintAuthority, amount);
  } catch (error) {
    const currentBalance = await getAccount(connection, treasury.address).catch(() => null);
    if (currentBalance && currentBalance.amount < amount) {
      throw new Error("В резерве Intebix недостаточно KZTE");
    }
    throw error;
  }
}

export async function getKzteReserveStatus() {
  const { authority: mintAuthority } = requiredConfig();
  if (!kzteMintAddress) throw new Error("Mint KZTE не настроен.");
  const mint = new PublicKey(kzteMintAddress);
  const reserveAddress = await getAssociatedTokenAddress(mint, mintAuthority.publicKey, true);
  const [mintInfo, reserveAccount] = await Promise.all([
    getMint(connection, mint),
    getAccount(connection, reserveAddress),
  ]);
  return {
    kzteReserve: Number(reserveAccount.amount) / TOKEN_SCALE,
    kzteSupply: Number(mintInfo.supply) / TOKEN_SCALE,
  };
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

export async function mintVaultShares(ownerAddress: string, productId: string, shares: number) {
  const { authority: mintAuthority } = requiredConfig();
  const mint = vaultMintAddress(productId);
  const owner = new PublicKey(ownerAddress);
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    owner,
    true,
  );
  return mintTo(
    connection,
    mintAuthority,
    mint,
    tokenAccount.address,
    mintAuthority,
    toTokenAmount(shares),
  );
}

export async function treasuryVaultTokenAccount(productId: string) {
  const { authority: mintAuthority } = requiredConfig();
  const mint = vaultMintAddress(productId);
  return getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    mintAuthority.publicKey,
    true,
  );
}

export async function burnTreasuryVaultShares(productId: string, shares: number) {
  const { authority: mintAuthority } = requiredConfig();
  const mint = vaultMintAddress(productId);
  const treasury = await treasuryVaultTokenAccount(productId);
  return burn(
    connection,
    mintAuthority,
    treasury.address,
    mint,
    mintAuthority,
    toTokenAmount(shares),
  );
}

export async function sendFromTreasury(ownerAddress: string, amountUi: number, mintAddress = usdMintAddress) {
  const { authority: mintAuthority } = requiredConfig();
  const mint = new PublicKey(mintAddress);
  const destinationOwner = new PublicKey(ownerAddress);
  const treasury = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    mintAuthority.publicKey,
    true,
  );
  const destination = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    destinationOwner,
    true,
  );
  const amount = toTokenAmount(amountUi);
  const balance = await getAccount(connection, treasury.address);
  if (balance.amount < amount) {
    await mintTo(
      connection,
      mintAuthority,
      mint,
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

// Concurrent verification is guarded in-process; durable signature replay protection
// lives in the devnet ledger.
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
  mintAddress,
}: {
  signature: string;
  fromOwner: string;
  minAmountUi: number;
  mintAddress?: string;
}) {
  const { authority: mintAuthority, usdMint } = requiredConfig();
  const mint = mintAddress ? new PublicKey(mintAddress) : usdMint;
  if (pendingSignatures.has(signature)) {
    throw new Error("Эта транзакция уже была использована.");
  }
  pendingSignatures.add(signature);
  try {
    const treasuryAta = await getAssociatedTokenAddress(mint, mintAuthority.publicKey, true);
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
      .filter((balance) => balance.accountIndex === treasuryIndex && balance.mint === mint.toBase58())
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
    const treasuryAfter = (transaction.meta?.postTokenBalances ?? [])
      .filter((balance) => balance.accountIndex === treasuryIndex && balance.mint === mint.toBase58())
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
    const userBefore = balanceForOwner(transaction.meta?.preTokenBalances, fromOwner, mint.toBase58());
    const userAfter = balanceForOwner(transaction.meta?.postTokenBalances, fromOwner, mint.toBase58());

    const treasuryIncrease = treasuryAfter - treasuryBefore;
    const userDecrease = userBefore - userAfter;
    if (treasuryIncrease < minimum || userDecrease < minimum) {
      throw new Error("В сети не найден перевод нужной суммы от вашего кошелька в казначейство.");
    }
    const received = treasuryIncrease < userDecrease ? treasuryIncrease : userDecrease;
    return Number(received) / TOKEN_SCALE;
  } finally {
    pendingSignatures.delete(signature);
  }
}

export async function verifyOutgoingWalletTransfer({
  signature,
  fromOwner,
  toOwner,
  minAmountUi,
}: {
  signature: string;
  fromOwner: string;
  toOwner: string;
  minAmountUi: number;
}) {
  const { usdMint } = requiredConfig();
  let transaction = null;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    transaction = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (transaction) break;
    if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (!transaction || !transaction.meta || transaction.meta.err) return null;
  const mint = usdMint.toBase58();
  const fromBefore = balanceForOwner(transaction.meta.preTokenBalances, fromOwner, mint);
  const fromAfter = balanceForOwner(transaction.meta.postTokenBalances, fromOwner, mint);
  const toBefore = balanceForOwner(transaction.meta.preTokenBalances, toOwner, mint);
  const toAfter = balanceForOwner(transaction.meta.postTokenBalances, toOwner, mint);
  const sent = fromBefore - fromAfter;
  const received = toAfter - toBefore;
  const minimum = toTokenAmount(minAmountUi);
  if (sent < minimum || received < minimum) return null;
  return Number(sent < received ? sent : received) / TOKEN_SCALE;
}

export async function getUnassignedIncomingPayments(ownerAddress: string) {
  const { authority: mintAuthority, usdMint } = requiredConfig();
  const owner = new PublicKey(ownerAddress);
  const treasuryAta = await getAssociatedTokenAddress(usdMint, mintAuthority.publicKey, true);
  const ownerAta = await getAssociatedTokenAddress(usdMint, owner, true);
  const signatures = await connection.getSignaturesForAddress(ownerAta, { limit: 100 }, "confirmed");
  const incoming: Array<{ signature: string; amountUsd: number; at: number }> = [];

  for (const signatureInfo of signatures) {
    if (signatureInfo.err) continue;
    const transaction = await connection.getParsedTransaction(signatureInfo.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!transaction || transaction.meta?.err) continue;

    const keys = transaction.transaction.message.accountKeys;
    const treasuryIndex = keys.findIndex((key) => key.pubkey.equals(treasuryAta));
    if (treasuryIndex < 0) continue;
    const treasuryBefore = (transaction.meta?.preTokenBalances ?? [])
      .filter((balance) => balance.accountIndex === treasuryIndex && balance.mint === usdMint.toBase58())
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
    const treasuryAfter = (transaction.meta?.postTokenBalances ?? [])
      .filter((balance) => balance.accountIndex === treasuryIndex && balance.mint === usdMint.toBase58())
      .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), BigInt(0));
    const userBefore = balanceForOwner(transaction.meta?.preTokenBalances, ownerAddress, usdMint.toBase58());
    const userAfter = balanceForOwner(transaction.meta?.postTokenBalances, ownerAddress, usdMint.toBase58());
    const treasuryIncrease = treasuryAfter - treasuryBefore;
    const userDecrease = userBefore - userAfter;
    const transferAmount = treasuryIncrease < userDecrease ? treasuryIncrease : userDecrease;
    if (transferAmount <= BigInt(0)) continue;

    incoming.push({
      signature: signatureInfo.signature,
      amountUsd: Number(transferAmount) / TOKEN_SCALE,
      at: (signatureInfo.blockTime ?? Math.floor(Date.now() / 1000)) * 1000,
    });
  }

  return incoming;
}

export async function getWalletTokenBalances(ownerAddress: string) {
  const accounts = await getWalletTokenAccounts(ownerAddress);
  const usdMint = usdMintAddress;
  const assetMint = assetMintAddress;
  return {
    usd: accounts.find((item) => item.mint === usdMint)?.balance ?? 0,
    assetUnits: accounts.find((item) => item.mint === assetMint)?.balance ?? 0,
  };
}

export type WalletTokenAccount = {
  tokenAccount: string;
  mint: string;
  owner: string;
  balance: number;
};

export async function getWalletTokenAccounts(ownerAddress: string): Promise<WalletTokenAccount[]> {
  const owner = new PublicKey(ownerAddress);
  const result = await connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed");
  return result.value.flatMap(({ pubkey, account }) => {
    if (account.data.program !== "spl-token") return [];
    const info = account.data.parsed.info as {
      mint?: unknown;
      owner?: unknown;
      tokenAmount?: { uiAmount?: unknown; uiAmountString?: unknown };
    };
    const mint = typeof info.mint === "string" ? info.mint : "";
    const accountOwner = typeof info.owner === "string" ? info.owner : "";
    const parsedBalance = typeof info.tokenAmount?.uiAmount === "number"
      ? info.tokenAmount.uiAmount
      : Number(info.tokenAmount?.uiAmountString ?? 0);
    if (!mint || !Number.isFinite(parsedBalance)) return [];
    return [{ tokenAccount: pubkey.toBase58(), mint, owner: accountOwner, balance: parsedBalance }];
  });
}

export async function getWalletSolBalance(ownerAddress: string) {
  return (await connection.getBalance(new PublicKey(ownerAddress), "confirmed")) / LAMPORTS_PER_SOL;
}

function formatTokenDelta(delta: number) {
  const amount = Math.abs(delta).toLocaleString("ru-RU", { maximumFractionDigits: 6 });
  return `${delta > 0 ? "+" : "−"}${amount}`;
}

export async function getWalletTransactionHistory(
  ownerAddress: string,
  tokenAccounts: WalletTokenAccount[],
  assetLabels: Record<string, { ticker: string; name: string; kind: "cash" | "kzte" | "vault" | "asset"; priceUsd: number }>,
) {
  const walletAccounts = new Set(tokenAccounts.map((item) => item.tokenAccount));
  const signatureGroups = await Promise.all(tokenAccounts.map(async ({ tokenAccount }) => {
    try {
      return await connection.getSignaturesForAddress(new PublicKey(tokenAccount), { limit: 50 }, "confirmed");
    } catch {
      return [];
    }
  }));
  const candidates = new Map<string, { signature: string; blockTime: number | null }>();
  for (const signatureInfo of signatureGroups.flat()) {
    if (!signatureInfo.err && !candidates.has(signatureInfo.signature)) {
      candidates.set(signatureInfo.signature, {
        signature: signatureInfo.signature,
        blockTime: signatureInfo.blockTime ?? null,
      });
    }
  }
  const latest = [...candidates.values()].sort((left, right) => (right.blockTime ?? 0) - (left.blockTime ?? 0)).slice(0, 20);
  const rows = await Promise.all(latest.map(async (item) => {
    const transaction = await connection.getParsedTransaction(item.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    }).catch(() => null);
    if (!transaction || !transaction.meta || transaction.meta.err) return null;

    const keys = transaction.transaction.message.accountKeys;
    const deltas = new Map<string, { delta: bigint; decimals: number }>();
    const collect = (
      balances: typeof transaction.meta.preTokenBalances,
      sign: -1 | 1,
    ) => {
      for (const balance of balances ?? []) {
        const key = keys[balance.accountIndex]?.pubkey.toBase58();
        if (balance.owner !== ownerAddress && !(key && walletAccounts.has(key))) continue;
        if (!assetLabels[balance.mint]) continue;
        const current = deltas.get(balance.mint) ?? { delta: BigInt(0), decimals: balance.uiTokenAmount.decimals };
        current.delta += BigInt(balance.uiTokenAmount.amount) * BigInt(sign);
        current.decimals = balance.uiTokenAmount.decimals;
        deltas.set(balance.mint, current);
      }
    };
    collect(transaction.meta.preTokenBalances, -1);
    collect(transaction.meta.postTokenBalances, 1);

    const changes = [...deltas.entries()].flatMap(([mint, value]) => {
      if (value.delta === BigInt(0)) return [];
      const asset = assetLabels[mint];
      const uiDelta = Number(value.delta) / (10 ** value.decimals);
      return [{
        mint,
        kind: asset.kind,
        delta: uiDelta,
        valueUsd: Math.abs(uiDelta * asset.priceUsd),
        label: `${formatTokenDelta(uiDelta)} ${asset.ticker}`,
      }];
    });
    if (!changes.length) return null;

    const cashDelta = changes.find((change) => change.kind === "cash")?.delta ?? 0;
    const vaultDelta = changes.some((change) => change.kind === "vault" && change.delta > 0);
    const vaultOut = changes.some((change) => change.kind === "vault" && change.delta < 0);
    const assetIn = changes.some((change) => change.kind === "asset" && change.delta > 0);
    const type = cashDelta < 0 && vaultDelta
      ? "Вклад"
      : cashDelta < 0 && assetIn
        ? "Покупка доли"
        : cashDelta > 0 && vaultOut
          ? "Вывод из вклада"
          : cashDelta > 0
            ? "Пополнение"
            : vaultOut || vaultDelta
              ? "Движение долей"
              : "Операция с активом";
    const activityType: "withdraw" | "invest" | "buy" | "topup" = cashDelta > 0 && vaultOut
      ? "withdraw"
      : cashDelta < 0 && vaultDelta
        ? "invest"
        : cashDelta < 0 && assetIn
          ? "buy"
          : cashDelta > 0
            ? "topup"
            : "buy";
    return {
      id: item.signature,
      title: `${type} · ${changes.map((change) => change.label).join(", ")}`,
      type: activityType,
      amountUsd: Math.max(...changes.map((change) => change.valueUsd)),
      at: (item.blockTime ?? transaction.blockTime ?? Math.floor(Date.now() / 1000)) * 1000,
      signature: item.signature,
      explorerUrl: explorerUrl(item.signature),
    };
  }));

  return rows.filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => right.at - left.at);
}

export function explorerUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function explorerAddressUrl(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}
