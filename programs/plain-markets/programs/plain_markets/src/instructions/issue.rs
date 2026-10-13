use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{self, MintTo, Token2022},
    token_interface::{Mint, TokenAccount},
};

use crate::{constants::*, error::MarketsError, events::UnitsIssued, state::*};

#[derive(Accounts)]
pub struct Issue<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer @ MarketsError::NotIssuer, has_one = mint)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(mut, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: any wallet (keypair or smart-wallet PDA) receiving the units.
    pub holder: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = issuer,
        associated_token::mint = mint,
        associated_token::authority = holder,
        associated_token::token_program = token_program,
    )]
    pub holder_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Required when the allowlist is on.
    #[account(
        seeds = [ALLOW_SEED, instrument.key().as_ref(), holder.key().as_ref()],
        bump = allow_entry.bump,
    )]
    pub allow_entry: Option<Account<'info, AllowEntry>>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_issue(ctx: Context<Issue>, units: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let instrument = &ctx.accounts.instrument;
    require!(units > 0, MarketsError::ZeroUnits);
    require!(instrument.status == InstrumentStatus::Active, MarketsError::InstrumentNotActive);
    // The register must not change while an action is being recorded or a redemption is open.
    require!(instrument.pending_action.is_none(), MarketsError::PendingActionExists);
    require!(!instrument.open_redemption, MarketsError::RedemptionInProgress);
    require!(!instrument.is_locked(now), MarketsError::RegisterLocked);
    if instrument.allowlist_enabled {
        require!(ctx.accounts.allow_entry.is_some(), MarketsError::AllowlistEntryRequired);
    }

    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[INSTRUMENT_SEED, mint_key.as_ref(), &[instrument.bump]]];
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_2022::ID,
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.holder_token.to_account_info(),
                authority: ctx.accounts.instrument.to_account_info(),
            },
            signer_seeds,
        ),
        units,
    )?;

    let instrument = &mut ctx.accounts.instrument;
    instrument.issued_units = instrument.issued_units.checked_add(units).ok_or(MarketsError::MathOverflow)?;
    ctx.accounts.mint.reload()?;
    emit!(UnitsIssued {
        instrument: instrument.key(),
        holder: ctx.accounts.holder.key(),
        units,
        supply: ctx.accounts.mint.supply,
    });
    Ok(())
}
