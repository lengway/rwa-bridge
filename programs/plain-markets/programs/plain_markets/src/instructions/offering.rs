use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{self, MintTo, Token2022},
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{constants::*, error::MarketsError, events::*, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OfferingParams {
    /// Settlement base units per bond unit.
    pub issue_price: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub cap_units: u64,
    pub per_holder_cap: u64,
}

#[derive(Accounts)]
pub struct OpenOffering<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(
        has_one = issuer @ MarketsError::NotIssuer,
        has_one = settlement_mint,
        constraint = instrument.settlement_token_program == settlement_token_program.key() @ MarketsError::InvalidSettlementAccount,
    )]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Offering::INIT_SPACE,
        seeds = [OFFERING_SEED, instrument.key().as_ref()],
        bump,
    )]
    pub offering: Box<Account<'info, Offering>>,
    #[account(
        init,
        payer = issuer,
        seeds = [PROCEEDS_SEED, instrument.key().as_ref()],
        bump,
        token::mint = settlement_mint,
        token::authority = offering,
        token::token_program = settlement_token_program,
    )]
    pub proceeds_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_offering(ctx: Context<OpenOffering>, params: OfferingParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let instrument = &ctx.accounts.instrument;
    require!(instrument.status == InstrumentStatus::Active, MarketsError::InstrumentNotActive);
    require!(
        params.issue_price > 0
            && params.start_ts < params.end_ts
            && params.end_ts > now
            && params.end_ts <= instrument.maturity_ts
            && params.cap_units > 0
            && params.per_holder_cap > 0
            && params.per_holder_cap <= params.cap_units,
        MarketsError::InvalidOfferingParams
    );
    // The full offering must be payable without overflow.
    params.cap_units.checked_mul(params.issue_price).ok_or(MarketsError::MathOverflow)?;

    let offering = &mut ctx.accounts.offering;
    offering.set_inner(Offering {
        instrument: instrument.key(),
        proceeds_vault: ctx.accounts.proceeds_vault.key(),
        issue_price: params.issue_price,
        start_ts: params.start_ts,
        end_ts: params.end_ts,
        cap_units: params.cap_units,
        per_holder_cap: params.per_holder_cap,
        sold_units: 0,
        proceeds: 0,
        withdrawn: 0,
        purchases: 0,
        closed: false,
        created_ts: now,
        bump: ctx.bumps.offering,
        vault_bump: ctx.bumps.proceeds_vault,
    });
    emit!(OfferingOpened {
        instrument: instrument.key(),
        offering: offering.key(),
        proceeds_vault: offering.proceeds_vault,
        issue_price: params.issue_price,
        start_ts: params.start_ts,
        end_ts: params.end_ts,
        cap_units: params.cap_units,
        per_holder_cap: params.per_holder_cap,
    });
    Ok(())
}

/// Delivery versus payment: the buyer's settlement tokens move into the proceeds vault and the bond
/// units are minted to the buyer's associated bond account in one instruction, so either both legs
/// happen or neither does. The buyer only signs as token authority; it pays no lamports here (bond
/// and settlement token accounts must already exist, e.g. via idempotent ATA creation).
#[derive(Accounts)]
pub struct Subscribe<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        has_one = mint,
        has_one = settlement_mint,
        constraint = instrument.settlement_token_program == settlement_token_program.key() @ MarketsError::InvalidSettlementAccount,
    )]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        has_one = proceeds_vault,
        seeds = [OFFERING_SEED, instrument.key().as_ref()],
        bump = offering.bump,
    )]
    pub offering: Box<Account<'info, Offering>>,
    #[account(mut, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// The buyer's canonical bond account (Token-2022 ATA).
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_bond: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = settlement_mint,
        token::authority = buyer,
        token::token_program = settlement_token_program,
    )]
    pub buyer_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [PROCEEDS_SEED, instrument.key().as_ref()], bump = offering.vault_bump)]
    pub proceeds_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    /// Required when the allowlist is on (same rule as `issue`: no auto-allow).
    #[account(
        seeds = [ALLOW_SEED, instrument.key().as_ref(), buyer.key().as_ref()],
        bump = allow_entry.bump,
    )]
    pub allow_entry: Option<Account<'info, AllowEntry>>,
    pub token_program: Program<'info, Token2022>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
}

