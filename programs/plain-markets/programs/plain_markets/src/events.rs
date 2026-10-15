use anchor_lang::prelude::*;

use crate::state::{ActionKind, ActionStatus, PaymentMode};

#[event]
pub struct InstrumentCreated {
    pub instrument: Pubkey,
    pub mint: Pubkey,
    pub issuer: Pubkey,
    pub settlement_mint: Pubkey,
    pub face_value: u64,
    pub coupon_bps: u16,
    pub coupon_frequency: u8,
    pub maturity_ts: i64,
    pub allowlist_enabled: bool,
}

#[event]
pub struct UnitsIssued {
    pub instrument: Pubkey,
    pub holder: Pubkey,
    pub units: u64,
    pub supply: u64,
}

#[event]
pub struct AllowlistUpdated {
    pub instrument: Pubkey,
    pub wallet: Pubkey,
    pub allowed: bool,
}

#[event]
pub struct AllowlistToggled {
    pub instrument: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct PayingAgentUpdated {
    pub instrument: Pubkey,
    pub paying_agent: Pubkey,
}

#[event]
pub struct ActionAnnounced {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub id: u64,
    pub kind: ActionKind,
    pub record_ts: i64,
    pub payment_ts: i64,
    pub claim_deadline: i64,
    pub amount_per_unit: u64,
    pub lock_from: i64,
    pub lock_until: i64,
}

#[event]
pub struct RecordLocked {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub record_supply: u64,
    pub record_slot: u64,
}

#[event]
pub struct SnapshotPosted {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub total_units: u64,
    pub holder_count: u32,
    pub total_redeem_units: u64,
    pub total_entitlement: u64,
}

#[event]
pub struct ActionFunded {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub amount: u64,
    pub funded_amount: u64,
    pub total_entitlement: u64,
    /// True once funded_amount == total_entitlement (status Funded).
    pub fully_funded: bool,
}

#[event]
pub struct EntitlementPaid {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub holder: Pubkey,
    pub units: u64,
    pub amount: u64,
    pub burned_units: u64,
    pub mode: PaymentMode,
    pub paid_by: Pubkey,
}

#[event]
pub struct UnitsRedeemed {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub holder: Pubkey,
    pub units: u64,
    pub supply_after: u64,
}

#[event]
pub struct VoteCast {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub holder: Pubkey,
    pub choice: u8,
    pub weight: u64,
}

#[event]
pub struct ActionSettled {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub kind: ActionKind,
    pub paid_amount: u64,
    pub paid_count: u32,
    pub swept_amount: u64,
    pub winning_option: Option<u8>,
}

#[event]
pub struct ActionCancelled {
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub previous_status: ActionStatus,
    pub refunded_amount: u64,
}

#[event]
pub struct InstrumentMatured {
    pub instrument: Pubkey,
    pub action: Pubkey,
}

#[event]
pub struct InstrumentRedeemed {
    pub instrument: Pubkey,
    pub action: Pubkey,
}

#[event]
pub struct OfferingOpened {
    pub instrument: Pubkey,
    pub offering: Pubkey,
    pub proceeds_vault: Pubkey,
    pub issue_price: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub cap_units: u64,
    pub per_holder_cap: u64,
}

/// Delivery-versus-payment primary purchase: `amount` moved buyer -> proceeds vault and `units`
/// were minted to the buyer in the same instruction.
#[event]
pub struct UnitsSubscribed {
    pub instrument: Pubkey,
    pub offering: Pubkey,
    pub buyer: Pubkey,
    pub units: u64,
    pub issue_price: u64,
    pub amount: u64,
    pub sold_units: u64,
    pub supply: u64,
}

#[event]
pub struct ProceedsWithdrawn {
    pub instrument: Pubkey,
    pub offering: Pubkey,
    pub amount: u64,
    pub withdrawn_total: u64,
}

#[event]
pub struct OfferingClosed {
    pub instrument: Pubkey,
    pub offering: Pubkey,
    pub sold_units: u64,
    pub proceeds: u64,
}
