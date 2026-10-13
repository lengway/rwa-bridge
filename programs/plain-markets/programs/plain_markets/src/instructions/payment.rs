use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{self, Burn, Token2022},
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{constants::*, error::MarketsError, events::*, math, state::*};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(mut, has_one = mint, has_one = settlement_mint)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    #[account(mut, seeds = [VAULT_SEED, action.key().as_ref()], bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = holder,
        associated_token::mint = settlement_mint,
        associated_token::authority = holder,
        associated_token::token_program = settlement_token_program,
    )]
    pub holder_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Bond mint (burned from on redemptions).
    #[account(mut, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// Holder's bond token account; required for redemptions.
    #[account(mut, token::mint = mint, token::authority = holder, token::token_program = token_program)]
    pub holder_bond: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        init_if_needed,
        payer = holder,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [CLAIM_SEED, action.key().as_ref(), holder.key().as_ref()],
        bump,
    )]
    pub receipt: Box<Account<'info, ClaimReceipt>>,
    #[account(mint::token_program = settlement_token_program)]
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Program<'info, Token2022>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Holder pulls its entitlement with a Merkle proof of its snapshot units.
pub fn handle_claim(ctx: Context<Claim>, units: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    let a = ctx.accounts;
    let holder = a.holder.key();
    process_payment(
        PaymentAccounts {
            instrument: &mut a.instrument,
            action: &mut a.action,
            vault: &a.vault,
            holder_settlement: &a.holder_settlement,
            mint: &mut a.mint,
            holder_bond: a.holder_bond.as_deref(),
            receipt: &mut a.receipt,
            settlement_mint: &a.settlement_mint,
            settlement_token_program: &a.settlement_token_program,
        },
        holder,
        holder,
        PaymentMode::Claim,
        ctx.bumps.receipt,
        units,
        &proof,
    )
}

#[derive(Accounts)]
pub struct Pay<'info> {
    #[account(mut)]
    pub paying_agent: Signer<'info>,
    /// CHECK: the holder being paid; bound by the Merkle leaf, the receipt seeds and the ATA.
    pub holder: UncheckedAccount<'info>,
    #[account(
        mut,
        has_one = mint,
        has_one = settlement_mint,
        constraint = paying_agent.key() == instrument.paying_agent || paying_agent.key() == instrument.issuer
            @ MarketsError::NotPayingAgent,
    )]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(
        mut,
        has_one = instrument,
        seeds = [ACTION_SEED, instrument.key().as_ref(), &action.id.to_le_bytes()],
        bump = action.bump,
    )]
    pub action: Box<Account<'info, CorporateAction>>,
    #[account(mut, seeds = [VAULT_SEED, action.key().as_ref()], bump)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = paying_agent,
        associated_token::mint = settlement_mint,
        associated_token::authority = holder,
        associated_token::token_program = settlement_token_program,
    )]
    pub holder_settlement: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = holder, token::token_program = token_program)]
    pub holder_bond: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    #[account(
        init_if_needed,
        payer = paying_agent,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [CLAIM_SEED, action.key().as_ref(), holder.key().as_ref()],
        bump,
    )]
    pub receipt: Box<Account<'info, ClaimReceipt>>,
    #[account(mint::token_program = settlement_token_program)]
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Program<'info, Token2022>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Paying agent pushes the entitlement to a holder (custodial / smart wallets that do not sign).
/// Funds can only go to the holder's own associated token account.
pub fn handle_pay(ctx: Context<Pay>, units: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    let a = ctx.accounts;
    let holder = a.holder.key();
    let agent = a.paying_agent.key();
    process_payment(
        PaymentAccounts {
            instrument: &mut a.instrument,
            action: &mut a.action,
            vault: &a.vault,
            holder_settlement: &a.holder_settlement,
            mint: &mut a.mint,
            holder_bond: a.holder_bond.as_deref(),
            receipt: &mut a.receipt,
            settlement_mint: &a.settlement_mint,
            settlement_token_program: &a.settlement_token_program,
        },
        holder,
        agent,
        PaymentMode::Push,
        ctx.bumps.receipt,
        units,
        &proof,
    )
}

struct PaymentAccounts<'a, 'info> {
    instrument: &'a mut Account<'info, Instrument>,
    action: &'a mut Account<'info, CorporateAction>,
    vault: &'a InterfaceAccount<'info, TokenAccount>,
    holder_settlement: &'a InterfaceAccount<'info, TokenAccount>,
    mint: &'a mut InterfaceAccount<'info, Mint>,
    holder_bond: Option<&'a InterfaceAccount<'info, TokenAccount>>,
    receipt: &'a mut Account<'info, ClaimReceipt>,
    settlement_mint: &'a InterfaceAccount<'info, Mint>,
    settlement_token_program: &'a Interface<'info, TokenInterface>,
}