pub fn handle_subscribe(ctx: Context<Subscribe>, units: u64, max_payment: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let instrument = &ctx.accounts.instrument;
    let offering = &ctx.accounts.offering;
    require!(units > 0, MarketsError::ZeroUnits);
    require!(instrument.status == InstrumentStatus::Active, MarketsError::InstrumentNotActive);
    require!(now < instrument.maturity_ts, MarketsError::InstrumentMatured);
    require!(!offering.closed, MarketsError::OfferingClosed);
    require!(offering.is_open(now), MarketsError::OfferingNotOpen);
    // Same register rules as `issue`.
    require!(instrument.pending_action.is_none(), MarketsError::PendingActionExists);
    require!(!instrument.open_redemption, MarketsError::RedemptionInProgress);
    require!(!instrument.is_locked(now), MarketsError::RegisterLocked);
    if instrument.allowlist_enabled {
        require!(ctx.accounts.allow_entry.is_some(), MarketsError::AllowlistEntryRequired);
    }
    let sold = offering.sold_units.checked_add(units).ok_or(MarketsError::MathOverflow)?;
    require!(sold <= offering.cap_units, MarketsError::OfferingSoldOut);
    let held = ctx.accounts.buyer_bond.amount.checked_add(units).ok_or(MarketsError::MathOverflow)?;
    require!(held <= offering.per_holder_cap, MarketsError::HolderCapExceeded);
    let amount = units.checked_mul(offering.issue_price).ok_or(MarketsError::MathOverflow)?;
    require!(amount <= max_payment, MarketsError::PaymentExceedsMax);

    // Payment leg.
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.settlement_token_program.key(),
            TransferChecked {
                from: ctx.accounts.buyer_settlement.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.proceeds_vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.settlement_mint.decimals,
    )?;

    // Delivery leg.
    let mint_key = ctx.accounts.mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[INSTRUMENT_SEED, mint_key.as_ref(), &[instrument.bump]]];
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_2022::ID,
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyer_bond.to_account_info(),
                authority: ctx.accounts.instrument.to_account_info(),
            },
            signer_seeds,
        ),
        units,
    )?;

    let instrument = &mut ctx.accounts.instrument;
    instrument.issued_units = instrument.issued_units.checked_add(units).ok_or(MarketsError::MathOverflow)?;
    let offering = &mut ctx.accounts.offering;
    offering.sold_units = sold;
    offering.proceeds = offering.proceeds.checked_add(amount).ok_or(MarketsError::MathOverflow)?;
    offering.purchases = offering.purchases.saturating_add(1);
    ctx.accounts.mint.reload()?;
    emit!(UnitsSubscribed {
        instrument: instrument.key(),
        offering: offering.key(),
        buyer: ctx.accounts.buyer.key(),
        units,
        issue_price: offering.issue_price,
        amount,
        sold_units: sold,
        supply: ctx.accounts.mint.supply,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawProceeds<'info> {
    pub issuer: Signer<'info>,
    #[account(
        has_one = issuer @ MarketsError::NotIssuer,
        has_one = settlement_mint,
        constraint = instrument.settlement_token_program == settlement_token_program.key() @ MarketsError::InvalidSettlementAccount,
    )]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        has_one = proceeds_vault,
        seeds = [OFFERING_SEED, instrument.key().as_ref()],
        bump = offering.bump,
    )]
    pub offering: Box<Account<'info, Offering>>,
    #[account(mut)]
    pub proceeds_vault: Box<InterfaceAccount<'info, TokenAccount>>,
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

pub fn handle_withdraw_proceeds(ctx: Context<WithdrawProceeds>, amount: u64) -> Result<()> {
    require!(amount > 0, MarketsError::ZeroFunding);
    require!(amount <= ctx.accounts.proceeds_vault.amount, MarketsError::InsufficientProceeds);
    let instrument_key = ctx.accounts.instrument.key();
    let seeds: &[&[&[u8]]] = &[&[OFFERING_SEED, instrument_key.as_ref(), &[ctx.accounts.offering.bump]]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.settlement_token_program.key(),
            TransferChecked {
                from: ctx.accounts.proceeds_vault.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.issuer_settlement.to_account_info(),
                authority: ctx.accounts.offering.to_account_info(),
            },
            seeds,
        ),
        amount,
        ctx.accounts.settlement_mint.decimals,
    )?;
    let offering = &mut ctx.accounts.offering;
    offering.withdrawn = offering.withdrawn.checked_add(amount).ok_or(MarketsError::MathOverflow)?;
    emit!(ProceedsWithdrawn {
        instrument: instrument_key,
        offering: offering.key(),
        amount,
        withdrawn_total: offering.withdrawn,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseOffering<'info> {
    pub issuer: Signer<'info>,
    #[account(has_one = issuer @ MarketsError::NotIssuer)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [OFFERING_SEED, instrument.key().as_ref()],
        bump = offering.bump,
    )]
    pub offering: Box<Account<'info, Offering>>,
}

/// Stops sales for good. Proceeds stay withdrawable.
pub fn handle_close_offering(ctx: Context<CloseOffering>) -> Result<()> {
    let offering = &mut ctx.accounts.offering;
    require!(!offering.closed, MarketsError::OfferingClosed);
    offering.closed = true;
    emit!(OfferingClosed {
        instrument: offering.instrument,
        offering: offering.key(),
        sold_units: offering.sold_units,
        proceeds: offering.proceeds,
    });
    Ok(())
}
