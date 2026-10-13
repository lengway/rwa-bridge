use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, error::MarketsError, events::*, state::*};

/// Closes an action.
/// - Votes: anyone, once voting has closed; records the winning option.
/// - Paying actions: anyone once every snapshot unit has been paid; otherwise only the issuer and
///   only after the claim deadline. Whatever is left in the paying vault goes back to the issuer
///   and the vault is closed.
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    /// CHECK: receives the vault's rent; must be the issuer.
    #[account(mut, address = instrument.issuer @ MarketsError::NotIssuer)]
    pub issuer: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_SEED, action.key().as_ref()], bump)]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        mut,
        token::mint = instrument.settlement_mint,
        token::authority = instrument.issuer,
        token::token_program = instrument.settlement_token_program,
    )]
    pub issuer_settlement: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(address = instrument.settlement_mint @ MarketsError::InvalidSettlementAccount)]
    pub settlement_mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    pub settlement_token_program: Option<Interface<'info, TokenInterface>>,
}

pub fn handle_settle(ctx: Context<Settle>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let a = ctx.accounts;
    let instrument_key = a.instrument.key();
    let action_key = a.action.key();

    if a.action.kind == ActionKind::Vote {
        require!(
            matches!(a.action.status, ActionStatus::SnapshotPosted | ActionStatus::Settling),
            MarketsError::InvalidActionStatus
        );
        require!(now >= a.action.payment_ts, MarketsError::VotingNotClosed);
        // Strict plurality; a tie (or no ballots) has no winner.
        let tally = a.action.tally;
        let n = a.action.options.len();
        let max = tally[..n].iter().copied().max().unwrap_or(0);
        let leaders = tally[..n].iter().filter(|&&t| t == max).count();
        a.action.winning_option =
            if max > 0 && leaders == 1 { tally[..n].iter().position(|&t| t == max).map(|i| i as u8) } else { None };
    } else {
        require!(
            matches!(a.action.status, ActionStatus::Funded | ActionStatus::Settling),
            MarketsError::ActionNotFunded
        );
        let fully_paid = a.action.claimed_units == a.action.total_units;
        if !fully_paid {
            require!(now >= a.action.claim_deadline, MarketsError::ClaimWindowOpen);
            require_keys_eq!(a.authority.key(), a.instrument.issuer, MarketsError::NotIssuer);
        }

        let (Some(vault), Some(issuer_settlement), Some(settlement_mint), Some(token_program)) = (
            a.vault.as_ref(),
            a.issuer_settlement.as_ref(),
            a.settlement_mint.as_ref(),
            a.settlement_token_program.as_ref(),
        ) else {
            return err!(MarketsError::MissingSettlementAccounts);
        };
        require_keys_eq!(
            token_program.key(),
            a.instrument.settlement_token_program,
            MarketsError::InvalidSettlementAccount
        );

        let id_bytes = a.action.id.to_le_bytes();
        let seeds: &[&[&[u8]]] = &[&[ACTION_SEED, instrument_key.as_ref(), &id_bytes, &[a.action.bump]]];
        let leftover = vault.amount;
        if leftover > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    token_program.key(),
                    TransferChecked {
                        from: vault.to_account_info(),
                        mint: settlement_mint.to_account_info(),
                        to: issuer_settlement.to_account_info(),
                        authority: a.action.to_account_info(),
                    },
                    seeds,
                ),
                leftover,
                settlement_mint.decimals,
            )?;
        }
        token_interface::close_account(CpiContext::new_with_signer(
            token_program.key(),
            CloseAccount {
                account: vault.to_account_info(),
                destination: a.issuer.to_account_info(),
                authority: a.action.to_account_info(),
            },
            seeds,
        ))?;
        a.action.swept_amount = leftover;

        // A settled partial redemption releases the register. A final redemption keeps it frozen:
        // any unclaimed units stay outstanding as a matured, untradeable liability.
        if a.action.kind == ActionKind::PartialRedemption {
            a.instrument.lock_until = now;
        }
        if a.action.kind.is_redemption() {
            a.instrument.open_redemption = false;
        }
    }

    a.action.status = ActionStatus::Settled;
    a.action.settled_ts = now;
    a.instrument.open_actions = a.instrument.open_actions.saturating_sub(1);

    emit!(ActionSettled {
        instrument: instrument_key,
        action: action_key,
        kind: a.action.kind,
        paid_amount: a.action.paid_amount,
        paid_count: a.action.paid_count,
        swept_amount: a.action.swept_amount,
        winning_option: a.action.winning_option,
    });
    Ok(())
}

