//! Pure entitlement math and snapshot Merkle hashing. Mirrored byte-for-byte by
//! `lib/markets/entitlements.ts` and `lib/markets/merkle.ts`; both sides are checked against
//! `lib/markets/test-vectors.json`.
//!
//! Rounding follows the market convention of per-denomination amounts: the payment for one bond
//! unit is rounded down to the settlement base unit first, then multiplied by the units held.
//! Every unit therefore receives an identical amount and the total owed is exactly
//! `total_units * amount_per_unit`, which the program computes on-chain at snapshot time.

use crate::constants::{BPS_DENOMINATOR, LEAF_PREFIX, NODE_PREFIX};

/// Coupon per unit: face * rate_bps / 10_000 / frequency, rounded down.
pub fn coupon_per_unit(face_value: u64, rate_bps: u16, frequency: u8) -> Option<u64> {
    if frequency == 0 {
        return None;
    }
    let v = (face_value as u128)
        .checked_mul(rate_bps as u128)?
        .checked_div(BPS_DENOMINATOR.checked_mul(frequency as u128)?)?;
    u64::try_from(v).ok()
}

/// Redemption price per unit: face * price_bps / 10_000, rounded down.
pub fn price_per_unit(face_value: u64, price_bps: u16) -> Option<u64> {
    let v = (face_value as u128)
        .checked_mul(price_bps as u128)?
        .checked_div(BPS_DENOMINATOR)?;
    u64::try_from(v).ok()
}

/// Final redemption per unit: redemption price plus the final coupon.
pub fn final_per_unit(face_value: u64, price_bps: u16, rate_bps: u16, frequency: u8) -> Option<u64> {
    price_per_unit(face_value, price_bps)?.checked_add(coupon_per_unit(face_value, rate_bps, frequency)?)
}

/// Units of one holding redeemed by a partial redemption: floor(units * redeem_bps / 10_000).
pub fn partial_redeem_units(units: u64, redeem_bps: u16) -> Option<u64> {
    let v = (units as u128)
        .checked_mul(redeem_bps as u128)?
        .checked_div(BPS_DENOMINATOR)?;
    u64::try_from(v).ok()
}

/// Bounds on the sum of per-holder floors for a partial redemption over `holder_count` holdings
/// totalling `total_units`: every floor loses strictly less than one unit, so
/// floor(T * b) - (n - 1) <= sum <= floor(T * b).
pub fn partial_redeem_bounds(total_units: u64, redeem_bps: u16, holder_count: u32) -> Option<(u64, u64)> {
    let max = partial_redeem_units(total_units, redeem_bps)?;
    let min = max.saturating_sub((holder_count as u64).saturating_sub(1));
    Some((min, max))
}

/// What a holder of `units` receives and burns for one action.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entitlement {
    pub amount: u64,
    pub burn_units: u64,
}

pub fn coupon_entitlement(units: u64, amount_per_unit: u64) -> Option<Entitlement> {
    Some(Entitlement { amount: units.checked_mul(amount_per_unit)?, burn_units: 0 })
}

pub fn partial_entitlement(units: u64, redeem_bps: u16, amount_per_unit: u64) -> Option<Entitlement> {
    let burn_units = partial_redeem_units(units, redeem_bps)?;
    Some(Entitlement { amount: burn_units.checked_mul(amount_per_unit)?, burn_units })
}

pub fn final_entitlement(units: u64, amount_per_unit: u64) -> Option<Entitlement> {
    Some(Entitlement { amount: units.checked_mul(amount_per_unit)?, burn_units: units })
}

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    solana_sha256_hasher::hashv(parts).to_bytes()
}

/// Leaf = sha256(0x00 || action || holder || units as u64 LE). Binding the action address makes a
/// proof from one action useless against any other action's root.
pub fn leaf_hash(action: &[u8; 32], holder: &[u8; 32], units: u64) -> [u8; 32] {
    sha256(&[&[LEAF_PREFIX], action, holder, &units.to_le_bytes()])
}

/// Node = sha256(0x01 || min(a, b) || max(a, b)) — sorted pairs, so proofs carry no directions.
pub fn node_hash(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    if a <= b {
        sha256(&[&[NODE_PREFIX], a, b])
    } else {
        sha256(&[&[NODE_PREFIX], b, a])
    }
}

pub fn verify_proof(leaf: [u8; 32], proof: &[[u8; 32]], root: &[u8; 32]) -> bool {
    let mut acc = leaf;
    for sibling in proof {
        acc = node_hash(&acc, sibling);
    }
    &acc == root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coupon_rounds_per_unit() {
        // 1,000.000000 face, 12.5% semi-annual => 62.500000 per unit.
        assert_eq!(coupon_per_unit(1_000_000_000, 1250, 2), Some(62_500_000));
        // 100.000001 face at 7% quarterly: 1_750_000.0175 -> 1_750_000.
        assert_eq!(coupon_per_unit(100_000_001, 700, 4), Some(1_750_000));
        assert_eq!(coupon_per_unit(1, 1, 12), Some(0));
        assert_eq!(coupon_per_unit(1, 1, 0), None);
        assert_eq!(coupon_per_unit(u64::MAX, 10_000, 1), Some(u64::MAX));
    }

    #[test]
    fn partial_bounds() {
        assert_eq!(partial_redeem_units(3, 5000), Some(1));
        assert_eq!(partial_redeem_bounds(10, 5000, 4), Some((2, 5)));
        assert_eq!(partial_redeem_bounds(10, 5000, 1), Some((5, 5)));
    }

    #[test]
    fn hook_discriminator_matches_interface() {
        let packed = spl_transfer_hook_interface::instruction::TransferHookInstruction::Execute { amount: 0 }.pack();
        assert_eq!(&packed[..8], &crate::constants::TRANSFER_HOOK_EXECUTE_DISCRIMINATOR);
    }

    #[test]
    fn merkle_two_leaves() {
        let a = leaf_hash(&[1; 32], &[2; 32], 5);
        let b = leaf_hash(&[1; 32], &[3; 32], 7);
        let root = node_hash(&a, &b);
        assert!(verify_proof(a, &[b], &root));
        assert!(verify_proof(b, &[a], &root));
        assert!(!verify_proof(leaf_hash(&[1; 32], &[2; 32], 6), &[b], &root));
    }
}
