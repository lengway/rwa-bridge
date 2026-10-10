/**
 * Immutable, client-safe identifiers for the one supported Kamino Lend
 * reserve. Transaction construction and all RPC access remain server-only.
 */
export const KAMINO_LEND_DEVNET = {
  network: "devnet" as const,
  programId: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  market: "8tBETkxcw3RcivkCw7LT8ujBe1qj8xZusoVtqE2sR6oa",
  reserve: "8w8UVLPfVEVvvwi3QC8GTohUBqqzK6rC1Qg6HfoepsWn",
  liquidityMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  collateralMint: "6Txtcxf78FxjpDxc31jAnfXzaRFECr26DNt8CNim2wb7",
  supplyVault: "NVA3HA7nyfrvqbNehACNiLnd33ANssgsBYUPdqP5B2J",
  lendingMarketAuthority: "3vA23mvUdFnXEfMsRzEQJHRUpNt52uzZhzpY2hUna6Yo",
  liquidityTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  decimals: 6,
  symbol: "USDC",
  /** One Devnet USDC keeps the public test reserve usable for other builders. */
  maximumAmountAtomic: BigInt(1_000_000),
} as const;

export type KaminoLendAction = "deposit" | "withdraw";

export class KaminoLendDevnetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function error(code: string, message: string): never {
  throw new KaminoLendDevnetError(code, message);
}

export function parseKaminoLendAtomicAmount(value: unknown, label = "amountAtomic") {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    error("INVALID_AMOUNT", `${label} must be a positive atomic integer string.`);
  }
  try {
    return BigInt(value);
  } catch {
    error("INVALID_AMOUNT", `${label} is not a valid atomic integer.`);
  }
}

export function isKaminoLendDevnetCluster(value: unknown): value is "devnet" {
  return value === undefined || value === KAMINO_LEND_DEVNET.network;
}
