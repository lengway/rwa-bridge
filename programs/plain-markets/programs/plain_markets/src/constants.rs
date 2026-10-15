use anchor_lang::prelude::*;

#[constant]
pub const INSTRUMENT_SEED: &[u8] = b"instrument";
#[constant]
pub const ACTION_SEED: &[u8] = b"action";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const CLAIM_SEED: &[u8] = b"claim";
#[constant]
pub const VOTE_SEED: &[u8] = b"vote";
#[constant]
pub const ALLOW_SEED: &[u8] = b"allow";
#[constant]
pub const OFFERING_SEED: &[u8] = b"offering";
/// Issuance proceeds vault: token account [b"proceeds", instrument], authority = offering PDA.
#[constant]
pub const PROCEEDS_SEED: &[u8] = b"proceeds";
/// Seed fixed by the SPL transfer-hook interface for the validation account.
#[constant]
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

/// Basis-point denominator (100% = 10_000).
pub const BPS_DENOMINATOR: u128 = 10_000;
/// Longest accepted Merkle proof (2^24 ≈ 16.7M holders).
#[constant]
pub const MAX_PROOF_LEN: u32 = 24;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_TITLE_LEN: usize = 64;
pub const MAX_VOTE_OPTIONS: usize = 4;
pub const MAX_OPTION_LEN: usize = 32;
/// Upper bound for redemption price (200% of par).
pub const MAX_PRICE_BPS: u16 = 20_000;
/// Annual coupon rates above 100% are rejected as fat-finger input.
pub const MAX_RATE_BPS: u16 = 10_000;

/// Domain-separation prefixes for snapshot Merkle hashing.
pub const LEAF_PREFIX: u8 = 0x00;
pub const NODE_PREFIX: u8 = 0x01;

/// SPL transfer-hook `Execute` discriminator: sha256("spl-transfer-hook-interface:execute")[..8].
/// Checked against the interface crate in tests.
pub const TRANSFER_HOOK_EXECUTE_DISCRIMINATOR: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];
