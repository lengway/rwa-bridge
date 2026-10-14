/** A fake JSON-RPC endpoint and a settled-coupon fixture shared by the Plain Markets devnet tests. */
import { BN } from "@anchor-lang/core";
import { ACCOUNT_SIZE, AccountLayout, AccountState, MINT_SIZE, MintLayout, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { MarketsClient, PLAIN_MARKETS_PROGRAM_ID, pda } from "../../lib/markets/client";
import { createDevnetMarketsService, type DevnetMarketsConfig } from "../../lib/markets/devnet-service";
import { allocationMemo } from "../../lib/markets/investor";
import { buildSnapshotTree, snapshotHash } from "../../lib/markets/merkle";
import { snapshotInlineMemo, termsHash, termsJson, termsMemo, type TermsDocument } from "../../lib/markets/publication";

export const USD = BigInt(1_000_000);
export const bn = (v: number | bigint) => new BN(v.toString());

// ---- a fake JSON-RPC endpoint holding a settled coupon -------------------------------------------

export type Account = { data: Buffer; owner: PublicKey; lamports?: number };
export type Sig = { signature: string; slot: number; blockTime: number; memo: string | null };

export function fakeRpc(accounts: Map<string, Account>, sigs: Map<string, Sig[]>, slot = 9_000) {
  const calls: Record<string, number> = {};
  const enc = (a: Account | undefined) =>
    a ? { data: [a.data.toString("base64"), "base64"], executable: false, lamports: a.lamports ?? 1_000_000, owner: a.owner.toBase58(), rentEpoch: 0, space: a.data.length } : null;
  const fetchImpl = async (_url: unknown, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body)) as { id: string; method: string; params: unknown[] };
    calls[req.method] = (calls[req.method] ?? 0) + 1;
    const ctx = { context: { slot } };
    let result: unknown;
    switch (req.method) {
      case "getAccountInfo":
        result = { ...ctx, value: enc(accounts.get(req.params[0] as string)) };
        break;
      case "getMultipleAccounts":
        result = { ...ctx, value: (req.params[0] as string[]).map((k) => enc(accounts.get(k))) };
        break;
      case "getSignaturesForAddress": {
        const list = [...(sigs.get(req.params[0] as string) ?? [])].sort((a, b) => b.slot - a.slot);
        const until = (req.params[1] as { until?: string })?.until;
        const cut = until ? list.findIndex((s) => s.signature === until) : -1;
        result = (cut >= 0 ? list.slice(0, cut) : list).map((s) => ({ ...s, err: null, confirmationStatus: "confirmed" }));
        break;
      }
      case "getSlot":
        result = slot;
        break;
      case "getBlockTime":
        result = 1_800_000_000;
        break;
      default:
        throw new Error(`unexpected RPC ${req.method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { headers: { "content-type": "application/json" } });
  };
  return { connection: new Connection("http://fake.rpc", { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: fetchImpl as typeof fetch }), calls };
}

export const memoField = (...memos: string[]) => memos.map((m) => `[${Buffer.byteLength(m)}] ${m}`).join("; ");

/**
 * A settled coupon on a 100-unit bond held 50/30/20. With `smartWallet`, the third holder is an
 * off-curve PDA (like a Crossmint smart wallet) that received its units through a Plain allocation
 * (memo in the issue transaction) and holds its coupon in an off-curve settlement ATA.
 */
export async function settledCouponFixture(opts: { tamperReceipt?: boolean; transferAfterRecord?: boolean; smartWallet?: boolean } = {}) {
  const client = MarketsClient.fromConnection(new Connection("http://unused"));
  const issuer = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const usd = Keypair.generate().publicKey;
  const instrument = pda.instrument(mint);
  const action = pda.action(instrument, 0);
  const smart = PublicKey.findProgramAddressSync([Buffer.from("smart-wallet"), Keypair.generate().publicKey.toBytes()], Keypair.generate().publicKey)[0];
  const holders = [Keypair.generate().publicKey, Keypair.generate().publicKey, opts.smartWallet ? smart : Keypair.generate().publicKey];
  const units = [BigInt(50), BigInt(30), BigInt(20)];
  const T = 1_800_000_000;
  const recordSlot = 1_100;
  const snapSlot = 1_120;

  const doc: TermsDocument = { v: 1, kind: "Coupon", title: "Coupon 1 of 8", recordTs: T + 25, paymentTs: T + 45, claimDeadlineTs: T + 600, rateBps: 1200, redeemBps: 0, priceBps: 0, options: [], question: null };
  const json = termsJson(doc);
  const holdings = holders.map((h, i) => ({ holder: h.toBase58(), units: units[i] }));
  const snapshot = { version: 1 as const, instrument: instrument.toBase58(), mint: mint.toBase58(), action: action.toBase58(), recordTs: doc.recordTs, slot: snapSlot - 2, holdings };
  const tree = buildSnapshotTree(action, holdings);
  const perUnit = BigInt(30) * USD;

  const accounts = new Map<string, Account>();
  const put = async (address: PublicKey, name: string, value: Record<string, unknown>) =>
    accounts.set(address.toBase58(), { data: await client.coder.accounts.encode(name, value), owner: PLAIN_MARKETS_PROGRAM_ID });

  await put(instrument, "instrument", {
    issuer, payingAgent: issuer, mint, settlementMint: usd, settlementTokenProgram: TOKEN_PROGRAM_ID, settlementDecimals: 6,
    name: "Test Bond", symbol: "TB28", isin: Array(12).fill(0), faceValue: bn(BigInt(1000) * USD), couponBps: 1200, couponFrequency: 4,
    issueTs: bn(T - 90 * 86_400), maturityTs: bn(T + 700 * 86_400), status: { active: {} }, allowlistEnabled: false,
    lockFrom: bn(doc.recordTs), lockUntil: bn(doc.paymentTs), issuedUnits: bn(100), redeemedUnits: bn(0), actionCount: bn(1),
    couponPeriods: 1, pendingAction: null, openActions: 0, openRedemption: false, createdTs: bn(T - 100), bump: 255,
  });
  await put(action, "corporateAction", {
    instrument, id: bn(0), kind: { coupon: {} }, status: { settled: {} }, title: doc.title, termsHash: Array.from(termsHash(json)),
    recordTs: bn(doc.recordTs), paymentTs: bn(doc.paymentTs), claimDeadline: bn(doc.claimDeadlineTs), rateBps: 1200, redeemBps: 0, priceBps: 0, period: 1, options: [],
    amountPerUnit: bn(perUnit), recordSupply: bn(100), recordSlot: bn(recordSlot), recordLockedTs: bn(T + 26),
    merkleRoot: Array.from(tree.root), snapshotHash: Array.from(snapshotHash(snapshot)), totalUnits: bn(100), holderCount: 3, snapshotSlot: bn(snapSlot),
    totalRedeemUnits: bn(0), totalEntitlement: bn(perUnit * BigInt(100)), fundedAmount: bn(perUnit * BigInt(100)), paidAmount: bn(perUnit * BigInt(100)), paidCount: 3,
    claimedUnits: bn(100), redeemedUnits: bn(0), sweptAmount: bn(0), tally: [bn(0), bn(0), bn(0), bn(0)], votesCast: 0, winningOption: null,
    prevLockFrom: bn(0), prevLockUntil: bn(0), announcedTs: bn(T), fundedTs: bn(T + 30), settledTs: bn(T + 60), bump: 254,
  });
  for (let i = 0; i < holders.length; i++) {
    const amount = perUnit * units[i] + (opts.tamperReceipt && i === 0 ? USD : BigInt(0));
    await put(pda.claim(action, holders[i]), "claimReceipt", {
      action, holder: holders[i], units: bn(units[i]), amount: bn(amount), burnedUnits: bn(0), mode: i === 1 ? { claim: {} } : { push: {} },
      paidBy: issuer, slot: bn(1_200 + i), ts: bn(T + 50 + i), bump: 253,
    });
  }
  // Token-2022 bond mint and holder ATAs (base layouts).
  const mintData = Buffer.alloc(MINT_SIZE);
  MintLayout.encode({ mintAuthorityOption: 1, mintAuthority: instrument, supply: BigInt(100), decimals: 0, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, mintData);
  accounts.set(mint.toBase58(), { data: mintData, owner: TOKEN_2022_PROGRAM_ID });
  holders.forEach((h, i) => {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint, owner: h, amount: units[i], delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized, isNativeOption: 0, isNative: BigInt(0), delegatedAmount: BigInt(0), closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    accounts.set(getAssociatedTokenAddressSync(mint, h, true, TOKEN_2022_PROGRAM_ID).toBase58(), { data, owner: TOKEN_2022_PROGRAM_ID });
  });

  holders.forEach((h, i) => {
    const data = Buffer.alloc(ACCOUNT_SIZE);
    AccountLayout.encode({ mint: usd, owner: h, amount: perUnit * units[i], delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized, isNativeOption: 0, isNative: BigInt(0), delegatedAmount: BigInt(0), closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
    accounts.set(getAssociatedTokenAddressSync(usd, h, true, TOKEN_PROGRAM_ID).toBase58(), { data, owner: TOKEN_PROGRAM_ID });
  });

  const s = (signature: string, slot: number, blockTime: number, memo: string | null = null): Sig => ({ signature, slot, blockTime, memo });
  const sig = (n: number) => Keypair.generate().publicKey.toBase58() + String(n).padStart(4, "0");
  const feed: Sig[] = [
    s(sig(1), 1_000, T - 100, opts.smartWallet ? memoField(allocationMemo(smart.toBase58(), units[2])) : null),
    s(sig(2), 1_050, T, memoField(termsMemo(json))),
    s(sig(3), recordSlot, T + 26),
    s(sig(4), snapSlot, T + 28, memoField(snapshotInlineMemo(snapshot.slot, tree.holdings))),
    s(sig(5), 1_150, T + 30),
    s(sig(6), 1_200, T + 50),
    s(sig(7), 1_201, T + 51),
    s(sig(8), 1_202, T + 52),
    s(sig(9), 1_300, T + 60),
  ];
  const { connection, calls } = fakeRpc(accounts, new Map([[instrument.toBase58(), feed]]));
  const config: DevnetMarketsConfig = {
    mode: "devnet", rpcUrl: "http://fake.rpc", programId: PLAIN_MARKETS_PROGRAM_ID.toBase58(), issuer: issuer.toBase58(), mints: [mint.toBase58()],
    directory: [{ address: holders[0].toBase58(), label: "Pension fund", custody: "custodian" }], settlementSymbol: "USD", writable: false, apiBase: "/api/markets",
  };
  const svc = createDevnetMarketsService(config, null, { connection, poll: false });
  return { svc, calls, instrument, action, mint, holders, feed, snapshot, json, connection, config, usd, T, perUnit };
}

