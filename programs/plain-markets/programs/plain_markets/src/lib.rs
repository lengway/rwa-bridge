//! Plain Markets — on-chain servicing engine for tokenized bonds.
//!
//! The program owns the corporate-action lifecycle of a Token-2022 bond:
//! announce → record (ex-date lock via transfer hook) → snapshot (Merkle root reconciled with
//! supply) → fund (exact entitlement into a per-action paying vault) → claim / pay with a Merkle
//! proof (DvP burn for redemptions) → settle. Primary sales run through a fixed-price offering whose
//! `subscribe` is delivery versus payment. Votes reuse the snapshot for weights.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("H87kwrjtpNKxqbydmjW7ytnX7Jum7RramAaiyc82XMVm");

#[program]
pub mod plain_markets {
    use super::*;

    /// Create the instrument and its Token-2022 bond mint (hook + permanent delegate + metadata).
    pub fn initialize_instrument(ctx: Context<InitializeInstrument>, params: InstrumentParams) -> Result<()> {
        instructions::initialize_instrument::handle_initialize_instrument(ctx, params)
    }

    pub fn set_allowlist(ctx: Context<IssuerOnly>, enabled: bool) -> Result<()> {
        instructions::admin::handle_set_allowlist(ctx, enabled)
    }

    pub fn set_paying_agent(ctx: Context<IssuerOnly>, paying_agent: Pubkey) -> Result<()> {
        instructions::admin::handle_set_paying_agent(ctx, paying_agent)
    }

    pub fn allow_holder(ctx: Context<AllowHolder>, wallet: Pubkey) -> Result<()> {
        instructions::admin::handle_allow_holder(ctx, wallet)
    }

    pub fn disallow_holder(ctx: Context<DisallowHolder>) -> Result<()> {
        instructions::admin::handle_disallow_holder(ctx)
    }

    /// Mint bond units to a holder (primary placement).
    pub fn issue(ctx: Context<Issue>, units: u64) -> Result<()> {
        instructions::issue::handle_issue(ctx, units)
    }

    /// Open the primary offering: fixed price, sale window, caps, proceeds vault.
    pub fn open_offering(ctx: Context<OpenOffering>, params: OfferingParams) -> Result<()> {
        instructions::offering::handle_open_offering(ctx, params)
    }

    /// Delivery versus payment: buyer pays units × issue_price into the proceeds vault and
    /// receives the units in the same instruction.
    pub fn subscribe(ctx: Context<Subscribe>, units: u64, max_payment: u64) -> Result<()> {
        instructions::offering::handle_subscribe(ctx, units, max_payment)
    }

    pub fn withdraw_proceeds(ctx: Context<WithdrawProceeds>, amount: u64) -> Result<()> {
        instructions::offering::handle_withdraw_proceeds(ctx, amount)
    }

    pub fn close_offering(ctx: Context<CloseOffering>) -> Result<()> {
        instructions::offering::handle_close_offering(ctx)
    }

    pub fn announce(ctx: Context<Announce>, params: AnnounceParams) -> Result<()> {
        instructions::announce::handle_announce(ctx, params)
    }

    pub fn lock_record(ctx: Context<LockRecord>) -> Result<()> {
        instructions::record::handle_lock_record(ctx)
    }

    pub fn post_snapshot(ctx: Context<PostSnapshot>, params: SnapshotParams) -> Result<()> {
        instructions::record::handle_post_snapshot(ctx, params)
    }

    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        instructions::fund::handle_fund(ctx, amount)
    }

    pub fn claim(ctx: Context<Claim>, units: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        instructions::payment::handle_claim(ctx, units, proof)
    }

    pub fn pay(ctx: Context<Pay>, units: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        instructions::payment::handle_pay(ctx, units, proof)
    }

    pub fn cast_vote(ctx: Context<CastVote>, units: u64, proof: Vec<[u8; 32]>, choice: u8) -> Result<()> {
        instructions::vote::handle_cast_vote(ctx, units, proof, choice)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handle_settle(ctx)
    }

    pub fn cancel_action(ctx: Context<CancelAction>) -> Result<()> {
        instructions::settle::handle_cancel_action(ctx)
    }

    /// SPL transfer-hook `Execute`, invoked by Token-2022 on every bond transfer.
    #[instruction(discriminator = &TRANSFER_HOOK_EXECUTE_DISCRIMINATOR)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        instructions::transfer_hook::handle_transfer_hook(ctx, amount)
    }
}
