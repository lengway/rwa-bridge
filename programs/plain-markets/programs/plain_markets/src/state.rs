use anchor_lang::prelude::*;

use crate::constants::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum InstrumentStatus {
    /// Trading and servicing normally.
    Active,
    /// Final redemption funded: principal is in the paying vault, the register is frozen for good.
    Matured,
    /// Every unit has been redeemed and burned (supply == 0).
    Redeemed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ActionKind {
    Coupon,
    PartialRedemption,
    FinalRedemption,
    Vote,
}

impl ActionKind {
    pub fn is_redemption(self) -> bool {
        matches!(self, ActionKind::PartialRedemption | ActionKind::FinalRedemption)
    }
    pub fn pays(self) -> bool {
        !matches!(self, ActionKind::Vote)
    }
}

/// Strict lifecycle. Votes skip `Funded`: SnapshotPosted opens voting, the first ballot moves the
/// action to `Settling`, and `settle` after the close closes the tally.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ActionStatus {
    Announced,
    RecordLocked,
    SnapshotPosted,
    Funded,
    Settling,
    Settled,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PaymentMode {
    /// Holder signed `claim`.
    Claim,
    /// Paying agent pushed with `pay` (custodial / retail smart wallets).
    Push,
}

/// One tokenized bond. PDA [b"instrument", mint]. It is the bond mint's mint authority, permanent
/// delegate, transfer-hook authority and metadata update authority.
#[account]
#[derive(InitSpace)]
pub struct Instrument {
    pub issuer: Pubkey,
    pub paying_agent: Pubkey,
    /// Token-2022 bond mint, 0 decimals.
    pub mint: Pubkey,
    pub settlement_mint: Pubkey,
    pub settlement_token_program: Pubkey,
    pub settlement_decimals: u8,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    /// ISO 6166 identifier, ASCII, zero padded (may be all zero on devnet).
    pub isin: [u8; 12],
    /// Par value of one bond unit in settlement base units.
    pub face_value: u64,
    /// Annual coupon rate in bps.
    pub coupon_bps: u16,
    /// Coupon payments per year (1, 2, 4, 12).
    pub coupon_frequency: u8,
    pub issue_ts: i64,
    pub maturity_ts: i64,
    pub status: InstrumentStatus,
    pub allowlist_enabled: bool,
    /// Ex-date lock window enforced by the transfer hook: transfers fail while
    /// lock_from <= now < lock_until.
    pub lock_from: i64,
    pub lock_until: i64,
    /// Units ever minted.
    pub issued_units: u64,
    /// Units burned by redemptions.
    pub redeemed_units: u64,
    /// Next action id.
    pub action_count: u64,
    /// Coupon periods announced so far (the next coupon is period coupon_periods + 1).
    pub coupon_periods: u16,
    /// Action that has not yet reached its payment phase (Funded, or SnapshotPosted for votes).
    pub pending_action: Option<u64>,
    /// Actions not yet Settled or Cancelled.
    pub open_actions: u32,
    /// A redemption is open: it runs alone.
    pub open_redemption: bool,
    pub created_ts: i64,
    pub bump: u8,
}

impl Instrument {
    pub fn is_locked(&self, now: i64) -> bool {
        self.lock_from <= now && now < self.lock_until
    }
}

/// One corporate action. PDA [b"action", instrument, id as u64 LE].
#[account]
#[derive(InitSpace)]
pub struct CorporateAction {
    pub instrument: Pubkey,
    pub id: u64,
    pub kind: ActionKind,
    pub status: ActionStatus,
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    /// sha256 of the off-chain announcement document (prospectus notice, vote question, ...).
    pub terms_hash: [u8; 32],
    pub record_ts: i64,
    /// Payment date, or vote close for votes.
    pub payment_ts: i64,
    /// After this the issuer may sweep unclaimed funds back.
    pub claim_deadline: i64,
    /// Coupon: annual rate for this period. FinalRedemption: rate of the final coupon (0 = none).
    pub rate_bps: u16,
    /// PartialRedemption: share of every holding redeemed.
    pub redeem_bps: u16,
    /// Redemptions: price in bps of face (10_000 = par).
    pub price_bps: u16,
    /// Coupon period number (1-based); 0 for other kinds.
    pub period: u16,
    #[max_len(MAX_VOTE_OPTIONS, MAX_OPTION_LEN)]
    pub options: Vec<String>,
    /// Settlement base units per unit: per held unit (Coupon, FinalRedemption) or per redeemed unit
    /// (PartialRedemption). Fixed at announcement.
    pub amount_per_unit: u64,

    // --- record date ---
    pub record_supply: u64,
    pub record_slot: u64,
    pub record_locked_ts: i64,

    // --- snapshot ---
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub total_units: u64,
    pub holder_count: u32,
    pub snapshot_slot: u64,
    /// Units that will be burned in total (redemptions).
    pub total_redeem_units: u64,
    /// Settlement owed to all holders; computed on-chain.
    pub total_entitlement: u64,

    // --- funding / payment ---
    pub funded_amount: u64,
    pub paid_amount: u64,
    pub paid_count: u32,
    pub claimed_units: u64,
    pub redeemed_units: u64,
    pub swept_amount: u64,

    // --- votes ---
    pub tally: [u64; MAX_VOTE_OPTIONS],
    pub votes_cast: u32,
    pub winning_option: Option<u8>,

    /// Lock window before this action merged into it (restored on cancel).
    pub prev_lock_from: i64,
    pub prev_lock_until: i64,

    pub announced_ts: i64,
    pub funded_ts: i64,
    pub settled_ts: i64,
    pub bump: u8,
}

/// Proof that a holder was paid for an action. PDA [b"claim", action, holder].
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub action: Pubkey,
    pub holder: Pubkey,
    pub units: u64,
    pub amount: u64,
    pub burned_units: u64,
    pub mode: PaymentMode,
    pub paid_by: Pubkey,
    pub slot: u64,
    pub ts: i64,
    pub bump: u8,
}

/// A holder's ballot. PDA [b"vote", action, holder].
#[account]
#[derive(InitSpace)]
pub struct VoteRecord {
    pub action: Pubkey,
    pub holder: Pubkey,
    pub choice: u8,
    pub weight: u64,
    pub slot: u64,
    pub ts: i64,
    pub bump: u8,
}

/// Wallet allowed to receive the bond when the allowlist is on. PDA [b"allow", instrument, wallet].
#[account]
#[derive(InitSpace)]
pub struct AllowEntry {
    pub instrument: Pubkey,
    pub wallet: Pubkey,
    pub added_ts: i64,
    pub bump: u8,
}

/// Primary offering of an instrument: fixed price, sale window and caps. PDA [b"offering", instrument].
/// It owns the proceeds vault [b"proceeds", instrument] in the settlement mint.
#[account]
#[derive(InitSpace)]
pub struct Offering {
    pub instrument: Pubkey,
    pub proceeds_vault: Pubkey,
    /// Settlement base units per bond unit. Fixed for the life of the offering.
    pub issue_price: u64,
    /// Sale window: start_ts <= now < end_ts.
    pub start_ts: i64,
    pub end_ts: i64,
    /// Units available for sale in total.
    pub cap_units: u64,
    /// Max units a wallet's bond account may hold after a purchase.
    pub per_holder_cap: u64,
    pub sold_units: u64,
    /// Settlement received from buyers (lifetime).
    pub proceeds: u64,
    pub withdrawn: u64,
    pub purchases: u32,
    pub closed: bool,
    pub created_ts: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Offering {
    pub fn is_open(&self, now: i64) -> bool {
        !self.closed && self.start_ts <= now && now < self.end_ts
    }
}
