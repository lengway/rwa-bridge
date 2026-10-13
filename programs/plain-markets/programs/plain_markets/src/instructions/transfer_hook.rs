use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions},
        state::Account as SplTokenAccount,
    },
    token_interface::{Mint, TokenAccount},
};

use crate::{constants::*, error::MarketsError, state::*};

/// Accounts in the order fixed by the SPL transfer-hook interface, followed by the extra accounts
/// declared in the validation account.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint)]
    pub source_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(token::mint = mint)]
    pub destination_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: source owner or delegate; validated by Token-2022.
    pub owner: UncheckedAccount<'info>,
    /// CHECK: validation account, checked by seeds.
    #[account(seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(seeds = [INSTRUMENT_SEED, mint.key().as_ref()], bump = instrument.bump)]
    pub instrument: Box<Account<'info, Instrument>>,
    /// CHECK: AllowEntry PDA of the destination owner. May be uninitialized; read only when the
    /// allowlist is on.
    #[account(
        seeds = [ALLOW_SEED, instrument.key().as_ref(), destination_token.owner.as_ref()],
        bump,
    )]
    pub allow_entry: UncheckedAccount<'info>,
}

pub fn handle_transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
    // Only meaningful inside a Token-2022 transfer: the source carries the `transferring` flag.
    {
        let source_info = ctx.accounts.source_token.to_account_info();
        let data = source_info.try_borrow_data()?;
        let state = StateWithExtensions::<SplTokenAccount>::unpack(&data)?;
        let ext = state.get_extension::<TransferHookAccount>()?;
        require!(bool::from(ext.transferring), MarketsError::NotTransferring);
    }

    let instrument = &ctx.accounts.instrument;
    let now = Clock::get()?.unix_timestamp;
    require!(!instrument.is_locked(now), MarketsError::TransferLocked);

    if instrument.allowlist_enabled {
        let entry = &ctx.accounts.allow_entry;
        // Seeds already bind the PDA to (instrument, destination owner); it only has to exist as
        // one of our AllowEntry accounts.
        require!(
            entry.owner == &crate::ID && entry.data_len() >= 8 && {
                let data = entry.try_borrow_data()?;
                data[..8] == *AllowEntry::DISCRIMINATOR
            },
            MarketsError::DestinationNotAllowlisted
        );
    }
    Ok(())
}
