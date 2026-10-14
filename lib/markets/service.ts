/**
 * Plain Markets — the contract between the product UI and the corporate-actions engine.
 *
 * Shapes mirror the `plain_markets` program accounts in docs/kase-v2-spec.md. Amounts are
 * integers: bond units have 0 decimals, settlement amounts are base units of the 6-decimal
 * settlement token (1 USD = 1_000_000). Timestamps are unix seconds, like the program's clock.
 *
 * The UI only talks to `MarketsService`. A backend implements the smaller `MarketsLedger`
 * (raw reads of program accounts + instruction senders) and `withDerivedViews` adds the
 * pure, client-side computations (entitlement preview, verification) on top, so the same
 * math runs in the console, the verifier and the tests.
 */

export type Address = string;
export type Signature = string;
/** Unix seconds. */
export type UnixTs = number;

export type InstrumentStatus = "Active" | "Matured" | "Redeemed";

export type Instrument = {
  /** Token-2022 bond mint (0 decimals); also the seed of the Instrument PDA. */
  mint: Address;
  /** Instrument PDA [b"instrument", mint]. */
  address: Address;
  programId: Address;
  issuer: Address;
  /** Paying agent allowed to crank `pay` (push payments for custodial / retail wallets). */
  payingAgent: Address;
  settlementMint: Address;
  settlementSymbol: string;
  settlementDecimals: number;
  name: string;
  symbol: string;
  /** Face value of one bond unit in settlement base units. */
  faceValue: bigint;
  couponBps: number;
  /** Coupon payments per year. */
  frequency: number;
  issueTs: UnixTs;
  maturityTs: UnixTs;
  status: InstrumentStatus;
  /** Ex-date lock: the transfer hook rejects transfers while lockFrom <= now < lockUntil. 0 = never locked. */
  lockFrom: UnixTs;
  lockUntil: UnixTs;
  allowlist: boolean;
  /** Units issued at launch. */
  issuedUnits: bigint;
  /** Units currently outstanding (decreases on redemption burns). */
  supply: bigint;
  /** Units burned by redemptions so far. */
  redeemedUnits: bigint;
  actionCount: number;
};

export type ActionKind = "Coupon" | "PartialRedemption" | "FinalRedemption" | "Vote";

