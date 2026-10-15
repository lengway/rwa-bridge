/**
 * Seeds the retail demo bond settled in Circle devnet USDC and opens its primary offering:
 *
 *   PUN27 · 1 USDC face per unit · 12% a year paid quarterly · one-year maturity
 *   offering at par (1 USDC per unit), open ~6 months, 100,000 units, 1,000 units per wallet
 *
 * Buyers pay with real devnet USDC through `subscribe` (delivery versus payment); coupons are funded
 * from the issuer's USDC (withdraw the proceeds first) and arrive as real devnet USDC.
 *
 * Reads MARKETS_ISSUER_SECRET (and MARKETS_RPC_URL) from the environment or .env.local. Prints the
 * new mint; put it first in MARKETS_INSTRUMENT_MINT to make it the default offering. Prints no secret.
 *
 *   npx tsx scripts/markets-seed-usdc.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

import { PLAIN_MARKETS_PROGRAM_ID, pda } from "../lib/markets/client";
import { DevnetIssuer, parseSecretKey } from "../lib/markets/devnet-issuer";
import { DevnetLedger, type DevnetMarketsConfig } from "../lib/markets/devnet-service";
import { CIRCLE_DEVNET_USDC } from "../lib/markets/purchase";

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}

loadEnvLocal();
const issuer = parseSecretKey(process.env.MARKETS_ISSUER_SECRET);
if (!issuer) throw new Error("Set MARKETS_ISSUER_SECRET (JSON array or base58) in .env.local");
const RPC = process.env.MARKETS_RPC_URL || "https://api.devnet.solana.com";
const USDC = BigInt(1_000_000);
const DAY = 86_400;
const explorer = (kind: "tx" | "address", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

const config: DevnetMarketsConfig = {
  mode: "devnet",
  rpcUrl: RPC,
  programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
  issuer: issuer.publicKey.toBase58(),
  mints: [],
  directory: [],
  settlementSymbol: "USDC",
  writable: true,
  apiBase: "",
};
const ledger = new DevnetLedger(config, null, { poll: false });
const desk = new DevnetIssuer(ledger, issuer);
const connection = ledger.connection;

async function main() {
  const balance = await connection.getBalance(issuer!.publicKey);
  console.log(`Issuer ${issuer!.publicKey.toBase58()} · ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL · ${RPC}`);
  if (balance < 0.05 * LAMPORTS_PER_SOL) throw new Error("Issuer needs at least 0.05 devnet SOL.");

  const bond = Keypair.generate();
  const now = await ledger.clusterNow();
  // Issue date today at 00:00 UTC so the quarterly schedule reads cleanly.
  const issueTs = now - (now % DAY);
  const maturityTs = issueTs + 365 * DAY;
  const created = await desk.send(
    [
      await ledger.client.initializeInstrument({
        issuer: issuer!.publicKey,
        mint: bond.publicKey,
        settlementMint: CIRCLE_DEVNET_USDC,
        settlementTokenProgram: TOKEN_PROGRAM_ID,
        params: {
          name: "Plain USDC Note 12% 2027",
          symbol: "PUN27",
          uri: "https://plain.lengway.me/bonds",
          isin: "",
          faceValue: USDC,
          couponBps: 1_200,
          couponFrequency: 4,
          issueTs,
          maturityTs,
          allowlistEnabled: false,
          payingAgent: issuer!.publicKey,
        },
      }),
    ],
    [bond],
  );
  console.log(`✓ initialize_instrument PUN27                 ${explorer("tx", created.signature)}`);
  ledger.changed();

  const inst = await ledger.client.fetchInstrumentByMint(bond.publicKey);
  if (!inst) throw new Error("instrument not readable after creation");
  const opened = await desk.send([
    await ledger.client.openOffering(inst, {
      issuePrice: USDC,
      startTs: BigInt(now - 60),
      endTs: BigInt(now + 180 * DAY),
      capUnits: BigInt(100_000),
      perHolderCap: BigInt(1_000),
    }),
  ]);
  console.log(`✓ open_offering (1 USDC/unit, 100k units)     ${explorer("tx", opened.signature)}`);

  const summary = {
    network: "devnet",
    programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(),
    issuer: issuer!.publicKey.toBase58(),
    instrument: inst.address.toBase58(),
    mint: bond.publicKey.toBase58(),
    settlementMint: CIRCLE_DEVNET_USDC.toBase58(),
    offering: pda.offering(inst.address).toBase58(),
    proceedsVault: pda.proceeds(inst.address).toBase58(),
    issueTs,
    maturityTs,
    transactions: { initializeInstrument: created.signature, openOffering: opened.signature },
  };
  const out = join(process.cwd(), ".data", "markets-seed-usdc");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "latest.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nMARKETS_INSTRUMENT_MINT=${summary.mint},${process.env.MARKETS_INSTRUMENT_MINT ?? ""}`.replace(/,$/, ""));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
