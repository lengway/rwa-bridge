use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{constants::*, error::MarketsError, events::ActionAnnounced, math, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AnnounceParams {
    pub kind: ActionKind,
    pub title: String,
    pub terms_hash: [u8; 32],
    pub record_ts: i64,
    pub payment_ts: i64,
    pub claim_deadline: i64,
    /// Coupon: annual rate (0 = instrument rate). FinalRedemption: final coupon rate (0 = none).
    pub rate_bps: u16,
    /// PartialRedemption only.
    pub redeem_bps: u16,
    /// Redemptions only (10_000 = par).
    pub price_bps: u16,
    /// Vote only.
    pub options: Vec<String>,
}

#[derive(Accounts)]
pub struct Announce<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer @ MarketsError::NotIssuer)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        init,
        payer = issuer,
        space = 8 + CorporateAction::INIT_SPACE,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &instrument.action_count.to_le_bytes()],
        bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    /// Paying vault [b"vault", action], owned by the action PDA. Required for paying actions,
    /// omitted for votes.
    #[account(
        init,
        payer = issuer,
        seeds = [VAULT_SEED, action.key().as_ref()],
        bump,
        token::mint = settlement_mint,
        token::authority = action,
        token::token_program = settlement_token_program,
    )]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(address = instrument.settlement_mint @ MarketsError::InvalidSettlementAccount)]
    pub settlement_mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(address = instrument.settlement_token_program @ MarketsError::InvalidSettlementAccount)]
    pub settlement_token_program: Option<Interface<'info, TokenInterface>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_announce(ctx: Context<Announce>, p: AnnounceParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let instrument = &ctx.accounts.instrument;

    require!(instrument.status == InstrumentStatus::Active, MarketsError::InstrumentNotActive);
    require!(instrument.pending_action.is_none(), MarketsError::PendingActionExists);
    require!(!instrument.open_redemption, MarketsError::RedemptionInProgress);
    if p.kind.is_redemption() {
        require!(instrument.open_actions == 0, MarketsError::ActionsStillOpen);
    }
    require!(!p.title.is_empty() && p.title.len() <= MAX_TITLE_LEN, MarketsError::InvalidTitle);
    require!(
        now <= p.record_ts && p.record_ts < p.payment_ts && p.payment_ts <= p.claim_deadline,
        MarketsError::InvalidSchedule
    );

    require!(ctx.accounts.vault.is_some() == p.kind.pays(), MarketsError::MissingSettlementAccounts);

    let face = instrument.face_value;
    let freq = instrument.coupon_frequency;
    let (rate_bps, period, amount_per_unit) = match p.kind {
        ActionKind::Coupon => {
            require!(p.redeem_bps == 0 && p.price_bps == 0 && p.options.is_empty(), MarketsError::UnexpectedParameter);
            let rate = if p.rate_bps == 0 { instrument.coupon_bps } else { p.rate_bps };
            require!(rate > 0 && rate <= MAX_RATE_BPS, MarketsError::InvalidRate);
            let per_unit = math::coupon_per_unit(face, rate, freq).ok_or(MarketsError::MathOverflow)?;
            let period = instrument.coupon_periods.checked_add(1).ok_or(MarketsError::MathOverflow)?;
            (rate, period, per_unit)
        }
        ActionKind::PartialRedemption => {
            require!(p.rate_bps == 0 && p.options.is_empty(), MarketsError::UnexpectedParameter);
            require!(p.redeem_bps > 0 && p.redeem_bps < 10_000, MarketsError::InvalidRedeemShare);
            require!(p.price_bps > 0 && p.price_bps <= MAX_PRICE_BPS, MarketsError::InvalidPrice);
            (0, 0, math::price_per_unit(face, p.price_bps).ok_or(MarketsError::MathOverflow)?)
        }
        ActionKind::FinalRedemption => {
            require!(p.redeem_bps == 0 && p.options.is_empty(), MarketsError::UnexpectedParameter);
            require!(p.price_bps > 0 && p.price_bps <= MAX_PRICE_BPS, MarketsError::InvalidPrice);
            require!(p.rate_bps <= MAX_RATE_BPS, MarketsError::InvalidRate);
            let per_unit = math::final_per_unit(face, p.price_bps, p.rate_bps, freq).ok_or(MarketsError::MathOverflow)?;
            (p.rate_bps, 0, per_unit)
        }
        ActionKind::Vote => {
            require!(p.rate_bps == 0 && p.redeem_bps == 0 && p.price_bps == 0, MarketsError::UnexpectedParameter);
            require!(
                (2..=MAX_VOTE_OPTIONS).contains(&p.options.len())
                    && p.options.iter().all(|o| !o.is_empty() && o.len() <= MAX_OPTION_LEN),
                MarketsError::InvalidVoteOptions
            );
            (0, 0, 0)
        }
    };

    // Ex-date lock: transfers are rejected from the record date. Coupons and votes unlock at the
    // payment date (the snapshot already fixed entitlements); redemptions keep the register
    // locked until settlement because units are burned on payment. A lock that is still running
    // is extended rather than replaced; the new record date must fall inside it so that the
    // single [lock_from, lock_until) window never covers a gap between two actions.
    let lock_until = if p.kind.is_redemption() { i64::MAX } else { p.payment_ts };
    let (prev_from, prev_until) = (instrument.lock_from, instrument.lock_until);
    let (new_from, new_until) = if now < prev_until {
        require!(p.record_ts <= prev_until, MarketsError::LockStillRunning);
        (prev_from.min(p.record_ts), prev_until.max(lock_until))
    } else {
        (p.record_ts, lock_until)
    };

    let instrument_key = instrument.key();
    let id = instrument.action_count;
    let action_key = ctx.accounts.action.key();
    ctx.accounts.action.set_inner(CorporateAction {
        instrument: instrument_key,
        id,
        kind: p.kind,
        status: ActionStatus::Announced,
        title: p.title,
        terms_hash: p.terms_hash,
        record_ts: p.record_ts,
        payment_ts: p.payment_ts,
        claim_deadline: p.claim_deadline,
        rate_bps,
        redeem_bps: p.redeem_bps,
        price_bps: p.price_bps,
        period,
        options: p.options,
        amount_per_unit,
        record_supply: 0,
        record_slot: 0,
        record_locked_ts: 0,
        merkle_root: [0; 32],
        snapshot_hash: [0; 32],
        total_units: 0,
        holder_count: 0,
        snapshot_slot: 0,
        total_redeem_units: 0,
        total_entitlement: 0,
        funded_amount: 0,
        paid_amount: 0,
        paid_count: 0,
        claimed_units: 0,
        redeemed_units: 0,
        swept_amount: 0,
        tally: [0; MAX_VOTE_OPTIONS],
        votes_cast: 0,
        winning_option: None,
        prev_lock_from: prev_from,
        prev_lock_until: prev_until,
        announced_ts: now,
        funded_ts: 0,
        settled_ts: 0,
        bump: ctx.bumps.action,
    });

    let instrument = &mut ctx.accounts.instrument;
    instrument.action_count = id.checked_add(1).ok_or(MarketsError::MathOverflow)?;
    instrument.pending_action = Some(id);
    instrument.open_actions = instrument.open_actions.checked_add(1).ok_or(MarketsError::MathOverflow)?;
    instrument.open_redemption = p.kind.is_redemption();
    instrument.lock_from = new_from;
    instrument.lock_until = new_until;
    if p.kind == ActionKind::Coupon {
        instrument.coupon_periods = period;
    }

    emit!(ActionAnnounced {
        instrument: instrument_key,
        action: action_key,
        id,
        kind: p.kind,
        record_ts: p.record_ts,
        payment_ts: p.payment_ts,
        claim_deadline: p.claim_deadline,
        amount_per_unit,
        lock_from: new_from,
        lock_until: new_until,
    });
    Ok(())
}
