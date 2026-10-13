/**
 * Register indexer for a Plain Markets bond: who holds how many units of the Token-2022 mint at a
 * given slot. Feeds `buildSnapshotTree` at record date.
 *
 * Strategy: getProgramAccounts on Token-2022 filtered by mint; some public RPCs refuse Token-2022
 * gPA, so callers can pass candidate owners whose ATAs are read with one getMultipleAccounts. The
 * result is only trusted when the balances sum to the mint supply read at the same slot.
 */
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount, unpackMint } from "@solana/spl-token";
import { type Connection, PublicKey } from "@solana/web3.js";

import { aggregateHoldings, type Holding } from "./merkle";

export type RegisterRead = {
  mint: string;
  slot: number;
  supply: bigint;
  holdings: Holding[];
  /** "gpa" = full scan; "candidates" = ATAs of the given owners only. */
  source: "gpa" | "candidates";
};

export async function readRegister(
  connection: Connection,
  mint: PublicKey,
  options: { candidates?: PublicKey[]; minContextSlot?: number } = {},
): Promise<RegisterRead> {
  const commitment = "confirmed" as const;
  let rows: { owner: string; amount: bigint }[] | null = null;
  let slot = 0;
  let source: RegisterRead["source"] = "gpa";

  if (!options.candidates) {
    const res = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
      commitment,
      withContext: true,
      filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
      minContextSlot: options.minContextSlot,
    });
    slot = res.context.slot;
    rows = res.value.map(({ pubkey, account }) => {
      const a = unpackAccount(pubkey, account, TOKEN_2022_PROGRAM_ID);
      return { owner: a.owner.toBase58(), amount: a.amount };
    });
  } else {
    source = "candidates";
    const atas = options.candidates.map((o) => getAssociatedTokenAddressSync(mint, o, true, TOKEN_2022_PROGRAM_ID));
    const res = await connection.getMultipleAccountsInfoAndContext([mint, ...atas], {
      commitment,
      minContextSlot: options.minContextSlot,
    });
    slot = res.context.slot;
    rows = res.value.slice(1).flatMap((info, i) => {
      if (!info) return [];
      const a = unpackAccount(atas[i], info, TOKEN_2022_PROGRAM_ID);
      return [{ owner: a.owner.toBase58(), amount: a.amount }];
    });
  }

  const mintInfo = await connection.getAccountInfoAndContext(mint, { commitment, minContextSlot: slot });
  if (!mintInfo.value) throw new Error(`mint ${mint.toBase58()} not found`);
  const supply = unpackMint(mint, mintInfo.value, TOKEN_2022_PROGRAM_ID).supply;
  const holdings = aggregateHoldings(rows);
  const sum = holdings.reduce((s, h) => s + h.units, BigInt(0));
  if (sum !== supply) {
    throw new Error(`register does not reconcile: holdings sum ${sum} != supply ${supply} (${source})`);
  }
  return { mint: mint.toBase58(), slot, supply, holdings, source };
}
