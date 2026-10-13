import bs58 from "bs58";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

/** Crossmint staging program observed in the prepared Solana transaction. */
export const CROSSMINT_SOLANA_SMART_WALLET_PROGRAM_ID =
  "XmSwiXQsxSZYKVYbSAkkvQVvdrKo1nwwfvZBPQrLzbU";

const INSTRUCTIONS_SYSVAR_ID = "Sysvar1nstructions1111111111111111111111111";
const SMART_ACCOUNT_SEED = Buffer.from("smart_account");
const EXECUTE_TRANSACTION_VARIANT = 4;
const MAX_INSTRUCTIONS = 8;
const MAX_ACCOUNTS_PER_INSTRUCTION = 128;
const MAX_INSTRUCTION_DATA = 1_232;

export type DecodedCrossmintInstructionAccount = {
  address: string;
  isSigner: boolean;
  isWritable: boolean;
};

export type DecodedCrossmintInnerInstruction = {
  programId: string;
  accounts: DecodedCrossmintInstructionAccount[];
  dataBase58: string;
};

export type DecodedCrossmintSolanaEnvelope = {
  settingsAddress: string;
  walletAddress: string;
  signerIndex: 0;
  authorityAddress: string;
  instructions: DecodedCrossmintInnerInstruction[];
};

export class CrossmintSolanaEnvelopeError extends Error {
  constructor(message: string) {
    super(`CROSSMINT_SOLANA_ENVELOPE_REJECTED: ${message}`);
    this.name = "CrossmintSolanaEnvelopeError";
  }
}

function reject(message: string): never {
  throw new CrossmintSolanaEnvelopeError(message);
}

class Reader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  u8(label: string): number {
    if (this.offset + 1 > this.data.length) reject(`truncated ${label}.`);
    return this.data[this.offset++];
  }

  u16(label: string): number {
    if (this.offset + 2 > this.data.length) reject(`truncated ${label}.`);
    const value = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return value;
  }

  u32(label: string): number {
    if (this.offset + 4 > this.data.length) reject(`truncated ${label}.`);
    const value = new DataView(
      this.data.buffer,
      this.data.byteOffset + this.offset,
      4,
    ).getUint32(0, true);
    this.offset += 4;
    return value;
  }

  bytes(length: number, label: string): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) {
      reject(`truncated ${label}.`);
    }
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  finish() {
    if (this.offset !== this.data.length) reject("unexpected trailing wrapper instruction data.");
  }
}

/**
 * Decode only the observed Crossmint `executeTransaction` envelope variant.
 *
 * Layout follows `@crossmint/solana-smart-wallet-sdk@0.1.0`'s builder and
 * compact-instruction codec (`dist/esm/builder.js`, `accounts.js`, `pda.js`),
 * cross-checked byte-for-byte against the prepared XmSwi transaction fixture.
 * The SDK package's default program ID differs from the deployed XmSwi ID, so
 * this codec is intentionally limited to the observed variant: execute
 * transaction, signer slot zero, no replay-prevention option. It does not
 * establish that the deployed program binary matches that SDK source.
 *
 * The caller must separately verify settings-account ownership/initialization
 * from RPC and validate every returned inner instruction against the intended
 * action before accepting a receipt.
 */
export function decodeCrossmintSolanaEnvelope(
  wrapper: TransactionInstruction,
  allowEmptyInitialization = false,
): DecodedCrossmintSolanaEnvelope {
  if (wrapper.programId.toBase58() !== CROSSMINT_SOLANA_SMART_WALLET_PROGRAM_ID) {
    reject("outer program is not the observed Crossmint smart-wallet program.");
  }
  if (wrapper.keys.length < 4) reject("wrapper is missing its root or remaining accounts.");

  const settings = wrapper.keys[0];
  const wallet = wrapper.keys[1];
  const instructionsSysvar = wrapper.keys[2];
  const settingsAddress = settings.pubkey.toBase58();
  const walletAddress = wallet.pubkey.toBase58();
  if (!settings.isWritable || settings.isSigner) reject("settings root meta is unsupported.");
  if (!wallet.isWritable || wallet.isSigner) reject("wallet root meta is unsupported.");
  if (instructionsSysvar.pubkey.toBase58() !== INSTRUCTIONS_SYSVAR_ID
    || instructionsSysvar.isWritable || instructionsSysvar.isSigner) {
    reject("instructions sysvar root meta is unsupported.");
  }

  let derivedWallet: PublicKey;
  try {
    [derivedWallet] = PublicKey.findProgramAddressSync(
      [SMART_ACCOUNT_SEED, settings.pubkey.toBuffer()],
      wrapper.programId,
    );
  } catch {
    return reject("wallet PDA could not be derived from the settings root.");
  }
  if (derivedWallet.toBase58() !== walletAddress) reject("wallet root is not the SDK-derived smart-account PDA.");

  const remaining = wrapper.keys.slice(3);
  const authorities = remaining.filter((account) => account.isSigner);
  if (authorities.length !== 1) reject("exactly one outer signer authority is required in remaining accounts.");

  const reader = new Reader(wrapper.data);
  if (reader.u8("instruction variant") !== EXECUTE_TRANSACTION_VARIANT) {
    reject("unsupported Crossmint instruction variant.");
  }
  const signerIndex = reader.u16("signer index");
  if (signerIndex !== 0) reject("only signer index zero is supported.");
  const replayPrevention = reader.u8("replay-prevention option");
  if (replayPrevention !== 0) reject("replay-prevention variants are not supported.");

  const instructionCount = reader.u32("inner instruction count");
  if ((instructionCount < 1 && !allowEmptyInitialization) || instructionCount > MAX_INSTRUCTIONS) {
    reject("inner instruction count is outside the supported range.");
  }

  const instructions: DecodedCrossmintInnerInstruction[] = [];
  for (let instructionIndex = 0; instructionIndex < instructionCount; instructionIndex += 1) {
    const programIndex = reader.u8(`inner instruction ${instructionIndex} program index`);
    if (programIndex >= remaining.length) reject("inner program index is outside remaining accounts.");
    const programId = remaining[programIndex].pubkey.toBase58();

    const accountCount = reader.u32(`inner instruction ${instructionIndex} account count`);
    if (accountCount > MAX_ACCOUNTS_PER_INSTRUCTION) reject("inner instruction has too many accounts.");
    const accounts: DecodedCrossmintInstructionAccount[] = [];
    for (let accountIndex = 0; accountIndex < accountCount; accountIndex += 1) {
      const index = reader.u8(`inner instruction ${instructionIndex} account index`);
      const flags = reader.u8(`inner instruction ${instructionIndex} account flags`);
      if (index >= remaining.length) reject("inner account index is outside remaining accounts.");
      if ((flags & 0xfc) !== 0) reject("inner account contains unsupported privilege flags.");
      accounts.push({
        address: remaining[index].pubkey.toBase58(),
        isSigner: (flags & 0x01) !== 0,
        isWritable: (flags & 0x02) !== 0,
      });
    }

    const dataLength = reader.u32(`inner instruction ${instructionIndex} data length`);
    if (dataLength > MAX_INSTRUCTION_DATA) reject("inner instruction data exceeds the Solana packet limit.");
    const data = reader.bytes(dataLength, `inner instruction ${instructionIndex} data`);
    instructions.push({ programId, accounts, dataBase58: bs58.encode(data) });
  }
  reader.finish();

  return {
    settingsAddress,
    walletAddress,
    signerIndex: 0,
    authorityAddress: authorities[0].pubkey.toBase58(),
    instructions,
  };
}
