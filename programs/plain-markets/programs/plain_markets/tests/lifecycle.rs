//! End-to-end lifecycle and attack tests on LiteSVM against the compiled program
//! (run `anchor build` first; `cargo test` loads target/deploy/plain_markets.so).

mod common;

use anchor_lang::{prelude::Pubkey, InstructionData};
use common::*;
use plain_markets::{
    error::MarketsError as E, instruction as ix, math, ActionKind, ActionStatus, InstrumentStatus, PaymentMode, SnapshotParams,
};
use solana_keypair::Keypair;
use solana_signer::Signer;

struct Bond {
    env: Env,
    mint: Pubkey,
    instrument: Pubkey,
    alice: Keypair,
    bob: Keypair,
    carol: Keypair,
}

/// Instrument with alice 50, bob 30, carol 20 units.
fn setup(allowlist: bool) -> Bond {
    let mut env = Env::new();
    let (mint, instrument) = env.create_instrument(allowlist);
    let (alice, bob, carol) = (env.wallet(), env.wallet(), env.wallet());
    if allowlist {
        let issuer = env.issuer.insecure_clone();
        for w in [&alice, &bob, &carol] {
            let i = env.allow_ix(&issuer.pubkey(), &instrument, &w.pubkey());
            env.ok(&[i], &issuer, &[]);
        }
    }
    env.issue(&mint, &alice.pubkey(), 50);
    env.issue(&mint, &bob.pubkey(), 30);
    env.issue(&mint, &carol.pubkey(), 20);
    let issuer = env.issuer.pubkey();
    env.mint_usd(&issuer, 1_000_000_000_000);
    Bond { env, mint, instrument, alice, bob, carol }
}

impl Bond {
    fn holdings(&self) -> Vec<(Pubkey, u64)> {
        vec![(self.alice.pubkey(), 50), (self.bob.pubkey(), 30), (self.carol.pubkey(), 20)]
    }

    /// announce → (warp to record) lock_record → post_snapshot; returns (action, tree).
    fn to_snapshot(&mut self, params: plain_markets::AnnounceParams) -> (Pubkey, Tree) {
        let kind = params.kind;
        let redeem_bps = params.redeem_bps;
        let record_ts = params.record_ts;
        let action = self.env.announce(&self.instrument, params);
        self.env.set_time(record_ts);
        let issuer = self.env.issuer.insecure_clone();
        let lock = self.env.lock_record_ix(&issuer.pubkey(), &self.instrument, &action);
        self.env.ok(&[lock], &issuer, &[]);
        let tree = Tree::new(action, self.holdings());
        let p = self.env.snapshot_params(&tree, kind, redeem_bps);
        let snap = self.env.snapshot_ix(&issuer.pubkey(), &self.instrument, &action, p);
        self.env.ok(&[snap], &issuer, &[]);
        (action, tree)
    }

    fn fund_all(&mut self, action: &Pubkey) {
        let total = self.env.action(action).total_entitlement;
        let issuer = self.env.issuer.insecure_clone();
        let f = self.env.fund_ix(&issuer.pubkey(), &self.instrument, action, total);
        self.env.ok(&[f], &issuer, &[]);
    }
}

fn coupon_params(env: &Env) -> plain_markets::AnnounceParams {
    // record in 10 days, pay in 15, claim deadline in 45.
    env.announce_params(ActionKind::Coupon, 10 * DAY, 15 * DAY, 45 * DAY)
}

// ------------------------------------------------------------------------------------------------
// Instrument setup
// ------------------------------------------------------------------------------------------------

#[test]
fn instrument_initializes_token_2022_bond() {
    let b = setup(false);
    let inst = b.env.instrument(&b.instrument);
    assert_eq!(inst.issuer, b.env.issuer.pubkey());
    assert_eq!(inst.paying_agent, b.env.issuer.pubkey());
    assert_eq!(inst.mint, b.mint);
    assert_eq!(inst.settlement_mint, b.env.usd_mint);
    assert_eq!(inst.settlement_decimals, SETTLEMENT_DECIMALS);
    assert_eq!(inst.status, InstrumentStatus::Active);
    assert_eq!(inst.issued_units, 100);
    assert_eq!(b.env.mint_supply(&b.mint), 100);
    assert_eq!(&inst.isin, b"KZ2C00012345");

    // Mint is Token-2022 with hook → this program, permanent delegate → instrument PDA, 0 decimals.
    use anchor_spl::token_2022::spl_token_2022::{
        extension::{
            metadata_pointer::MetadataPointer, permanent_delegate::PermanentDelegate, transfer_hook::TransferHook,
            BaseStateWithExtensions, StateWithExtensions,
        },
        state::Mint,
    };
    let acct = b.env.svm.get_account(&b.mint).unwrap();
    assert_eq!(acct.owner, token_2022_id());
    let state = StateWithExtensions::<Mint>::unpack(&acct.data).unwrap();
    assert_eq!(state.base.decimals, 0);
    assert_eq!(Option::<Pubkey>::from(state.base.mint_authority), Some(b.instrument));
    assert!(Option::<Pubkey>::from(state.base.freeze_authority).is_none());
    let hook = state.get_extension::<TransferHook>().unwrap();
    assert_eq!(Option::<Pubkey>::from(hook.program_id), Some(plain_markets::ID));
    let pd = state.get_extension::<PermanentDelegate>().unwrap();
    assert_eq!(Option::<Pubkey>::from(pd.delegate), Some(b.instrument));
    let mp = state.get_extension::<MetadataPointer>().unwrap();
    assert_eq!(Option::<Pubkey>::from(mp.metadata_address), Some(b.mint));
    let md = state
        .get_variable_len_extension::<anchor_spl::token_interface::spl_token_metadata_interface::state::TokenMetadata>()
        .unwrap();
    assert_eq!(md.symbol, "PKZ27");
}

