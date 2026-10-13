use anchor_lang::prelude::*;

use crate::{constants::*, error::MarketsError, events::VoteCast, math, state::*};

#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    pub instrument: Account<'info, Instrument>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Account<'info, CorporateAction>,
    #[account(
        init_if_needed,
        payer = holder,
        space = 8 + VoteRecord::INIT_SPACE,
        seeds = [VOTE_SEED, action.key().as_ref(), holder.key().as_ref()],
        bump,
    )]
    pub vote_record: Account<'info, VoteRecord>,
    pub system_program: Program<'info, System>,
}

/// Ballot weighted by the holder's snapshot units, proven against the action's Merkle root.
pub fn handle_cast_vote(ctx: Context<CastVote>, units: u64, proof: Vec<[u8; 32]>, choice: u8) -> Result<()> {
    let clock = Clock::get()?;
    let action_key = ctx.accounts.action.key();
    let holder = ctx.accounts.holder.key();
    let action = &mut ctx.accounts.action;

    require!(action.kind == ActionKind::Vote, MarketsError::WrongActionKind);
    require!(
        matches!(action.status, ActionStatus::SnapshotPosted | ActionStatus::Settling),
        MarketsError::InvalidActionStatus
    );
    require!(clock.unix_timestamp < action.payment_ts, MarketsError::VotingClosed);
    require!(ctx.accounts.vote_record.action == Pubkey::default(), MarketsError::AlreadyVoted);
    require!((choice as usize) < action.options.len(), MarketsError::InvalidVoteChoice);
    require!(units > 0, MarketsError::ZeroUnits);
    require!(proof.len() <= MAX_PROOF_LEN as usize, MarketsError::ProofTooLong);
    let leaf = math::leaf_hash(&action_key.to_bytes(), &holder.to_bytes(), units);
    require!(math::verify_proof(leaf, &proof, &action.merkle_root), MarketsError::InvalidProof);

    let claimed_units = action.claimed_units.checked_add(units).ok_or(MarketsError::MathOverflow)?;
    let votes_cast = action.votes_cast.checked_add(1).ok_or(MarketsError::MathOverflow)?;
    require!(
        claimed_units <= action.total_units && votes_cast <= action.holder_count,
        MarketsError::SnapshotTotalsExceeded
    );

    let slot = &mut action.tally[choice as usize];
    *slot = slot.checked_add(units).ok_or(MarketsError::MathOverflow)?;
    action.claimed_units = claimed_units;
    action.votes_cast = votes_cast;
    action.status = ActionStatus::Settling;

    ctx.accounts.vote_record.set_inner(VoteRecord {
        action: action_key,
        holder,
        choice,
        weight: units,
        slot: clock.slot,
        ts: clock.unix_timestamp,
        bump: ctx.bumps.vote_record,
    });
    emit!(VoteCast { instrument: action.instrument, action: action_key, holder, choice, weight: units });
    Ok(())
}
