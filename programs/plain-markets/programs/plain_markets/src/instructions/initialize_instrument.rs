use anchor_lang::{prelude::*, system_program};
use anchor_spl::{
    token_2022::{self, spl_token_2022, InitializeMint2, Token2022},
    token_interface::{
        metadata_pointer_initialize, permanent_delegate_initialize, spl_token_metadata_interface,
        token_metadata_initialize, transfer_hook_initialize, Mint, MetadataPointerInitialize,
        PermanentDelegateInitialize, TokenInterface, TokenMetadataInitialize, TransferHookInitialize,
    },
};
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{constants::*, error::MarketsError, events::InstrumentCreated, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InstrumentParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub isin: [u8; 12],
    /// Par value per unit in settlement base units.
    pub face_value: u64,
    pub coupon_bps: u16,
    pub coupon_frequency: u8,
    pub issue_ts: i64,
    pub maturity_ts: i64,
    pub allowlist_enabled: bool,
    /// Defaults to the issuer when None.
    pub paying_agent: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct InitializeInstrument<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,

    /// CHECK: fresh keypair; created here as a Token-2022 mint with the transfer hook, permanent
    /// delegate and metadata extensions.
    #[account(mut, signer)]
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = issuer,
        space = 8 + Instrument::INIT_SPACE,
        seeds = [INSTRUMENT_SEED, mint.key().as_ref()],
        bump,
    )]
    pub instrument: Box<Account<'info, Instrument>>,

    /// CHECK: transfer-hook validation account, created and written here.
    #[account(mut, seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[account(
        mint::token_program = settlement_token_program,
        constraint = settlement_mint.key() != mint.key() @ MarketsError::InvalidSettlementMint,
    )]
    pub settlement_mint: Box<InterfaceAccount<'info, Mint>>,
    pub settlement_token_program: Interface<'info, TokenInterface>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_instrument(ctx: Context<InitializeInstrument>, params: InstrumentParams) -> Result<()> {
    require!(matches!(params.coupon_frequency, 1 | 2 | 4 | 12), MarketsError::InvalidFrequency);
    require!(params.face_value > 0, MarketsError::InvalidFaceValue);
    require!(params.coupon_bps <= MAX_RATE_BPS, MarketsError::InvalidRate);
    require!(params.maturity_ts > params.issue_ts, MarketsError::InvalidMaturity);
    require!(
        !params.name.is_empty()
            && params.name.len() <= MAX_NAME_LEN
            && !params.symbol.is_empty()
            && params.symbol.len() <= MAX_SYMBOL_LEN
            && params.uri.len() <= MAX_URI_LEN,
        MarketsError::InvalidMetadata
    );

    let now = Clock::get()?.unix_timestamp;
    let mint_key = ctx.accounts.mint.key();
    let instrument_key = ctx.accounts.instrument.key();
    let bump = ctx.bumps.instrument;
    let signer_seeds: &[&[&[u8]]] = &[&[INSTRUMENT_SEED, mint_key.as_ref(), &[bump]]];

    // --- bond mint: Token-2022 with hook + permanent delegate + metadata ---------------------
    let space = spl_token_2022::extension::ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&[
        spl_token_2022::extension::ExtensionType::TransferHook,
        spl_token_2022::extension::ExtensionType::PermanentDelegate,
        spl_token_2022::extension::ExtensionType::MetadataPointer,
    ])?;
    let metadata = spl_token_metadata_interface::state::TokenMetadata {
        update_authority: Some(instrument_key).try_into()?,
        mint: mint_key,
        name: params.name.clone(),
        symbol: params.symbol.clone(),
        uri: params.uri.clone(),
        additional_metadata: vec![],
    };
    let metadata_len = metadata.tlv_size_of()?;
    // Pre-fund rent for the metadata TLV that Token-2022 appends on initialize.
    let lamports = Rent::get()?.minimum_balance(space + metadata_len);
    system_program::create_account(
        CpiContext::new(
            system_program::ID,
            system_program::CreateAccount {
                from: ctx.accounts.issuer.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        lamports,
        space as u64,
        &token_2022::ID,
    )?;

    let token_program_ai = ctx.accounts.token_program.to_account_info();
    let mint_ai = ctx.accounts.mint.to_account_info();
    transfer_hook_initialize(
        CpiContext::new(
            token_2022::ID,
            TransferHookInitialize { token_program_id: token_program_ai.clone(), mint: mint_ai.clone() },
        ),
        Some(instrument_key),
        Some(crate::ID),
    )?;
    permanent_delegate_initialize(
        CpiContext::new(
            token_2022::ID,
            PermanentDelegateInitialize { token_program_id: token_program_ai.clone(), mint: mint_ai.clone() },
        ),
        &instrument_key,
    )?;
    metadata_pointer_initialize(
        CpiContext::new(
            token_2022::ID,
            MetadataPointerInitialize { token_program_id: token_program_ai.clone(), mint: mint_ai.clone() },
        ),
        Some(instrument_key),
        Some(mint_key),
    )?;
    token_2022::initialize_mint2(
        CpiContext::new(token_2022::ID, InitializeMint2 { mint: mint_ai.clone() }),
        0,
        &instrument_key,
        None,
    )?;
    token_metadata_initialize(
        CpiContext::new_with_signer(
            token_2022::ID,
            TokenMetadataInitialize {
                program_id: token_program_ai,
                metadata: mint_ai.clone(),
                update_authority: ctx.accounts.instrument.to_account_info(),
                mint_authority: ctx.accounts.instrument.to_account_info(),
                mint: mint_ai,
            },
            signer_seeds,
        ),
        params.name.clone(),
        params.symbol.clone(),
        params.uri.clone(),
    )?;

    // --- transfer-hook extra accounts: [instrument PDA, allowlist entry of destination owner] --
    let metas = [
        // index 5: Instrument [b"instrument", mint]
        ExtraAccountMeta::new_with_seeds(
            &[Seed::Literal { bytes: INSTRUMENT_SEED.to_vec() }, Seed::AccountKey { index: 1 }],
            false,
            false,
        )?,
        // index 6: AllowEntry [b"allow", instrument, destination.owner]; owner is at offset 32 of
        // the destination token account. The account need not exist when the allowlist is off.
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: ALLOW_SEED.to_vec() },
                Seed::AccountKey { index: 5 },
                Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
            ],
            false,
            false,
        )?,
    ];
    let metas_space = ExtraAccountMetaList::size_of(metas.len())?;
    let metas_bump = ctx.bumps.extra_account_meta_list;
    let metas_seeds: &[&[&[u8]]] = &[&[EXTRA_ACCOUNT_METAS_SEED, mint_key.as_ref(), &[metas_bump]]];
    system_program::create_account(
        CpiContext::new_with_signer(
            system_program::ID,
            system_program::CreateAccount {
                from: ctx.accounts.issuer.to_account_info(),
                to: ctx.accounts.extra_account_meta_list.to_account_info(),
            },
            metas_seeds,
        ),
        Rent::get()?.minimum_balance(metas_space),
        metas_space as u64,
        &crate::ID,
    )?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
        &metas,
    )?;

    // --- instrument state ---------------------------------------------------------------------
    let instrument = &mut ctx.accounts.instrument;
    instrument.set_inner(Instrument {
        issuer: ctx.accounts.issuer.key(),
        paying_agent: params.paying_agent.unwrap_or(ctx.accounts.issuer.key()),
        mint: mint_key,
        settlement_mint: ctx.accounts.settlement_mint.key(),
        settlement_token_program: ctx.accounts.settlement_token_program.key(),
        settlement_decimals: ctx.accounts.settlement_mint.decimals,
        name: params.name,
        symbol: params.symbol,
        isin: params.isin,
        face_value: params.face_value,
        coupon_bps: params.coupon_bps,
        coupon_frequency: params.coupon_frequency,
        issue_ts: params.issue_ts,
        maturity_ts: params.maturity_ts,
        status: InstrumentStatus::Active,
        allowlist_enabled: params.allowlist_enabled,
        lock_from: 0,
        lock_until: 0,
        issued_units: 0,
        redeemed_units: 0,
        action_count: 0,
        coupon_periods: 0,
        pending_action: None,
        open_actions: 0,
        open_redemption: false,
        created_ts: now,
        bump,
    });

    emit!(InstrumentCreated {
        instrument: instrument_key,
        mint: mint_key,
        issuer: instrument.issuer,
        settlement_mint: instrument.settlement_mint,
        face_value: instrument.face_value,
        coupon_bps: instrument.coupon_bps,
        coupon_frequency: instrument.coupon_frequency,
        maturity_ts: instrument.maturity_ts,
        allowlist_enabled: instrument.allowlist_enabled,
    });
    Ok(())
}