#[allow(clippy::too_many_arguments)]
fn process_payment(
    acc: PaymentAccounts,
    holder: Pubkey,
    paid_by: Pubkey,
    mode: PaymentMode,
    receipt_bump: u8,
    units: u64,
    proof: &[[u8; 32]],
) -> Result<()> {
    let clock = Clock::get()?;
    let action_key = acc.action.key();
    let instrument_key = acc.instrument.key();

    // --- state machine ---------------------------------------------------------------------
    require!(acc.action.kind.pays(), MarketsError::WrongActionKind);
    require!(
        matches!(acc.action.status, ActionStatus::Funded | ActionStatus::Settling),
        MarketsError::ActionNotFunded
    );
    require!(clock.unix_timestamp >= acc.action.payment_ts, MarketsError::PaymentNotDue);
    // A fresh receipt has a zeroed action field; an existing one means this holder was paid.
    require!(acc.receipt.action == Pubkey::default(), MarketsError::AlreadyClaimed);

    // --- entitlement from the snapshot proof -------------------------------------------------
    require!(units > 0, MarketsError::ZeroUnits);
    require!(proof.len() <= MAX_PROOF_LEN as usize, MarketsError::ProofTooLong);
    let leaf = math::leaf_hash(&action_key.to_bytes(), &holder.to_bytes(), units);
    require!(math::verify_proof(leaf, proof, &acc.action.merkle_root), MarketsError::InvalidProof);

    let ent = match acc.action.kind {
        ActionKind::Coupon => math::coupon_entitlement(units, acc.action.amount_per_unit),
        ActionKind::PartialRedemption => {
            math::partial_entitlement(units, acc.action.redeem_bps, acc.action.amount_per_unit)
        }
        ActionKind::FinalRedemption => math::final_entitlement(units, acc.action.amount_per_unit),
        ActionKind::Vote => None,
    }
    .ok_or(MarketsError::MathOverflow)?;

    let claimed_units = acc.action.claimed_units.checked_add(units).ok_or(MarketsError::MathOverflow)?;
    let redeemed_units = acc.action.redeemed_units.checked_add(ent.burn_units).ok_or(MarketsError::MathOverflow)?;
    let paid_amount = acc.action.paid_amount.checked_add(ent.amount).ok_or(MarketsError::MathOverflow)?;
    let paid_count = acc.action.paid_count.checked_add(1).ok_or(MarketsError::MathOverflow)?;
    require!(
        claimed_units <= acc.action.total_units
            && redeemed_units <= acc.action.total_redeem_units
            && paid_count <= acc.action.holder_count,
        MarketsError::SnapshotTotalsExceeded
    );
    require!(
        paid_amount <= acc.action.funded_amount && ent.amount <= acc.vault.amount,
        MarketsError::InsufficientVaultFunds
    );

    // --- delivery versus payment: burn first, then pay, in one instruction ---------------------
    if ent.burn_units > 0 {
        let holder_bond = acc.holder_bond.ok_or(MarketsError::MissingHolderBondAccount)?;
        require!(holder_bond.amount >= ent.burn_units, MarketsError::InsufficientUnitsToRedeem);
        let mint_key = acc.mint.key();
        let seeds: &[&[&[u8]]] = &[&[INSTRUMENT_SEED, mint_key.as_ref(), &[acc.instrument.bump]]];
        // The instrument PDA is the mint's permanent delegate.
        token_2022::burn(
            CpiContext::new_with_signer(
                token_2022::ID,
                Burn {
                    mint: acc.mint.to_account_info(),
                    from: holder_bond.to_account_info(),
                    authority: acc.instrument.to_account_info(),
                },
                seeds,
            ),
            ent.burn_units,
        )?;
        acc.mint.reload()?;
    }

    if ent.amount > 0 {
        let id_bytes = acc.action.id.to_le_bytes();
        let seeds: &[&[&[u8]]] = &[&[ACTION_SEED, instrument_key.as_ref(), &id_bytes, &[acc.action.bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                acc.settlement_token_program.key(),
                TransferChecked {
                    from: acc.vault.to_account_info(),
                    mint: acc.settlement_mint.to_account_info(),
                    to: acc.holder_settlement.to_account_info(),
                    authority: acc.action.to_account_info(),
                },
                seeds,
            ),
            ent.amount,
            acc.settlement_mint.decimals,
        )?;
    }

    // --- bookkeeping ---------------------------------------------------------------------------
    acc.receipt.set_inner(ClaimReceipt {
        action: action_key,
        holder,
        units,
        amount: ent.amount,
        burned_units: ent.burn_units,
        mode,
        paid_by,
        slot: clock.slot,
        ts: clock.unix_timestamp,
        bump: receipt_bump,
    });

    let action = &mut *acc.action;
    action.claimed_units = claimed_units;
    action.redeemed_units = redeemed_units;
    action.paid_amount = paid_amount;
    action.paid_count = paid_count;
    action.status = ActionStatus::Settling;

    emit!(EntitlementPaid {
        instrument: instrument_key,
        action: action_key,
        holder,
        units,
        amount: ent.amount,
        burned_units: ent.burn_units,
        mode,
        paid_by,
    });

    if ent.burn_units > 0 {
        let instrument = &mut *acc.instrument;
        instrument.redeemed_units =
            instrument.redeemed_units.checked_add(ent.burn_units).ok_or(MarketsError::MathOverflow)?;
        let supply_after = acc.mint.supply;
        emit!(UnitsRedeemed {
            instrument: instrument_key,
            action: action_key,
            holder,
            units: ent.burn_units,
            supply_after,
        });
        if action.kind == ActionKind::FinalRedemption && supply_after == 0 {
            instrument.status = InstrumentStatus::Redeemed;
            emit!(InstrumentRedeemed { instrument: instrument_key, action: action_key });
        }
    }
    Ok(())
}
