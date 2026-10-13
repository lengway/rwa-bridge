import assert from "node:assert/strict";
import test from "node:test";
import bs58 from "bs58";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  CROSSMINT_SOLANA_SMART_WALLET_PROGRAM_ID,
  CrossmintSolanaEnvelopeError,
  decodeCrossmintSolanaEnvelope,
} from "../lib/crossmint-solana-envelope";

const settings = "GYYsEyarbaL1SeFFiLPWUyvVFPa4tq5oZAhj6sakMBAw";
const wallet = "ACreLvLZcmPgHZHjzUzQWnvLtWHiqENjWNLQ7iqLewcc";
const authority = "C692sgLrJYpcs4rLDCN1Q6riAsEcXYPvRCgoqZTSkbMP";
const instructionsSysvar = "Sysvar1nstructions1111111111111111111111111";

// Public, unsigned on-chain transaction returned by Crossmint's prepare API.
// It includes one ATA create instruction followed by one Kamino deposit CPI.
const preparedWrapperData = Buffer.from(
  "040000000200000000060000000103020201030302040005000100000001060c00000001030702080009000a000b0203020c020202050005000d0010000000a9c91e7e06cd6644a086010000000000",
  "hex",
);

function account(pubkey: string, isWritable = false, isSigner = false) {
  return { pubkey: new PublicKey(pubkey), isWritable, isSigner };
}

function preparedWrapper(data = preparedWrapperData): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(CROSSMINT_SOLANA_SMART_WALLET_PROGRAM_ID),
    keys: [
      account(settings, true),
      account(wallet, true),
      account(instructionsSysvar),
      account("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      account(wallet, true),
      account("9EiMpvPW2YoqaW6QMho7mwTu91FHGbxBnEE9vtva9Gye", true),
      account("6Txtcxf78FxjpDxc31jAnfXzaRFECr26DNt8CNim2wb7", true),
      account("11111111111111111111111111111111"),
      account("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      account("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"),
      account("8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn", true),
      account("8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa"),
      account("3vA23mvUdFnXEfMsRzEQJHRUpNt52uzZhzpY2hUna6Yo"),
      account("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
      account("NVA3HA7nyfrvqbNehACNiLnd33ANssgsBYUPdqP5B2J", true),
      account("CfB5pn33aV8A5aJuDrLMaYQatz7SKwq7oS5tLSRU1156", true),
      account(instructionsSysvar),
      account(authority, false, true),
    ],
    data,
  });
}

test("decodes the observed Crossmint SDK envelope and compact Kamino instructions", () => {
  const decoded = decodeCrossmintSolanaEnvelope(preparedWrapper());

  assert.equal(decoded.settingsAddress, settings);
  assert.equal(decoded.walletAddress, wallet);
  assert.equal(decoded.signerIndex, 0);
  assert.equal(decoded.authorityAddress, authority);
  assert.equal(decoded.instructions.length, 2);
  assert.equal(decoded.instructions[0].programId, "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  assert.deepEqual(decoded.instructions[0].accounts.map((item) => item.address), [
    wallet,
    "9EiMpvPW2YoqaW6QMho7mwTu91FHGbxBnEE9vtva9Gye",
    wallet,
    "6Txtcxf78FxjpDxc31jAnfXzaRFECr26DNt8CNim2wb7",
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ]);
  assert.equal(decoded.instructions[0].dataBase58, bs58.encode(Uint8Array.of(1)));
  assert.equal(decoded.instructions[1].programId, "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
  assert.equal(decoded.instructions[1].accounts.length, 12);
  assert.equal(decoded.instructions[1].dataBase58, bs58.encode(Buffer.from(
    "a9c91e7e06cd6644a086010000000000",
    "hex",
  )));
});

test("rejects unknown variants, replay protection, signer slots, and malformed privileges", () => {
  const invalids = [
    { label: "variant", offset: 0, value: 5, expected: /unsupported Crossmint instruction variant/ },
    { label: "signer index", offset: 1, value: 1, expected: /only signer index zero/ },
    { label: "replay prevention", offset: 3, value: 1, expected: /replay-prevention variants/ },
    // First compact account flags byte starts after header, ix count, program index,
    // account count, and its one-byte account index.
    { label: "flags", offset: 14, value: 4, expected: /unsupported privilege flags/ },
  ];
  for (const item of invalids) {
    const data = Buffer.from(preparedWrapperData);
    data[item.offset] = item.value;
    assert.throws(
      () => decodeCrossmintSolanaEnvelope(preparedWrapper(data)),
      { name: CrossmintSolanaEnvelopeError.name, message: item.expected },
      item.label,
    );
  }
});

test("rejects a wallet PDA mismatch, missing signer, truncation, and trailing bytes", () => {
  const mismatchedWallet = preparedWrapper();
  mismatchedWallet.keys[1] = account(PublicKey.unique().toBase58(), true);
  assert.throws(() => decodeCrossmintSolanaEnvelope(mismatchedWallet), /wallet root is not the SDK-derived/);

  const noAuthority = preparedWrapper();
  noAuthority.keys[noAuthority.keys.length - 1].isSigner = false;
  assert.throws(() => decodeCrossmintSolanaEnvelope(noAuthority), /exactly one outer signer authority/);

  assert.throws(() => decodeCrossmintSolanaEnvelope(preparedWrapper(preparedWrapperData.subarray(0, -1))), /truncated/);
  assert.throws(() => decodeCrossmintSolanaEnvelope(preparedWrapper(Buffer.concat([preparedWrapperData, Buffer.of(0)]))), /trailing/);
});
