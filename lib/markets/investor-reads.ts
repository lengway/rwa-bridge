/**
 * Chain reads behind the investor views, over any `DevnetLedger` (the server's, or a test one on a
 * mock RPC): the ledger's cached instrument and action reads plus one getMultipleAccounts for the
 * wallet's own bond and settlement token accounts.
 */
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { bondAta } from "./client";
import { issueStateOf, type DevnetLedger } from "./devnet-service";
import { buildDetail, buildOverview, type AllocationLimits, type BondDetail, type InstrumentReading, type SettlementBalance, type ViewContext } from "./investor";
import type { Address, Instrument } from "./service";
import { rpcRetry } from "./signature-feed";

function context(reader: DevnetLedger, wallet: Address, limits: AllocationLimits): ViewContext {
  return {
    wallet,
    now: reader.now(),
    limits,
    explorerTx: (s) => reader.explorerTxUrl(s),
    explorerAddress: (a) => reader.explorerAddressUrl(a),
  };
}

/** The wallet's bond balances and settlement balances in one getMultipleAccounts. */
async function balances(reader: DevnetLedger, wallet: PublicKey, instruments: Instrument[]) {
  const refs = await Promise.all(instruments.map((i) => reader.instrumentRef(new PublicKey(i.address))));
  const settlement = new Map<string, { mint: PublicKey; program: PublicKey; instrument: Instrument }>();
  refs.forEach((r, k) => settlement.set(r.account.settlementMint.toBase58(), { mint: r.account.settlementMint, program: r.account.settlementTokenProgram, instrument: instruments[k] }));
  const bondKeys = refs.map((r) => bondAta(wallet, r.account.mint));
  const settlementList = [...settlement.values()];
  // allowOwnerOffCurve: Plain wallets are smart-wallet PDAs.
  const settlementKeys = settlementList.map((s) => getAssociatedTokenAddressSync(s.mint, wallet, true, s.program));
  const infos = bondKeys.length + settlementKeys.length ? await rpcRetry(() => reader.connection.getMultipleAccountsInfo([...bondKeys, ...settlementKeys], "confirmed")) : [];
  const held = new Map<string, bigint>();
  instruments.forEach((i, k) => {
    const info = infos[k];
    held.set(i.mint, info ? unpackAccount(bondKeys[k], info, TOKEN_2022_PROGRAM_ID).amount : BigInt(0));
  });
  const cash: SettlementBalance[] = settlementList.map((s, k) => {
    const info = infos[bondKeys.length + k];
    return {
      mint: s.mint.toBase58(),
      symbol: s.instrument.settlementSymbol,
      decimals: s.instrument.settlementDecimals,
      amount: (info ? unpackAccount(settlementKeys[k], info, s.program).amount : BigInt(0)).toString(),
    };
  });
  return { refs, held, cash };
}

async function reading(reader: DevnetLedger, instrument: Instrument, ref: Awaited<ReturnType<DevnetLedger["instrumentRef"]>>, heldUnits: bigint): Promise<InstrumentReading> {
  const actions = await reader.listActions(instrument.mint);
  const snapshots = new Map<Address, Awaited<ReturnType<DevnetLedger["getSnapshot"]>>>();
  const receipts = new Map<Address, Awaited<ReturnType<DevnetLedger["listReceipts"]>>>();
  const votes = new Map<Address, Awaited<ReturnType<DevnetLedger["listVotes"]>>>();
  await Promise.all(
    actions.map(async (a) => {
      const [s, r, v] = await Promise.all([reader.getSnapshot(a.id), reader.listReceipts(a.id), reader.listVotes(a.id)]);
      snapshots.set(a.id, s);
      receipts.set(a.id, r);
      votes.set(a.id, v);
    }),
  );
  const offering = await reader.getOffering(instrument.mint);
  return { instrument, issue: issueStateOf(ref.account), offering, actions, snapshots, receipts, votes, heldUnits };
}

export async function readOverview(reader: DevnetLedger, wallet: Address, limits: AllocationLimits) {
  const instruments = await reader.listInstruments();
  const { refs, held, cash } = await balances(reader, new PublicKey(wallet), instruments);
  const readings = await Promise.all(instruments.map((i, k) => reading(reader, i, refs[k], held.get(i.mint) ?? BigInt(0))));
  return buildOverview(readings, cash, context(reader, wallet, limits));
}

/** Null when the mint is not one of the listed instruments. */
export async function readBond(reader: DevnetLedger, wallet: Address, mint: Address, limits: AllocationLimits): Promise<BondDetail | null> {
  const instrument = (await reader.listInstruments()).find((i) => i.mint === mint);
  if (!instrument) return null;
  const { refs, held, cash } = await balances(reader, new PublicKey(wallet), [instrument]);
  const r = await reading(reader, instrument, refs[0], held.get(mint) ?? BigInt(0));
  return buildDetail(r, cash[0] ?? null, context(reader, wallet, limits));
}