/// Issuer withdraws an action before it reaches its payment phase. Any partial funding is
/// refunded and the ex-date lock it introduced is rolled back.
#[derive(Accounts)]
pub struct CancelAction<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(mut, has_one = issuer @ MarketsError::NotIssuer)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    #[account(mut, seeds = [VAULT_SEED, action.key().as_ref()], bump)]
    pub vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        mut,
        token::mint = instrument.settlement_mint,
        token::authority = issuer,
        token::token_program = instrument.settlement_token_program,
    )]
    pub issuer_settlement: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(address = instrument.settlement_mint @ MarketsError::InvalidSettlementAccount)]
    pub settlement_mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    pub settlement_token_program: Option<Interface<'info, TokenInterface>>,
}

pub fn handle_cancel_action(ctx: Context<CancelAction>) -> Result<()> {
    let a = ctx.accounts;
    let instrument_key = a.instrument.key();
    let action_key = a.action.key();
    let previous_status = a.action.status;

    match (a.action.kind, previous_status) {
        (_, ActionStatus::Announced | ActionStatus::RecordLocked) => {}
        (ActionKind::Vote, ActionStatus::SnapshotPosted) => {}
        (ActionKind::Vote, ActionStatus::Settling) => return err!(MarketsError::VotesAlreadyCast),
        (_, ActionStatus::SnapshotPosted) => {}
        _ => return err!(MarketsError::InvalidActionStatus),
    }

    let mut refunded = 0;
    if let Some(vault) = a.vault.as_ref() {
        let (Some(issuer_settlement), Some(settlement_mint), Some(token_program)) =
            (a.issuer_settlement.as_ref(), a.settlement_mint.as_ref(), a.settlement_token_program.as_ref())
        else {
            return err!(MarketsError::MissingSettlementAccounts);
        };
        require_keys_eq!(
            token_program.key(),
            a.instrument.settlement_token_program,
            MarketsError::InvalidSettlementAccount
        );
        let id_bytes = a.action.id.to_le_bytes();
        let seeds: &[&[&[u8]]] = &[&[ACTION_SEED, instrument_key.as_ref(), &id_bytes, &[a.action.bump]]];
        refunded = vault.amount;
        if refunded > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    token_program.key(),
                    TransferChecked {
                        from: vault.to_account_info(),
                        mint: settlement_mint.to_account_info(),
                        to: issuer_settlement.to_account_info(),
                        authority: a.action.to_account_info(),
                    },
                    seeds,
                ),
                refunded,
                settlement_mint.decimals,
            )?;
        }
        token_interface::close_account(CpiContext::new_with_signer(
            token_program.key(),
            CloseAccount {
                account: vault.to_account_info(),
                destination: a.issuer.to_account_info(),
                authority: a.action.to_account_info(),
            },
            seeds,
        ))?;
    } else {
        require!(!a.action.kind.pays(), MarketsError::MissingSettlementAccounts);
    }

    let instrument = &mut a.instrument;
    instrument.lock_from = a.action.prev_lock_from;
    instrument.lock_until = a.action.prev_lock_until;
    if instrument.pending_action == Some(a.action.id) {
        instrument.pending_action = None;
    }
    instrument.open_actions = instrument.open_actions.saturating_sub(1);
    if a.action.kind.is_redemption() {
        instrument.open_redemption = false;
    }
    if a.action.kind == ActionKind::Coupon && instrument.coupon_periods == a.action.period {
        instrument.coupon_periods -= 1;
    }

    a.action.status = ActionStatus::Cancelled;
    a.action.settled_ts = Clock::get()?.unix_timestamp;
    emit!(ActionCancelled { instrument: instrument_key, action: action_key, previous_status, refunded_amount: refunded });
    Ok(())
}