/** Lifecycle order. `Cancelled` is a terminal side exit (issuer `cancel_action` before Funded). */
export const ACTION_STATUSES = ["Announced", "RecordLocked", "SnapshotPosted", "Funded", "Settling", "Settled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number] | "Cancelled";

export type ActionParams =
  | { kind: "Coupon"; /** 1-based coupon period. */ period: number; couponBps: number }
  | {
      kind: "PartialRedemption";
      /** Share of every holding redeemed, in bps (2500 = 25%). Units round down per holder. */
      redeemBps: number;
      /** Redemption price as bps of face (10000 = par). */
      priceBps: number;
    }
  | { kind: "FinalRedemption"; priceBps: number; /** Pays the last coupon together with principal. */ includeCoupon: boolean; couponBps: number }
  | { kind: "Vote"; question: string; options: string[] };

export type StatusTransition = { status: ActionStatus; ts: UnixTs; slot: number; signature: Signature };

export type CorporateAction = {
  /** CorporateAction PDA [b"action", instrument, id u64 LE]. */
  id: Address;
  /** 1-based display number (on-chain id + 1). */
  seq: number;
  instrument: Address;
  kind: ActionKind;
  params: ActionParams;
  status: ActionStatus;
  title: string;
  announcedTs: UnixTs;
  /** Record date: the register is locked and snapshotted at this time. */
  recordTs: UnixTs;
  /** Payment date (or vote close). The ex-date lock lasts from recordTs until here. */
  paymentTs: UnixTs;
  /** After this, unclaimed funds can return to the issuer. */
  claimDeadlineTs: UnixTs;
  /** Paying vault PDA [b"vault", action] (paying kinds only; closed at settlement). */
  vault: Address | null;
  /** Settlement base units per held unit (coupon / final) or per redeemed unit (partial), fixed at announce. */
  amountPerUnit: bigint;
  /** sha256 of the announcement document. Hex. */
  termsHash: string;
  /** Slot pinned by `lock_record`. */
  recordSlot: number | null;
  /** Filled by `post_snapshot`. Hex, 32 bytes. */
  merkleRoot: string | null;
  /** sha256 of the canonical snapshot JSON. Hex. */
  snapshotHash: string | null;
  snapshotSlot: number | null;
  totalUnits: bigint | null;
  /** Bond supply the program observed when the snapshot was posted. */
  supplyAtRecord: bigint | null;
  holderCount: number | null;
  /** Units burned in total by a redemption (partial: Σ per-holder floors posted with the snapshot). */
  totalRedeemUnits: bigint | null;
  /** Total settlement owed, computed on-chain from params × totalUnits. 0 for votes. */
  totalEntitlement: bigint | null;
  fundedAmount: bigint;
  paidAmount: bigint;
  paidCount: number;
  /** Units burned so far (redemptions). */
  redeemedUnits: bigint;
  /** Unclaimed funds swept back to the issuer at settlement. */
  sweptAmount: bigint;
  /** On-chain tally per option (votes only), weights in bond units. */
  tally: bigint[] | null;
  /** Winning option recorded at settlement (strict plurality; null on a tie or before close). */
  winningOption: number | null;
  transitions: StatusTransition[];
};

export type Holding = { holder: Address; units: bigint };

/** A register entry as the issuer console shows it. `label` is off-chain directory data. */
export type RegisterEntry = Holding & {
  label?: string;
  custody?: "self" | "smart-wallet" | "custodian";
  /** Received units through Plain's primary allocation (a signed-in Plain user's smart wallet). */
  plainInvestor?: boolean;
};

export type Register = {
  mint: Address;
  slot: number;
  ts: UnixTs;
  supply: bigint;
  entries: RegisterEntry[];
};

/**
 * The canonical snapshot the indexer publishes at record date. Its sha256 is committed on-chain
 * (`snapshot_hash`) and its Merkle root is the `merkle_root` holders prove against.
 */
export type PublishedSnapshot = {
  version: 1;
  instrument: Address;
  mint: Address;
  action: Address;
  recordTs: UnixTs;
  slot: number;
  holdings: Holding[];
};

export type ClaimReceipt = {
  /** ClaimReceipt PDA [b"claim", action, holder]. */
  address: Address;
  action: Address;
  holder: Address;
  /** Snapshot units the payment was proven against. */
  units: bigint;
  amount: bigint;
  /** Units burned in the same instruction (redemptions). */
  burnedUnits: bigint;
  mode: "claim" | "push";
  slot: number;
  ts: UnixTs;
  signature: Signature;
};

export type VoteRecord = {
  /** VoteRecord PDA [b"vote", action, holder]. */
  address: Address;
  action: Address;
  holder: Address;
  choice: number;
  weight: bigint;
  slot: number;
  ts: UnixTs;
  signature: Signature;
};

export type MarketEventName =
  | "InstrumentCreated"
  | "UnitsIssued"
  | "ActionCancelled"
  | "InstrumentMatured"
  | "InstrumentRedeemed"
  | "ActionAnnounced"
  | "RecordLocked"
  | "SnapshotPosted"
  | "ActionFunded"
  | "EntitlementPaid"
  | "UnitsRedeemed"
  | "VoteCast"
  | "ActionSettled";

export type MarketEvent = {
  name: MarketEventName;
  action: Address | null;
  actionSeq: number | null;
  holder: Address | null;
  amount: bigint | null;
  units: bigint | null;
  detail: string;
  slot: number;
  ts: UnixTs;
  signature: Signature;
};

export type TxResult = { signature: Signature; slot: number; ts: UnixTs };

export type ActionDraft = {
  kind: ActionKind;
  recordTs: UnixTs;
  paymentTs: UnixTs;
  claimDeadlineTs: UnixTs;
  params: ActionParams;
};

export type EntitlementRow = {
  holder: Address;
  label?: string;
  /** A Plain retail investor's smart wallet (see `RegisterEntry.plainInvestor`). */
  plainInvestor?: boolean;
  units: bigint;
  /** Settlement owed (0 for votes). */
  amount: bigint;
  /** Units burned on payment (redemptions). */
  redeemUnits: bigint;
  /** Voting weight (votes), otherwise 0. */
  weight: bigint;
  receipt: ClaimReceipt | null;
  vote: VoteRecord | null;
};

export type EntitlementSheet = {
  source: "live-register" | "snapshot";
  rows: EntitlementRow[];
  totalUnits: bigint;
  totalAmount: bigint;
  totalRedeemUnits: bigint;
  /** Amount per single bond unit before rounding, in settlement base units (may be fractional for votes: 0). */
  perUnit: bigint;
};

export type CheckStatus = "pass" | "fail" | "pending";

/** An on-chain value a check relied on, with the account or transaction it was read from. */
export type Evidence = {
  label: string;
  value: string;
  address?: Address;
  signature?: Signature;
};

export type VerificationCheck = {
  id: string;
  title: string;
  status: CheckStatus;
  /** Plain-language explanation of what was compared and why it matters. */
  explanation: string;
  expected?: string;
  actual?: string;
  /** The exact on-chain values behind the check, each linkable to the explorer. */
  evidence?: Evidence[];
};

export type VerificationReport = {
  action: CorporateAction;
  instrument: Instrument;
  snapshot: PublishedSnapshot | null;
  /** Merkle root recomputed in this runtime. */
  recomputedRoot: string | null;
  recomputedHash: string | null;
  /** Where the snapshot came from (e.g. the memo of the post_snapshot transaction). */
  snapshotSource: Evidence | null;
  /** Merkle leaves in commitment order. */
  leaves: { holder: Address; units: bigint; hash: string }[] | null;
  entitlements: EntitlementSheet | null;
  checks: VerificationCheck[];
  verdict: "verified" | "mismatch" | "incomplete";
  computedAt: UnixTs;
};

export type LedgerSource = {
  cluster: "devnet" | "mainnet-beta" | "localnet";
  /** "chain" = live program accounts; "simulated" = in-browser ledger with the same rules. */
  kind: "chain" | "simulated";
  label: string;
};

/** Only the simulated ledger has these: its clock is moved by hand instead of by the cluster. */
export type SimulationControls = {
  advanceTo(ts: UnixTs): Promise<void>;
  reset(): Promise<void>;
};

/** What a backend must implement: raw program reads and instruction senders. */
export interface MarketsLedger {
  readonly source: LedgerSource;
  readonly simulation?: SimulationControls;
  /** Called whenever ledger state may have changed (new slot, account change, own transaction). */
  subscribe(listener: () => void): () => void;
  explorerTxUrl(signature: Signature): string | null;
  explorerAddressUrl(address: Address): string | null;
  /** Current unix time as the ledger sees it (cluster clock for chain backends). */
  now(): UnixTs;

  listInstruments(): Promise<Instrument[]>;
  getInstrument(mint: Address): Promise<Instrument | null>;
  listActions(mint: Address): Promise<CorporateAction[]>;
  getAction(actionId: Address): Promise<CorporateAction | null>;
  /** Live register (Token-2022 holders of the bond mint). */
  getRegister(mint: Address): Promise<Register>;
  /** Canonical snapshot published for an action, or null before `post_snapshot`. */
  getSnapshot(actionId: Address): Promise<PublishedSnapshot | null>;
  listReceipts(actionId: Address): Promise<ClaimReceipt[]>;
  listVotes(actionId: Address): Promise<VoteRecord[]>;
  listEvents(mint: Address): Promise<MarketEvent[]>;
  /**
   * Optional independent evidence for the verifier (chain backends): the register rebuilt from
   * every transaction that touched the instrument up to `slot`, where the published snapshot came
   * from, and the announcement document behind `terms_hash`.
   */
  registerAt?(mint: Address, slot: number, onProgress?: (done: number, total: number) => void): Promise<{ holdings: Holding[]; transactions: number; lastSignature: Signature | null }>;
  snapshotSource?(actionId: Address): Promise<Evidence | null>;
  termsDocument?(actionId: Address): Promise<{ text: string; signature: Signature } | null>;

  /** Issuer: create a CorporateAction (status Announced). */
  announce(mint: Address, draft: ActionDraft): Promise<TxResult & { actionId: Address }>;
  /** Anyone (crank) once the record date has passed: pins record supply and slot. */
  lockRecord(actionId: Address): Promise<TxResult>;
  /** Indexer: posts merkle root, total units and snapshot hash. */
  postSnapshot(actionId: Address): Promise<TxResult>;
  /** Issuer: deposits the outstanding total_entitlement into the action's paying vault. */
  fund(actionId: Address): Promise<TxResult>;
  /** Paying agent: push payment to one holder with its Merkle proof (status → Settling). */
  pay(actionId: Address, holder: Address): Promise<TxResult>;
  /** Holder: pull payment with its Merkle proof. */
  claim(actionId: Address, holder: Address): Promise<TxResult>;
  /** Holder: cast a vote weighted by snapshot units. */
  vote(actionId: Address, holder: Address, choice: number): Promise<TxResult>;
  /** Issuer: close the action once fully paid (or after the claim deadline / vote close). */
  settle(actionId: Address): Promise<TxResult>;
}

/** Everything the UI needs. */
export interface MarketsService extends MarketsLedger {
  /** Entitlements for a draft against the live register, before anything is announced. */
  previewEntitlements(mint: Address, draft: ActionDraft): Promise<EntitlementSheet>;
  /** Entitlements for an existing action: from its snapshot if posted, else from the live register. */
  getEntitlements(actionId: Address): Promise<EntitlementSheet>;
  /** Re-derive the action from public data and compare with on-chain values. */
  verifyAction(actionId: Address, options?: { snapshotOverride?: PublishedSnapshot }): Promise<VerificationReport>;
}