#[test]
fn rejects_bad_instrument_params() {
    let mut env = Env::new();
    let mint = Keypair::new();
    let issuer = env.issuer.insecure_clone();
    let mut i = env.init_instrument_ix(&issuer.pubkey(), &mint.pubkey(), false);
    // Patch frequency byte: rebuild with frequency 3.
    let mut params = plain_markets::InstrumentParams {
        name: "X".into(),
        symbol: "X".into(),
        uri: "".into(),
        isin: [0; 12],
        face_value: FACE,
        coupon_bps: 100,
        coupon_frequency: 3,
        issue_ts: T0,
        maturity_ts: T0 + DAY,
        allowlist_enabled: false,
        paying_agent: None,
    };
    i.data = ix::InitializeInstrument { params: params.clone() }.data();
    env.fails(&[i.clone()], &issuer, &[&mint], E::InvalidFrequency);
    params.coupon_frequency = 2;
    params.face_value = 0;
    i.data = ix::InitializeInstrument { params: params.clone() }.data();
    env.fails(&[i.clone()], &issuer, &[&mint], E::InvalidFaceValue);
    params.face_value = FACE;
    params.maturity_ts = T0 - 1;
    i.data = ix::InitializeInstrument { params }.data();
    env.fails(&[i], &issuer, &[&mint], E::InvalidMaturity);
}

#[test]
fn rejects_settlement_mint_with_transfer_hook() {
    let mut env = Env::new();
    let (bond_mint, _) = env.create_instrument(false);
    // Use an existing bond mint (Token-2022 + transfer hook) as the settlement mint of a new bond.
    let mint = Keypair::new();
    let issuer = env.issuer.insecure_clone();
    let mut i = env.init_instrument_ix(&issuer.pubkey(), &mint.pubkey(), false);
    i.accounts[4].pubkey = bond_mint; // settlement_mint
    i.accounts[5].pubkey = token_2022_id(); // settlement_token_program
    env.fails(&[i], &issuer, &[&mint], E::InvalidSettlementMint);
}

// ------------------------------------------------------------------------------------------------
// Coupon: full lifecycle + attacks
// ------------------------------------------------------------------------------------------------

