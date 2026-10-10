import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  AuthorityType,
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
} from "@solana/spl-token";

const KEY_FILE = ".demo-authority.json";
const ENV_FILE = ".env.local";
const SOLANA_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const initialEnv = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";

function getEnvValue(contents, name) {
  const line = contents.split(/\r?\n/).find((entry) => entry.match(new RegExp(`^\\s*${name}\\s*=`)));
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isRequestedDevnetCluster(cluster) {
  return cluster === undefined || cluster === "devnet";
}

async function assertDevnetWriteTarget(connection, requestedCluster) {
  if (!isRequestedDevnetCluster(requestedCluster)) {
    throw new Error("Refusing setup-devnet: SOLANA_CLUSTER must be devnet; mainnet and all non-Devnet writes are disabled.");
  }
  let genesisHash;
  try {
    genesisHash = await connection.getGenesisHash();
  } catch {
    throw new Error("Refusing setup-devnet: unable to verify the configured Solana RPC as canonical Devnet; mainnet writes are disabled.");
  }
  if (genesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error("Refusing setup-devnet: configured Solana RPC is not canonical Solana Devnet; mainnet writes are disabled.");
  }
}

const requestedCluster = process.env.SOLANA_CLUSTER ?? getEnvValue(initialEnv, "SOLANA_CLUSTER");
const connection = new Connection(process.env.SOLANA_RPC_URL || getEnvValue(initialEnv, "SOLANA_RPC_URL") || clusterApiUrl("devnet"), "confirmed");
await assertDevnetWriteTarget(connection, requestedCluster);

const authority = existsSync(KEY_FILE)
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY_FILE, "utf8"))))
  : Keypair.generate();
if (!existsSync(KEY_FILE)) {
  writeFileSync(KEY_FILE, JSON.stringify(Array.from(authority.secretKey)), { mode: 0o600 });
}

const balance = await connection.getBalance(authority.publicKey, "confirmed");
if (balance < 0.5 * LAMPORTS_PER_SOL) {
  try {
    const signature = await connection.requestAirdrop(authority.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(signature, "confirmed");
  } catch {
    console.error(`Недостаточно devnet SOL. Пополните адрес ${authority.publicKey.toBase58()} на https://faucet.solana.com и запустите скрипт ещё раз.`);
    process.exit(1);
  }
  if (await connection.getBalance(authority.publicKey, "confirmed") < 0.5 * LAMPORTS_PER_SOL) {
    console.error(`Недостаточно devnet SOL. Пополните адрес ${authority.publicKey.toBase58()} на https://faucet.solana.com и запустите скрипт ещё раз.`);
    process.exit(1);
  }
}

let envContents = initialEnv;
const assetMint = getEnvValue(envContents, "DEMO_TOKEN_MINT")
  || (await createMint(connection, authority, authority.publicKey, null, 6)).toBase58();
const usdMint = getEnvValue(envContents, "DEMO_USD_MINT")
  || (await createMint(connection, authority, authority.publicKey, null, 6)).toBase58();
const vaultUsdyMint = getEnvValue(envContents, "DEMO_VAULT_USDY_MINT")
  || (await createMint(connection, authority, authority.publicKey, null, 6)).toBase58();
const vaultKzgbMint = getEnvValue(envContents, "DEMO_VAULT_KZGB_MINT")
  || (await createMint(connection, authority, authority.publicKey, null, 6)).toBase58();
const configuredKzteMint = process.env.DEMO_KZTE_MINT || getEnvValue(envContents, "DEMO_KZTE_MINT");
const kzteMint = configuredKzteMint
  || (await createMint(connection, authority, authority.publicKey, null, 6)).toBase58();
const isNewKzteMint = !configuredKzteMint;
const treasury = await getOrCreateAssociatedTokenAccount(
  connection,
  authority,
  new PublicKey(usdMint),
  authority.publicKey,
  true,
);
const vaultUsdyTreasury = await getOrCreateAssociatedTokenAccount(
  connection,
  authority,
  new PublicKey(vaultUsdyMint),
  authority.publicKey,
  true,
);
const vaultKzgbTreasury = await getOrCreateAssociatedTokenAccount(
  connection,
  authority,
  new PublicKey(vaultKzgbMint),
  authority.publicKey,
  true,
);
const kzteTreasury = await getOrCreateAssociatedTokenAccount(
  connection,
  authority,
  new PublicKey(kzteMint),
  authority.publicKey,
  true,
);

let kzteMintInfo = await getMint(connection, new PublicKey(kzteMint));
if (isNewKzteMint || (kzteMintInfo.supply === BigInt(0)
  && kzteMintInfo.mintAuthority?.equals(authority.publicKey))) {
  await mintTo(
    connection,
    authority,
    new PublicKey(kzteMint),
    kzteTreasury.address,
    authority,
    BigInt(1_000_000_000) * BigInt(1_000_000),
  );
  await setAuthority(
    connection,
    authority,
    new PublicKey(kzteMint),
    authority,
    AuthorityType.MintTokens,
    null,
  );
  kzteMintInfo = await getMint(connection, new PublicKey(kzteMint));
}

function setEnvValue(contents, name, value) {
  const pattern = new RegExp(`^\\s*${name}\\s*=.*$`, "m");
  const line = `${name}=${value}`;
  if (pattern.test(contents)) return contents.replace(pattern, line);
  const separator = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
  return `${contents}${separator}${line}\n`;
}

envContents = setEnvValue(envContents, "DEMO_TOKEN_MINT", assetMint);
envContents = setEnvValue(envContents, "DEMO_USD_MINT", usdMint);
envContents = setEnvValue(envContents, "DEMO_VAULT_USDY_MINT", vaultUsdyMint);
envContents = setEnvValue(envContents, "DEMO_VAULT_KZGB_MINT", vaultKzgbMint);
envContents = setEnvValue(envContents, "DEMO_KZTE_MINT", kzteMint);
envContents = setEnvValue(envContents, "DEMO_TOKEN_AUTHORITY_SECRET", JSON.stringify(Array.from(authority.secretKey)));
writeFileSync(ENV_FILE, envContents);

console.log(`OFFICE-DEMO mint: ${assetMint}`);
console.log(`Тестовый доллар mint: ${usdMint}`);
console.log(`vUSDY-DEMO mint: ${vaultUsdyMint}`);
console.log(`vKZGB-DEMO mint: ${vaultKzgbMint}`);
console.log(`KZTE mint: ${kzteMint}`);
console.log(`KZTE supply: ${Number(kzteMintInfo.supply) / 1_000_000} KZTE`);
console.log(`KZTE mint authority: ${kzteMintInfo.mintAuthority?.toBase58() ?? "revoked"}`);
console.log(`KZTE freeze authority: ${kzteMintInfo.freezeAuthority?.toBase58() ?? "none"}`);
console.log(`Treasury ATA: ${treasury.address.toBase58()}`);
console.log(`vUSDY-DEMO treasury ATA: ${vaultUsdyTreasury.address.toBase58()}`);
console.log(`vKZGB-DEMO treasury ATA: ${vaultKzgbTreasury.address.toBase58()}`);
console.log(`KZTE treasury ATA: ${kzteTreasury.address.toBase58()}`);
