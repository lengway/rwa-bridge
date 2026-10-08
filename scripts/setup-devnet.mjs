import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

const KEY_FILE = ".demo-authority.json";
const ENV_FILE = ".env.local";
const initialEnv = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";

function getEnvValue(contents, name) {
  const line = contents.split(/\r?\n/).find((entry) => entry.match(new RegExp(`^\\s*${name}\\s*=`)));
  if (!line) return "";
  const value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

const connection = new Connection(process.env.SOLANA_RPC_URL || getEnvValue(initialEnv, "SOLANA_RPC_URL") || clusterApiUrl("devnet"), "confirmed");

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
envContents = setEnvValue(envContents, "DEMO_TOKEN_AUTHORITY_SECRET", JSON.stringify(Array.from(authority.secretKey)));
writeFileSync(ENV_FILE, envContents);

console.log(`OFFICE-DEMO mint: ${assetMint}`);
console.log(`Тестовый доллар mint: ${usdMint}`);
console.log(`vUSDY-DEMO mint: ${vaultUsdyMint}`);
console.log(`vKZGB-DEMO mint: ${vaultKzgbMint}`);
console.log(`Treasury ATA: ${treasury.address.toBase58()}`);
console.log(`vUSDY-DEMO treasury ATA: ${vaultUsdyTreasury.address.toBase58()}`);
console.log(`vKZGB-DEMO treasury ATA: ${vaultKzgbTreasury.address.toBase58()}`);