#[test]
fn coupon_full_lifecycle_with_attacks() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let (alice, bob, carol) = (b.alice.insecure_clone(), b.bob.insecure_clone(), b.carol.insecure_clone());

    // Announce: amount per unit fixed on-chain = 1000 * 12.5% / 2 = 62.5 USD.
    let params = coupon_params(&b.env);
    let (record_ts, payment_ts, deadline) = (params.record_ts, params.payment_ts, params.claim_deadline);
    let action = b.env.announce(&b.instrument, params);
    let a = b.env.action(&action);
    assert_eq!(a.status, ActionStatus::Announced);
    assert_eq!(a.amount_per_unit, 62_500_000);
    assert_eq!(a.period, 1);
    let inst = b.env.instrument(&b.instrument);
    assert_eq!((inst.lock_from, inst.lock_until), (record_ts, payment_ts));
    assert_eq!(inst.pending_action, Some(0));

    // Before the record date the register moves freely: carol → alice 5 and back.
    let t = b.env.bond_transfer_ix(&b.mint, &carol.pubkey(), &alice.pubkey(), 5);
    b.env.ok(&t, &carol, &[]);
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &carol.pubkey(), 5);
    b.env.ok(&t, &alice, &[]);

    // Issuance is paused while an action is pending.
    let i = b.env.issue_ix(&issuer.pubkey(), &b.mint, &alice.pubkey(), 1, false);
    b.env.fails(&[i], &issuer, &[], E::PendingActionExists);

    // Record date cannot be locked early.
    let lock = b.env.lock_record_ix(&issuer.pubkey(), &b.instrument, &action);
    b.env.fails(&[lock.clone()], &issuer, &[], E::RecordDateNotReached);

    // ATTACK: transfer during the ex-date lock.
    b.env.set_time(record_ts);
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &bob.pubkey(), 1);
    b.env.fails(&t, &alice, &[], E::TransferLocked);

    // Lock record is a permissionless crank.
    let cranker = b.env.wallet();
    let lock = b.env.lock_record_ix(&cranker.pubkey(), &b.instrument, &action);
    b.env.ok(&[lock.clone()], &cranker, &[]);
    assert_eq!(b.env.action(&action).record_supply, 100);
    b.env.fails(&[lock], &cranker, &[], E::InvalidActionStatus);

    // Snapshot must reconcile with supply.
    let tree = Tree::new(action, b.holdings());
    let good = b.env.snapshot_params(&tree, ActionKind::Coupon, 0);
    let bad = SnapshotParams { total_units: 99, ..good.clone() };
    let s = b.env.snapshot_ix(&issuer.pubkey(), &b.instrument, &action, bad);
    b.env.fails(&[s], &issuer, &[], E::SupplyMismatch);
    let zero_root = SnapshotParams { merkle_root: [0; 32], ..good.clone() };
    let s = b.env.snapshot_ix(&issuer.pubkey(), &b.instrument, &action, zero_root);
    b.env.fails(&[s], &issuer, &[], E::InvalidSnapshotRoot);
    // ATTACK: non-issuer posts a snapshot.
    let mallory = b.env.wallet();
    let s = b.env.snapshot_ix(&mallory.pubkey(), &b.instrument, &action, good.clone());
    b.env.fails(&[s], &mallory, &[], E::NotIssuer);
    let s = b.env.snapshot_ix(&issuer.pubkey(), &b.instrument, &action, good);
    b.env.ok(&[s], &issuer, &[]);
    let a = b.env.action(&action);
    assert_eq!(a.status, ActionStatus::SnapshotPosted);
    assert_eq!(a.total_entitlement, 100 * 62_500_000);

    // ATTACK: claim before funding.
    let c = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), false);
    b.env.fails(&[c], &alice, &[], E::ActionNotFunded);

    // Funding in two tranches; over-funding rejected; claim still blocked while underfunded.
    let f = b.env.fund_ix(&issuer.pubkey(), &b.instrument, &action, 2_000_000_000);
    b.env.ok(&[f], &issuer, &[]);
    assert_eq!(b.env.action(&action).status, ActionStatus::SnapshotPosted);
    let s = b.env.settle_ix(&issuer.pubkey(), &b.instrument, &action, true);
    b.env.fails(&[s], &issuer, &[], E::ActionNotFunded);
    let f = b.env.fund_ix(&issuer.pubkey(), &b.instrument, &action, 4_250_000_001);
    b.env.fails(&[f], &issuer, &[], E::OverFunding);
    b.env.mint_usd(&mallory.pubkey(), 10);
    let f = b.env.fund_ix(&mallory.pubkey(), &b.instrument, &action, 1);
    b.env.fails(&[f], &mallory, &[], E::NotIssuer);
    let f = b.env.fund_ix(&issuer.pubkey(), &b.instrument, &action, 4_250_000_000);
    b.env.ok(&[f], &issuer, &[]);
    let a = b.env.action(&action);
    assert_eq!(a.status, ActionStatus::Funded);
    assert_eq!(b.env.token_balance(&vault_pda(&action)), 6_250_000_000);
    assert_eq!(b.env.instrument(&b.instrument).pending_action, None);

    // ATTACK: claim before payment date.
    let c = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), false);
    b.env.fails(&[c.clone()], &alice, &[], E::PaymentNotDue);

    b.env.set_time(payment_ts);
    // ATTACK: forged proof — alice claims bob's 30 units with her proof / inflates her units.
    let forged = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 51, tree.proof(&alice.pubkey()), false);
    b.env.fails(&[forged], &alice, &[], E::InvalidProof);
    // ATTACK: mallory replays alice's leaf/proof under her own key.
    let stolen = b.env.claim_ix(&mallory.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), false);
    b.env.fails(&[stolen], &mallory, &[], E::InvalidProof);
    // ATTACK: foreign proof — a tree built for another action with the same holdings.
    let foreign = Tree::new(Pubkey::new_unique(), b.holdings());
    let c2 = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 50, foreign.proof(&alice.pubkey()), false);
    b.env.fails(&[c2], &alice, &[], E::InvalidProof);

    // Alice pulls.
    b.env.ok(&[c.clone()], &alice, &[]);
    assert_eq!(b.env.token_balance(&usd_ata(&alice.pubkey(), &b.env.usd_mint)), 50 * 62_500_000);
    let r = b.env.receipt(&claim_pda(&action, &alice.pubkey()));
    assert_eq!((r.units, r.amount, r.burned_units, r.mode), (50, 3_125_000_000, 0, PaymentMode::Claim));
    assert_eq!(b.env.action(&action).status, ActionStatus::Settling);

    // ATTACK: double claim, and a pushed payment for an already-paid holder.
    b.env.fails(&[c], &alice, &[], E::AlreadyClaimed);
    let p = b.env.pay_ix(&issuer.pubkey(), &alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), false);
    b.env.fails(&[p], &issuer, &[], E::AlreadyClaimed);

    // ATTACK: random wallet tries to push payments.
    let p = b.env.pay_ix(&mallory.pubkey(), &bob.pubkey(), &b.instrument, &action, 30, tree.proof(&bob.pubkey()), false);
    b.env.fails(&[p], &mallory, &[], E::NotPayingAgent);

    // Delegate a paying agent; it pushes bob's coupon (bob signs nothing, ATA created for him).
    let agent = b.env.wallet();
    let set = b.env.issuer_only_ix(&issuer.pubkey(), &b.instrument, ix::SetPayingAgent { paying_agent: agent.pubkey() }.data());
    b.env.ok(&[set], &issuer, &[]);
    let p = b.env.pay_ix(&agent.pubkey(), &bob.pubkey(), &b.instrument, &action, 30, tree.proof(&bob.pubkey()), false);
    b.env.ok(&[p], &agent, &[]);
    assert_eq!(b.env.token_balance(&usd_ata(&bob.pubkey(), &b.env.usd_mint)), 30 * 62_500_000);
    assert_eq!(b.env.receipt(&claim_pda(&action, &bob.pubkey())).mode, PaymentMode::Push);

    // Settlement: outstanding entitlement + open window → nobody can close it.
    let s = b.env.settle_ix(&issuer.pubkey(), &b.instrument, &action, true);
    b.env.fails(&[s], &issuer, &[], E::ClaimWindowOpen);

    // Ex-date lock ended at the payment date: the register trades again.
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &bob.pubkey(), 10);
    b.env.ok(&t, &alice, &[]);

    // Carol claims later (snapshot entitlement unaffected by later trades), then anyone settles.
    let c = b.env.claim_ix(&carol.pubkey(), &b.instrument, &action, 20, tree.proof(&carol.pubkey()), false);
    b.env.ok(&[c], &carol, &[]);
    let s = b.env.settle_ix(&mallory.pubkey(), &b.instrument, &action, true);
    b.env.ok(&[s.clone()], &mallory, &[]);
    let a = b.env.action(&action);
    assert_eq!(a.status, ActionStatus::Settled);
    assert_eq!((a.paid_amount, a.paid_count, a.claimed_units, a.swept_amount), (6_250_000_000, 3, 100, 0));
    assert!(!b.env.exists(&vault_pda(&action)));
    assert_eq!(b.env.instrument(&b.instrument).open_actions, 0);
    let _ = deadline;
    // Claims after settlement are rejected: the paying vault is closed (rent back to the issuer).
    let c = b.env.claim_ix(&carol.pubkey(), &b.instrument, &action, 20, tree.proof(&carol.pubkey()), false);
    b.env.fails_code(&[c], &carol, &[], 3012);
}

