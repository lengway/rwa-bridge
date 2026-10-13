use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, error::MarketsError, events::*, state::*};

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(
        mut,
        has_one = issuer @ MarketsError::NotIssuer,
        has_one = settlement_mint,
        constraint = instrument.settlement_token_program == settlement_token_program.key() @ MarketsError::InvalidSettlementAccount,
    )]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    /// Paying vault for this action, owned by the action PDA (created at announce).
    #[account(mut, seeds = [VAULT_SEED, action.key().as_ref()], bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = settlement_mint,
        token::authority = issuer,
        token::token_program = settlement_token_program,
    )]
    pub issuer_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
}

/// Deposit into the paying vault. Tranches are allowed; the action becomes `Funded` exactly when
/// the vault has received `total_entitlement`, and over-funding is rejected.
pub fn handle_fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let action = &ctx.accounts.action;
    require!(action.kind.pays(), MarketsError::WrongActionKind);
    require!(action.status == ActionStatus::SnapshotPosted, MarketsError::InvalidActionStatus);
    require!(amount > 0, MarketsError::ZeroFunding);
    let funded = action.funded_amount.checked_add(amount).ok_or(MarketsError::MathOverflow)?;
    require!(funded <= action.total_entitlement, MarketsError::OverFunding);

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.settlement_token_program.key(),
            TransferChecked {
                from: ctx.accounts.issuer_settlement.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.issuer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.settlement_mint.decimals,
    )?;

    let action = &mut ctx.accounts.action;
    action.funded_amount = funded;
    let fully_funded = funded == action.total_entitlement;
    if fully_funded {
        action.status = ActionStatus::Funded;
        action.funded_ts = now;
        let instrument = &mut ctx.accounts.instrument;
        instrument.pending_action = None;
        if action.kind == ActionKind::FinalRedemption {
            instrument.status = InstrumentStatus::Matured;
            emit!(InstrumentMatured { instrument: instrument.key(), action: action.key() });
        }
    }
    emit!(ActionFunded {
        instrument: action.instrument,
        action: action.key(),
        amount,
        funded_amount: funded,
        total_entitlement: action.total_entitlement,
        fully_funded,
    });
    Ok(())
}
