use anchor_lang::prelude::*;

use crate::{constants::*, error::MarketsError, events::*, state::*};

#[derive(Accounts)]
pub struct IssuerOnly<'info> {
    pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer @ MarketsError::NotIssuer)]
    pub instrument: Account<'info, Instrument>,
}

pub fn handle_set_allowlist(ctx: Context<IssuerOnly>, enabled: bool) -> Result<()> {
    let instrument = &mut ctx.accounts.instrument;
    instrument.allowlist_enabled = enabled;
    emit!(AllowlistToggled { instrument: instrument.key(), enabled });
    Ok(())
}

pub fn handle_set_paying_agent(ctx: Context<IssuerOnly>, paying_agent: Pubkey) -> Result<()> {
    let instrument = &mut ctx.accounts.instrument;
    instrument.paying_agent = paying_agent;
    emit!(PayingAgentUpdated { instrument: instrument.key(), paying_agent });
    Ok(())
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct AllowHolder<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(has_one = issuer @ MarketsError::NotIssuer)]
    pub instrument: Account<'info, Instrument>,
    #[account(
        init,
        payer = issuer,
        space = 8 + AllowEntry::INIT_SPACE,
        seeds = [ALLOW_SEED, instrument.key().as_ref(), wallet.as_ref()],
        bump,
    )]
    pub allow_entry: Account<'info, AllowEntry>,
    pub system_program: Program<'info, System>,
}

pub fn handle_allow_holder(ctx: Context<AllowHolder>, wallet: Pubkey) -> Result<()> {
    ctx.accounts.allow_entry.set_inner(AllowEntry {
        instrument: ctx.accounts.instrument.key(),
        wallet,
        added_ts: Clock::get()?.unix_timestamp,
        bump: ctx.bumps.allow_entry,
    });
    emit!(AllowlistUpdated { instrument: ctx.accounts.instrument.key(), wallet, allowed: true });
    Ok(())
}

#[derive(Accounts)]
pub struct DisallowHolder<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(has_one = issuer @ MarketsError::NotIssuer)]
    pub instrument: Account<'info, Instrument>,
    #[account(
        mut,
        close = issuer,
        has_one = instrument,
        seeds = [ALLOW_SEED, instrument.key().as_ref(), allow_entry.wallet.as_ref()],
        bump = allow_entry.bump,
    )]
    pub allow_entry: Account<'info, AllowEntry>,
}

pub fn handle_disallow_holder(ctx: Context<DisallowHolder>) -> Result<()> {
    emit!(AllowlistUpdated {
        instrument: ctx.accounts.instrument.key(),
        wallet: ctx.accounts.allow_entry.wallet,
        allowed: false,
    });
    Ok(())
}