#[test]
fn unclaimed_coupon_sweeps_back_after_deadline_issuer_only() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let alice = b.alice.insecure_clone();
    let params = coupon_params(&b.env);
    let (payment_ts, deadline) = (params.payment_ts, params.claim_deadline);
    let (action, tree) = b.to_snapshot(params);
    b.fund_all(&action);
    b.env.set_time(payment_ts);
    let c = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), false);
    b.env.ok(&[c], &alice, &[]);

    let issuer_usd = usd_ata(&issuer.pubkey(), &b.env.usd_mint);
    let before = b.env.token_balance(&issuer_usd);
    b.env.set_time(deadline);
    // ATTACK: non-issuer sweeps after the deadline.
    let s = b.env.settle_ix(&alice.pubkey(), &b.instrument, &action, true);
    b.env.fails(&[s], &alice, &[], E::NotIssuer);
    let s = b.env.settle_ix(&issuer.pubkey(), &b.instrument, &action, true);
    b.env.ok(&[s], &issuer, &[]);
    let a = b.env.action(&action);
    assert_eq!(a.swept_amount, 50 * 62_500_000);
    assert_eq!(b.env.token_balance(&issuer_usd) - before, 50 * 62_500_000);
    assert_eq!(a.status, ActionStatus::Settled);
}

// ------------------------------------------------------------------------------------------------
// Redemptions
// ------------------------------------------------------------------------------------------------

