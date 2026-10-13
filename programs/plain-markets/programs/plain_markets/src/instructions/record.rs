use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{constants::*, error::MarketsError, events::*, math, state::*};

/// Permissionless crank at/after the record date. The transfer hook already rejects transfers from
/// `record_ts`; this transition pins the supply and slot the snapshot must reconcile with.
#[derive(Accounts)]
pub struct LockRecord<'info> {
    pub cranker: Signer<'info>,
    #[account(has_one = mint)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle_lock_record(ctx: Context<LockRecord>) -> Result<()> {
    let clock = Clock::get()?;
    let action = &mut ctx.accounts.action;
    require!(action.status == ActionStatus::Announced, MarketsError::InvalidActionStatus);
    require!(clock.unix_timestamp >= action.record_ts, MarketsError::RecordDateNotReached);
    require!(clock.unix_timestamp < action.payment_ts, MarketsError::RecordWindowMissed);

    action.status = ActionStatus::RecordLocked;
    action.record_supply = ctx.accounts.mint.supply;
    action.record_slot = clock.slot;
    action.record_locked_ts = clock.unix_timestamp;
    emit!(RecordLocked {
        instrument: action.instrument,
        action: action.key(),
        record_supply: action.record_supply,
        record_slot: action.record_slot,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SnapshotParams {
    pub merkle_root: [u8; 32],
    /// sha256 of the canonical snapshot JSON published off-chain.
    pub snapshot_hash: [u8; 32],
    pub total_units: u64,
    pub holder_count: u32,
    /// PartialRedemption: sum of per-holder floor(units * redeem_bps / 10_000). Ignored otherwise.
    pub total_redeem_units: u64,
}

#[derive(Accounts)]
pub struct PostSnapshot<'info> {
    pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer @ MarketsError::NotIssuer, has_one = mint)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle_post_snapshot(ctx: Context<PostSnapshot>, p: SnapshotParams) -> Result<()> {
    let clock = Clock::get()?;
    let supply = ctx.accounts.mint.supply;
    let action = &mut ctx.accounts.action;
    require!(action.status == ActionStatus::RecordLocked, MarketsError::InvalidActionStatus);
    require!(p.merkle_root != [0u8; 32], MarketsError::InvalidSnapshotRoot);
    // Issuance is paused while the action is pending, so supply == record supply; check both.
    require!(p.total_units == supply && p.total_units == action.record_supply, MarketsError::SupplyMismatch);
    require!(p.holder_count >= 1 && (p.holder_count as u64) <= p.total_units, MarketsError::InvalidHolderCount);

    let (total_redeem_units, total_entitlement) = match action.kind {
        ActionKind::Coupon => (0, p.total_units.checked_mul(action.amount_per_unit).ok_or(MarketsError::MathOverflow)?),
        ActionKind::FinalRedemption => (
            p.total_units,
            p.total_units.checked_mul(action.amount_per_unit).ok_or(MarketsError::MathOverflow)?,
        ),
        ActionKind::PartialRedemption => {
            let (min, max) = math::partial_redeem_bounds(p.total_units, action.redeem_bps, p.holder_count)
                .ok_or(MarketsError::MathOverflow)?;
            require!(
                p.total_redeem_units >= min && p.total_redeem_units <= max,
                MarketsError::RedeemTotalOutOfBounds
            );
            (
                p.total_redeem_units,
                p.total_redeem_units.checked_mul(action.amount_per_unit).ok_or(MarketsError::MathOverflow)?,
            )
        }
        ActionKind::Vote => (0, 0),
    };
    if action.kind.pays() {
        require!(total_entitlement > 0, MarketsError::ZeroEntitlement);
    }

    action.merkle_root = p.merkle_root;
    action.snapshot_hash = p.snapshot_hash;
    action.total_units = p.total_units;
    action.holder_count = p.holder_count;
    action.snapshot_slot = clock.slot;
    action.total_redeem_units = total_redeem_units;
    action.total_entitlement = total_entitlement;
    action.status = ActionStatus::SnapshotPosted;

    // Votes enter their active phase now; paying actions stay pending until fully funded.
    if action.kind == ActionKind::Vote {
        ctx.accounts.instrument.pending_action = None;
    }

    emit!(SnapshotPosted {
        instrument: action.instrument,
        action: action.key(),
        merkle_root: p.merkle_root,
        snapshot_hash: p.snapshot_hash,
        total_units: p.total_units,
        holder_count: p.holder_count,
        total_redeem_units,
        total_entitlement,
    });
    Ok(())
}