#[test]
fn partial_then_final_redemption_burns_and_redeems() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let (alice, bob, carol) = (b.alice.insecure_clone(), b.bob.insecure_clone(), b.carol.insecure_clone());

    // --- partial: 25% of every holding at par (alice 50→12 burned, bob 30→7, carol 20→5) ---
    let mut p = b.env.announce_params(ActionKind::PartialRedemption, DAY, 2 * DAY, 30 * DAY);
    p.redeem_bps = 2500;
    p.price_bps = 10_000;
    let payment_ts = p.payment_ts;
    let (action, tree) = b.to_snapshot(p);
    let a = b.env.action(&action);
    assert_eq!(a.total_redeem_units, 12 + 7 + 5);
    assert_eq!(a.total_entitlement, 24 * FACE);
    assert_eq!(b.env.instrument(&b.instrument).lock_until, i64::MAX);

    // Posted redeem total outside per-holder rounding bounds is rejected.
    // (separate instrument state is fine: just check the bound math through a fresh action later)

    b.fund_all(&action);
    b.env.set_time(payment_ts);
    // Lock persists after the payment date for redemptions: units must stay put until burned.
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &bob.pubkey(), 1);
    b.env.fails(&t, &alice, &[], E::TransferLocked);
    // Redemption needs the holder's bond account.
    let c = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), false);
    b.env.fails(&[c], &alice, &[], E::MissingHolderBondAccount);
    let c = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), true);
    b.env.ok(&[c.clone()], &alice, &[]);
    assert_eq!(b.env.token_balance(&bond_ata(&alice.pubkey(), &b.mint)), 38);
    assert_eq!(b.env.token_balance(&usd_ata(&alice.pubkey(), &b.env.usd_mint)), 12 * FACE);
    assert_eq!(b.env.mint_supply(&b.mint), 88);
    // ATTACK: redeem twice.
    b.env.fails(&[c], &alice, &[], E::AlreadyClaimed);
    for h in [&bob, &carol] {
        let units = tree.units(&h.pubkey());
        let pi = b.env.pay_ix(&issuer.pubkey(), &h.pubkey(), &b.instrument, &action, units, tree.proof(&h.pubkey()), true);
        b.env.ok(&[pi], &issuer, &[]);
    }
    assert_eq!(b.env.mint_supply(&b.mint), 76);
    // ATTACK: announcing anything while the redemption is open.
    let ann = b.env.announce_ix(&issuer.pubkey(), &b.instrument, coupon_params(&b.env));
    b.env.fails(&[ann], &issuer, &[], E::RedemptionInProgress);
    let s = b.env.settle_ix(&bob.pubkey(), &b.instrument, &action, true);
    b.env.ok(&[s], &bob, &[]);
    let inst = b.env.instrument(&b.instrument);
    assert_eq!(inst.redeemed_units, 24);
    assert!(!inst.is_locked(b.env.now()));
    assert_eq!(inst.status, InstrumentStatus::Active);
    // Register unlocked after settlement.
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &bob.pubkey(), 8);
    b.env.ok(&t, &alice, &[]);

    // --- final: par + final coupon, burns everything; alice 30, bob 31, carol 15 ---
    let holdings = vec![(alice.pubkey(), 30), (bob.pubkey(), 31), (carol.pubkey(), 15)];
    let mut p = b.env.announce_params(ActionKind::FinalRedemption, DAY, 2 * DAY, 30 * DAY);
    p.price_bps = 10_000;
    p.rate_bps = COUPON_BPS;
    let (record_ts, payment_ts) = (p.record_ts, p.payment_ts);
    let action = b.env.announce(&b.instrument, p);
    b.env.set_time(record_ts);
    let l = b.env.lock_record_ix(&issuer.pubkey(), &b.instrument, &action);
    b.env.ok(&[l], &issuer, &[]);
    let tree = Tree::new(action, holdings);
    let sp = b.env.snapshot_params(&tree, ActionKind::FinalRedemption, 0);
    let s = b.env.snapshot_ix(&issuer.pubkey(), &b.instrument, &action, sp);
    b.env.ok(&[s], &issuer, &[]);
    let per_unit = FACE + 62_500_000;
    assert_eq!(b.env.action(&action).total_entitlement, 76 * per_unit);
    b.fund_all(&action);
    assert_eq!(b.env.instrument(&b.instrument).status, InstrumentStatus::Matured);

    b.env.set_time(payment_ts);
    for h in [&alice, &bob] {
        let units = tree.units(&h.pubkey());
        let c = b.env.claim_ix(&h.pubkey(), &b.instrument, &action, units, tree.proof(&h.pubkey()), true);
        b.env.ok(&[c], h, &[]);
        assert_eq!(b.env.token_balance(&bond_ata(&h.pubkey(), &b.mint)), 0);
    }
    assert_eq!(b.env.instrument(&b.instrument).status, InstrumentStatus::Matured);
    let c = b.env.claim_ix(&carol.pubkey(), &b.instrument, &action, 15, tree.proof(&carol.pubkey()), true);
    b.env.ok(&[c.clone()], &carol, &[]);
    // Supply hit zero inside carol's claim → instrument Redeemed atomically.
    assert_eq!(b.env.mint_supply(&b.mint), 0);
    let inst = b.env.instrument(&b.instrument);
    assert_eq!(inst.status, InstrumentStatus::Redeemed);
    assert_eq!(inst.redeemed_units, 100);
    // ATTACK: redeem twice after redemption.
    b.env.fails(&[c], &carol, &[], E::AlreadyClaimed);
    let s = b.env.settle_ix(&carol.pubkey(), &b.instrument, &action, true);
    b.env.ok(&[s], &carol, &[]);
    // Nothing more can be announced or issued on a redeemed instrument.
    let ann = b.env.announce_ix(&issuer.pubkey(), &b.instrument, coupon_params(&b.env));
    b.env.fails(&[ann], &issuer, &[], E::InstrumentNotActive);
    let i = b.env.issue_ix(&issuer.pubkey(), &b.mint, &alice.pubkey(), 1, false);
    b.env.fails(&[i], &issuer, &[], E::InstrumentNotActive);
}

#[test]
fn partial_redeem_total_must_respect_rounding_bounds() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let mut p = b.env.announce_params(ActionKind::PartialRedemption, DAY, 2 * DAY, 30 * DAY);
    p.redeem_bps = 3333;
    p.price_bps = 10_000;
    let record_ts = p.record_ts;
    let action = b.env.announce(&b.instrument, p);
    b.env.set_time(record_ts);
    let l = b.env.lock_record_ix(&issuer.pubkey(), &b.instrument, &action);
    b.env.ok(&[l], &issuer, &[]);
    let tree = Tree::new(action, b.holdings());
    let good = b.env.snapshot_params(&tree, ActionKind::PartialRedemption, 3333);
    // floor(100 * 33.33%) = 33; per holder 16 + 9 + 6 = 31; bounds [31, 33] for 3 holders.
    assert_eq!(good.total_redeem_units, 31);
    for bad in [30, 34] {
        let s = b.env.snapshot_ix(&issuer.pubkey(), &b.instrument, &action, SnapshotParams { total_redeem_units: bad, ..good.clone() });
        b.env.fails(&[s], &issuer, &[], E::RedeemTotalOutOfBounds);
    }
    let s = b.env.snapshot_ix(&issuer.pubkey(), &b.instrument, &action, good);
    b.env.ok(&[s], &issuer, &[]);
}

#[test]
fn unclaimed_final_redemption_keeps_instrument_matured() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let alice = b.alice.insecure_clone();
    let mut p = b.env.announce_params(ActionKind::FinalRedemption, DAY, 2 * DAY, 10 * DAY);
    p.price_bps = 10_000;
    let (payment_ts, deadline) = (p.payment_ts, p.claim_deadline);
    let (action, tree) = b.to_snapshot(p);
    b.fund_all(&action);
    b.env.set_time(payment_ts);
    let c = b.env.claim_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), true);
    b.env.ok(&[c], &alice, &[]);
    b.env.set_time(deadline);
    let s = b.env.settle_ix(&issuer.pubkey(), &b.instrument, &action, true);
    b.env.ok(&[s], &issuer, &[]);
    let inst = b.env.instrument(&b.instrument);
    assert_eq!(inst.status, InstrumentStatus::Matured);
    assert_eq!(b.env.action(&action).swept_amount, 50 * FACE);
    // Outstanding units of a matured bond stay frozen.
    let t = b.env.bond_transfer_ix(&b.mint, &b.bob.pubkey(), &alice.pubkey(), 1);
    let bob = b.bob.insecure_clone();
    b.env.fails(&t, &bob, &[], E::TransferLocked);
}

// ------------------------------------------------------------------------------------------------
// Votes
// ------------------------------------------------------------------------------------------------

#[test]
fn vote_tally_is_weighted_by_snapshot_units() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let (alice, bob, carol) = (b.alice.insecure_clone(), b.bob.insecure_clone(), b.carol.insecure_clone());
    let mut p = b.env.announce_params(ActionKind::Vote, DAY, 5 * DAY, 5 * DAY);
    p.options = vec!["For".into(), "Against".into(), "Abstain".into()];
    let close = p.payment_ts;
    let (action, tree) = b.to_snapshot(p);
    // Votes need no funding; the next action may be announced while voting runs.
    assert_eq!(b.env.instrument(&b.instrument).pending_action, None);
    // Votes have no paying vault at all.
    assert!(!b.env.exists(&vault_pda(&action)));
    let f = b.env.fund_ix(&issuer.pubkey(), &b.instrument, &action, 1);
    b.env.fails_code(&[f], &issuer, &[], 3012);

    let v = b.env.vote_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), 3);
    b.env.fails(&[v], &alice, &[], E::InvalidVoteChoice);
    let v = b.env.vote_ix(&alice.pubkey(), &b.instrument, &action, 60, tree.proof(&alice.pubkey()), 1);
    b.env.fails(&[v], &alice, &[], E::InvalidProof);
    let v = b.env.vote_ix(&alice.pubkey(), &b.instrument, &action, 50, tree.proof(&alice.pubkey()), 1);
    b.env.ok(&[v.clone()], &alice, &[]);
    b.env.fails(&[v], &alice, &[], E::AlreadyVoted);
    let v = b.env.vote_ix(&bob.pubkey(), &b.instrument, &action, 30, tree.proof(&bob.pubkey()), 0);
    b.env.ok(&[v], &bob, &[]);
    let v = b.env.vote_ix(&carol.pubkey(), &b.instrument, &action, 20, tree.proof(&carol.pubkey()), 0);
    b.env.ok(&[v], &carol, &[]);
    // Claim/pay are not available on a vote.
    let c = b.env.claim_ix(&carol.pubkey(), &b.instrument, &action, 20, tree.proof(&carol.pubkey()), false);
    b.env.fails_code(&[c], &carol, &[], 3012); // vault does not exist (AccountNotInitialized)

    // ATTACK: cancel after ballots were cast.
    let x = b.env.cancel_ix(&issuer.pubkey(), &b.instrument, &action, false);
    b.env.fails(&[x], &issuer, &[], E::VotesAlreadyCast);

    let s = b.env.settle_ix(&issuer.pubkey(), &b.instrument, &action, false);
    b.env.fails(&[s.clone()], &issuer, &[], E::VotingNotClosed);
    b.env.set_time(close);
    let v = b.env.vote_ix(&carol.pubkey(), &b.instrument, &action, 20, tree.proof(&carol.pubkey()), 0);
    b.env.fails(&[v], &carol, &[], E::VotingClosed);
    b.env.ok(&[s], &issuer, &[]);
    let a = b.env.action(&action);
    assert_eq!(&a.tally[..3], &[50, 50, 0]);
    // 50/50 tie → no winner.
    assert_eq!(a.winning_option, None);
    assert_eq!(a.status, ActionStatus::Settled);
    assert_eq!(a.votes_cast, 3);
}

#[test]
fn vote_majority_wins() {
    let mut b = setup(false);
    let (alice, bob) = (b.alice.insecure_clone(), b.bob.insecure_clone());
    let mut p = b.env.announce_params(ActionKind::Vote, DAY, 5 * DAY, 5 * DAY);
    p.options = vec!["Approve".into(), "Reject".into()];
    let close = p.payment_ts;
    let (action, tree) = b.to_snapshot(p);
    for (h, c) in [(&alice, 1u8), (&bob, 0u8)] {
        let units = tree.units(&h.pubkey());
        let v = b.env.vote_ix(&h.pubkey(), &b.instrument, &action, units, tree.proof(&h.pubkey()), c);
        b.env.ok(&[v], h, &[]);
    }
    b.env.set_time(close);
    let anyone = b.env.wallet();
    let s = b.env.settle_ix(&anyone.pubkey(), &b.instrument, &action, false);
    b.env.ok(&[s], &anyone, &[]);
    assert_eq!(b.env.action(&action).winning_option, Some(1));
}

// ------------------------------------------------------------------------------------------------
// Allowlist + transfer hook
// ------------------------------------------------------------------------------------------------

#[test]
fn allowlist_blocks_non_allowlisted_destination() {
    let mut b = setup(true);
    let issuer = b.env.issuer.insecure_clone();
    let alice = b.alice.insecure_clone();
    let outsider = b.env.wallet();

    // Transfer to an allowlisted holder works.
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &b.bob.pubkey(), 1);
    b.env.ok(&t, &alice, &[]);
    // ATTACK: transfer to a wallet that is not allowlisted.
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &outsider.pubkey(), 1);
    b.env.fails(&t, &alice, &[], E::DestinationNotAllowlisted);
    // Issuance to non-allowlisted wallet also blocked.
    let i = b.env.issue_ix(&issuer.pubkey(), &b.mint, &outsider.pubkey(), 1, false);
    b.env.fails(&[i], &issuer, &[], E::AllowlistEntryRequired);
    // ATTACK: outsider allowlists itself.
    let a = b.env.allow_ix(&outsider.pubkey(), &b.instrument, &outsider.pubkey());
    b.env.fails(&[a], &outsider, &[], E::NotIssuer);

    let a = b.env.allow_ix(&issuer.pubkey(), &b.instrument, &outsider.pubkey());
    b.env.ok(&[a], &issuer, &[]);
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &outsider.pubkey(), 1);
    b.env.ok(&t, &alice, &[]);

    // Turning the allowlist off opens transfers; non-issuer cannot toggle it.
    let stranger = b.env.wallet();
    let toggle = b.env.issuer_only_ix(&stranger.pubkey(), &b.instrument, ix::SetAllowlist { enabled: false }.data());
    b.env.fails(&[toggle], &stranger, &[], E::NotIssuer);
    let toggle = b.env.issuer_only_ix(&issuer.pubkey(), &b.instrument, ix::SetAllowlist { enabled: false }.data());
    b.env.ok(&[toggle], &issuer, &[]);
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &stranger.pubkey(), 1);
    b.env.ok(&t, &alice, &[]);
}

#[test]
fn hook_cannot_be_invoked_outside_a_transfer() {
    let mut b = setup(false);
    let alice = b.alice.insecure_clone();
    let accounts = plain_markets::accounts::TransferHook {
        source_token: bond_ata(&alice.pubkey(), &b.mint),
        mint: b.mint,
        destination_token: bond_ata(&b.bob.pubkey(), &b.mint),
        owner: alice.pubkey(),
        extra_account_meta_list: metas_pda(&b.mint),
        instrument: b.instrument,
        allow_entry: allow_pda(&b.instrument, &b.bob.pubkey()),
    };
    use anchor_lang::ToAccountMetas;
    let i = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        plain_markets::ID,
        &ix::TransferHook { amount: 1 }.data(),
        accounts.to_account_metas(None),
    );
    b.env.fails(&[i], &alice, &[], E::NotTransferring);
}

// ------------------------------------------------------------------------------------------------
// Admin / state machine guards
// ------------------------------------------------------------------------------------------------

#[test]
fn non_issuer_admin_calls_fail() {
    let mut b = setup(false);
    let mallory = b.env.wallet();
    let a = b.env.announce_ix(&mallory.pubkey(), &b.instrument, coupon_params(&b.env));
    b.env.fails(&[a], &mallory, &[], E::NotIssuer);
    let set = b.env.issuer_only_ix(&mallory.pubkey(), &b.instrument, ix::SetPayingAgent { paying_agent: mallory.pubkey() }.data());
    b.env.fails(&[set], &mallory, &[], E::NotIssuer);
    let i = b.env.issue_ix(&mallory.pubkey(), &b.mint, &mallory.pubkey(), 1_000, false);
    b.env.fails(&[i], &mallory, &[], E::NotIssuer);
    let action = b.env.announce(&b.instrument, coupon_params(&b.env));
    let c = b.env.cancel_ix(&mallory.pubkey(), &b.instrument, &action, false);
    b.env.fails(&[c], &mallory, &[], E::NotIssuer);
}

#[test]
fn schedule_and_parameter_validation() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let mut p = coupon_params(&b.env);
    p.payment_ts = p.record_ts;
    let a = b.env.announce_ix(&issuer.pubkey(), &b.instrument, p);
    b.env.fails(&[a], &issuer, &[], E::InvalidSchedule);
    let mut p = coupon_params(&b.env);
    p.record_ts = b.env.now() - 1;
    let a = b.env.announce_ix(&issuer.pubkey(), &b.instrument, p);
    b.env.fails(&[a], &issuer, &[], E::InvalidSchedule);
    let mut p = coupon_params(&b.env);
    p.price_bps = 100;
    let a = b.env.announce_ix(&issuer.pubkey(), &b.instrument, p);
    b.env.fails(&[a], &issuer, &[], E::UnexpectedParameter);
    let mut p = b.env.announce_params(ActionKind::PartialRedemption, DAY, 2 * DAY, 3 * DAY);
    p.redeem_bps = 10_000;
    p.price_bps = 10_000;
    let a = b.env.announce_ix(&issuer.pubkey(), &b.instrument, p);
    b.env.fails(&[a], &issuer, &[], E::InvalidRedeemShare);
    let mut p = b.env.announce_params(ActionKind::Vote, DAY, 2 * DAY, 2 * DAY);
    p.options = vec!["only".into()];
    let a = b.env.announce_ix(&issuer.pubkey(), &b.instrument, p);
    b.env.fails(&[a], &issuer, &[], E::InvalidVoteOptions);

    // One pending action at a time.
    b.env.announce(&b.instrument, coupon_params(&b.env));
    let a = b.env.announce_ix(&issuer.pubkey(), &b.instrument, coupon_params(&b.env));
    b.env.fails(&[a], &issuer, &[], E::PendingActionExists);
}

#[test]
fn cancel_refunds_partial_funding_and_restores_lock() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let alice = b.alice.insecure_clone();
    let issuer_usd = usd_ata(&issuer.pubkey(), &b.env.usd_mint);
    let start = b.env.token_balance(&issuer_usd);
    let (action, _) = b.to_snapshot(coupon_params(&b.env));
    let f = b.env.fund_ix(&issuer.pubkey(), &b.instrument, &action, 1_000_000);
    b.env.ok(&[f], &issuer, &[]);
    // Funds exist → vault accounts are mandatory.
    let x = b.env.cancel_ix(&issuer.pubkey(), &b.instrument, &action, false);
    b.env.fails(&[x], &issuer, &[], E::MissingSettlementAccounts);
    let x = b.env.cancel_ix(&issuer.pubkey(), &b.instrument, &action, true);
    b.env.ok(&[x], &issuer, &[]);
    assert_eq!(b.env.token_balance(&issuer_usd), start);
    assert!(!b.env.exists(&vault_pda(&action)));
    assert_eq!(b.env.action(&action).status, ActionStatus::Cancelled);
    let inst = b.env.instrument(&b.instrument);
    assert_eq!((inst.lock_from, inst.lock_until, inst.pending_action, inst.open_actions, inst.coupon_periods), (0, 0, None, 0, 0));
    // Register unlocked again; the cancelled action is dead.
    let t = b.env.bond_transfer_ix(&b.mint, &alice.pubkey(), &b.bob.pubkey(), 1);
    b.env.ok(&t, &alice, &[]);
    let x = b.env.cancel_ix(&issuer.pubkey(), &b.instrument, &action, false);
    b.env.fails(&[x], &issuer, &[], E::InvalidActionStatus);
}

#[test]
fn funded_actions_cannot_be_cancelled_and_supply_cannot_change_under_snapshot() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let (action, _) = b.to_snapshot(coupon_params(&b.env));
    b.fund_all(&action);
    let x = b.env.cancel_ix(&issuer.pubkey(), &b.instrument, &action, true);
    b.env.fails(&[x], &issuer, &[], E::InvalidActionStatus);
    // Register still locked until payment: issuance refused.
    let i = b.env.issue_ix(&issuer.pubkey(), &b.mint, &b.alice.pubkey(), 1, false);
    b.env.fails(&[i], &issuer, &[], E::RegisterLocked);
}

#[test]
fn next_coupon_lock_window_merges_with_running_lock() {
    let mut b = setup(false);
    let issuer = b.env.issuer.insecure_clone();
    let p1 = coupon_params(&b.env);
    let (record1, pay1) = (p1.record_ts, p1.payment_ts);
    let (a1, _) = b.to_snapshot(p1);
    b.fund_all(&a1);
    // Still inside lock 1: a record date after lock 1 ends would leave an unlocked gap → refused.
    let mut p2 = b.env.announce_params(ActionKind::Coupon, 30 * DAY, 40 * DAY, 60 * DAY);
    let a = b.env.announce_ix(&issuer.pubkey(), &b.instrument, p2.clone());
    b.env.fails(&[a], &issuer, &[], E::LockStillRunning);
    // Record date inside the running lock merges the windows.
    p2.record_ts = pay1 - 1;
    p2.payment_ts = pay1 + 10 * DAY;
    let new_pay = p2.payment_ts;
    let a2 = b.env.announce(&b.instrument, p2);
    let inst = b.env.instrument(&b.instrument);
    assert_eq!((inst.lock_from, inst.lock_until), (record1, new_pay));
    assert_eq!(b.env.action(&a2).period, 2);
    let _ = math::coupon_per_unit;
}
