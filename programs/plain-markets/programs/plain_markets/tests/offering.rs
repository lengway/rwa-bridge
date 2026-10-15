//! Primary offering: delivery-versus-payment `subscribe`, issuer proceeds withdrawal, and attacks
//! (run `anchor build` first; `cargo test` loads target/deploy/plain_markets.so).

mod common;

use anchor_lang::prelude::Pubkey;
use anchor_spl::token::spl_token;
use common::*;
use plain_markets::{error::MarketsError as E, ActionKind, OfferingParams};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// 1.000000 USD per unit.
const PRICE: u64 = 1_000_000;
const CAP: u64 = 1_000;
const HOLDER_CAP: u64 = 100;

// Anchor framework error codes.
const CONSTRAINT_HAS_ONE: u32 = 2001;
const CONSTRAINT_SEEDS: u32 = 2006;
const CONSTRAINT_TOKEN_MINT: u32 = 2014;
const CONSTRAINT_TOKEN_OWNER: u32 = 2015;
const ACCOUNT_NOT_INITIALIZED: u32 = 3012;
// SPL Token `InsufficientFunds`.
const SPL_INSUFFICIENT_FUNDS: u32 = 1;

struct Sale {
    env: Env,
    mint: Pubkey,
    instrument: Pubkey,
}

fn params(env: &Env) -> OfferingParams {
    OfferingParams {
        issue_price: PRICE,
        start_ts: env.now(),
        end_ts: env.now() + 90 * DAY,
        cap_units: CAP,
        per_holder_cap: HOLDER_CAP,
    }
}

fn open(allowlist: bool) -> Sale {
    let mut env = Env::new();
    let (mint, instrument) = env.create_instrument(allowlist);
    let issuer = env.issuer.insecure_clone();
    let p = params(&env);
    let o = env.open_offering_ix(&issuer.pubkey(), &instrument, p);
    env.ok(&[o], &issuer, &[]);
    Sale { env, mint, instrument }
}

impl Sale {
    /// Wallet holding `usd` settlement units.
    fn buyer(&mut self, usd: u64) -> Keypair {
        let w = self.env.wallet();
        self.env.mint_usd(&w.pubkey(), usd);
        w
    }
    fn buy(&mut self, buyer: &Keypair, units: u64) {
        let allow = self.env.instrument(&self.instrument).allowlist_enabled;
        let ixs = self.env.subscribe_ixs(&buyer.pubkey(), &self.mint, units, units * PRICE, allow);
        self.env.ok(&ixs, buyer, &[]);
    }
    fn fails_buy(&mut self, buyer: &Keypair, units: u64, expected: E) {
        let ixs = self.env.subscribe_ixs(&buyer.pubkey(), &self.mint, units, units * PRICE, false);
        self.env.fails(&ixs, buyer, &[], expected);
    }
}

#[test]
fn subscribe_is_delivery_versus_payment() {
    let mut s = open(false);
    let buyer = s.buyer(50 * PRICE);
    let usd = usd_ata(&buyer.pubkey(), &s.env.usd_mint);
    let vault = proceeds_pda(&s.instrument);
    let offering = offering_pda(&s.instrument);

    let o = s.env.offering(&offering);
    assert_eq!((o.issue_price, o.cap_units, o.per_holder_cap, o.sold_units), (PRICE, CAP, HOLDER_CAP, 0));
    assert_eq!(o.proceeds_vault, vault);

    s.buy(&buyer, 12);
    assert_eq!(s.env.token_balance(&usd), 38 * PRICE);
    assert_eq!(s.env.token_balance(&vault), 12 * PRICE);
    assert_eq!(s.env.token_balance(&bond_ata(&buyer.pubkey(), &s.mint)), 12);
    assert_eq!(s.env.mint_supply(&s.mint), 12);
    let o = s.env.offering(&offering);
    assert_eq!((o.sold_units, o.proceeds, o.purchases), (12, 12 * PRICE, 1));
    assert_eq!(s.env.instrument(&s.instrument).issued_units, 12);

    // A second purchase tops up the same account; the bond ATA creation is idempotent.
    s.buy(&buyer, 3);
    assert_eq!(s.env.token_balance(&bond_ata(&buyer.pubkey(), &s.mint)), 15);
    assert_eq!(s.env.offering(&offering).sold_units, 15);

    // Issuer placement still works next to the offering and is not counted as sold.
    let other = s.env.wallet();
    s.env.issue(&s.mint, &other.pubkey(), 5);
    assert_eq!(s.env.offering(&offering).sold_units, 15);
    assert_eq!(s.env.mint_supply(&s.mint), 20);
}

#[test]
fn underpayment_is_rejected_atomically() {
    let mut s = open(false);
    let buyer = s.buyer(5 * PRICE);
    let usd = usd_ata(&buyer.pubkey(), &s.env.usd_mint);

    // ATTACK: max_payment below units × price.
    let ixs = s.env.subscribe_ixs(&buyer.pubkey(), &s.mint, 3, 3 * PRICE - 1, false);
    s.env.fails(&ixs, &buyer, &[], E::PaymentExceedsMax);
    // ATTACK: not enough settlement balance — the token program refuses the payment leg and the
    // whole instruction (including the mint) reverts.
    let ixs = s.env.subscribe_ixs(&buyer.pubkey(), &s.mint, 6, 6 * PRICE, false);
    s.env.fails_code(&ixs, &buyer, &[], SPL_INSUFFICIENT_FUNDS);
    assert_eq!(s.env.token_balance(&usd), 5 * PRICE);
    assert_eq!(s.env.mint_supply(&s.mint), 0);
    // ATTACK: zero units.
    let ixs = s.env.subscribe_ixs(&buyer.pubkey(), &s.mint, 0, 0, false);
    s.env.fails(&ixs, &buyer, &[], E::ZeroUnits);
}

#[test]
fn wrong_mints_and_accounts_are_rejected() {
    let mut s = open(false);
    let buyer = s.buyer(10 * PRICE);
    let thief = s.buyer(10 * PRICE);
    let bpk = buyer.pubkey();
    let create = s.subscribe_create(&bpk);
    s.env.ok(&[create], &buyer, &[]);

    // ATTACK: pay with a different (worthless) token.
    let fake_auth = Keypair::new();
    let fake = create_fake_mint(&mut s.env, &fake_auth);
    let fake_ata = fund_fake(&mut s.env, &fake, &fake_auth, &bpk, 10 * PRICE);
    let mut a = s.env.subscribe_accounts(&bpk, &s.mint, false);
    a.settlement_mint = fake;
    a.buyer_settlement = fake_ata;
    let i = s.env.subscribe_with(a, 1, PRICE);
    s.env.fails_code(&[i], &buyer, &[], CONSTRAINT_HAS_ONE);
    // ... or a fake-token account with the real settlement mint declared.
    let mut a = s.env.subscribe_accounts(&bpk, &s.mint, false);
    a.buyer_settlement = fake_ata;
    let i = s.env.subscribe_with(a, 1, PRICE);
    s.env.fails_code(&[i], &buyer, &[], CONSTRAINT_TOKEN_MINT);

    // ATTACK: redirect the payment into an account the buyer controls instead of the vault.
    let mut a = s.env.subscribe_accounts(&bpk, &s.mint, false);
    a.proceeds_vault = usd_ata(&thief.pubkey(), &s.env.usd_mint);
    let i = s.env.subscribe_with(a, 1, PRICE);
    s.env.fails_code(&[i], &buyer, &[], CONSTRAINT_HAS_ONE);

    // ATTACK: spend someone else's settlement account.
    let mut a = s.env.subscribe_accounts(&bpk, &s.mint, false);
    a.buyer_settlement = usd_ata(&thief.pubkey(), &s.env.usd_mint);
    let i = s.env.subscribe_with(a, 1, PRICE);
    s.env.fails_code(&[i], &buyer, &[], CONSTRAINT_TOKEN_OWNER);

    // ATTACK: deliver the units to a non-canonical bond account (someone else's ATA).
    let tpk = thief.pubkey();
    let create = s.subscribe_create(&tpk);
    s.env.ok(&[create], &thief, &[]);
    let mut a = s.env.subscribe_accounts(&bpk, &s.mint, false);
    a.buyer_bond = bond_ata(&tpk, &s.mint);
    let i = s.env.subscribe_with(a, 1, PRICE);
    s.env.fails_code(&[i], &buyer, &[], CONSTRAINT_TOKEN_OWNER);

    // ATTACK: a bond mint of another instrument.
    let (other_mint, _) = s.env.create_instrument(false);
    let create = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &bpk,
        &bpk,
        &other_mint,
        &token_2022_id(),
    );
    s.env.ok(&[create], &buyer, &[]);
    let mut a = s.env.subscribe_accounts(&bpk, &s.mint, false);
    a.mint = other_mint;
    a.buyer_bond = bond_ata(&bpk, &other_mint);
    let i = s.env.subscribe_with(a, 1, PRICE);
    s.env.fails_code(&[i], &buyer, &[], CONSTRAINT_HAS_ONE);

    // ATTACK: the other instrument has no offering at all.
    let ixs = s.env.subscribe_ixs(&bpk, &other_mint, 1, PRICE, false);
    s.env.fails_code(&ixs, &buyer, &[], ACCOUNT_NOT_INITIALIZED);

    assert_eq!(s.env.mint_supply(&s.mint), 0);
    s.buy(&buyer, 1);
}

#[test]
fn caps_are_enforced() {
    let mut s = open(false);
    let whale = s.buyer(10_000 * PRICE);
    // ATTACK: above the per-holder cap in one go, then by topping up.
    s.fails_buy(&whale, HOLDER_CAP + 1, E::HolderCapExceeded);
    s.buy(&whale, HOLDER_CAP);
    s.fails_buy(&whale, 1, E::HolderCapExceeded);

    // Fill the offering to its total cap with other buyers.
    for _ in 0..9 {
        let b = s.buyer(HOLDER_CAP * PRICE);
        s.buy(&b, HOLDER_CAP);
    }
    assert_eq!(s.env.offering(&offering_pda(&s.instrument)).sold_units, CAP);
    let late = s.buyer(PRICE);
    s.fails_buy(&late, 1, E::OfferingSoldOut);
}

#[test]
fn window_close_and_maturity_are_enforced() {
    let mut env = Env::new();
    let (mint, instrument) = env.create_instrument(false);
    let issuer = env.issuer.insecure_clone();
    let start = env.now() + DAY;
    let o = env.open_offering_ix(
        &issuer.pubkey(),
        &instrument,
        OfferingParams { issue_price: PRICE, start_ts: start, end_ts: start + 10 * DAY, cap_units: CAP, per_holder_cap: HOLDER_CAP },
    );
    env.ok(&[o], &issuer, &[]);
    let mut s = Sale { env, mint, instrument };
    let buyer = s.buyer(100 * PRICE);

    // ATTACK: before the window opens.
    s.fails_buy(&buyer, 1, E::OfferingNotOpen);
    s.env.set_time(start);
    s.buy(&buyer, 1);
    // ATTACK: after the window closes.
    s.env.set_time(start + 10 * DAY);
    s.fails_buy(&buyer, 1, E::OfferingNotOpen);
    // ATTACK: after maturity.
    s.env.set_time(T0 + 366 * DAY);
    s.fails_buy(&buyer, 1, E::InstrumentMatured);

    // Close: only the issuer, then nothing sells even inside a window.
    let mut s = open(false);
    let buyer = s.buyer(100 * PRICE);
    let stranger = s.env.wallet();
    let c = s.env.close_offering_ix(&stranger.pubkey(), &s.instrument);
    s.env.fails(&[c], &stranger, &[], E::NotIssuer);
    let issuer = s.env.issuer.insecure_clone();
    let c = s.env.close_offering_ix(&issuer.pubkey(), &s.instrument);
    s.env.ok(&[c], &issuer, &[]);
    s.fails_buy(&buyer, 1, E::OfferingClosed);
    let c = s.env.close_offering_ix(&issuer.pubkey(), &s.instrument);
    s.env.fails(&[c], &issuer, &[], E::OfferingClosed);

    // Bad parameters.
    let mut env = Env::new();
    let (_, instrument) = env.create_instrument(false);
    let issuer = env.issuer.insecure_clone();
    let now = env.now();
    for bad in [
        OfferingParams { issue_price: 0, start_ts: now, end_ts: now + DAY, cap_units: 10, per_holder_cap: 1 },
        OfferingParams { issue_price: 1, start_ts: now, end_ts: now, cap_units: 10, per_holder_cap: 1 },
        OfferingParams { issue_price: 1, start_ts: now, end_ts: T0 + 400 * DAY, cap_units: 10, per_holder_cap: 1 },
        OfferingParams { issue_price: 1, start_ts: now, end_ts: now + DAY, cap_units: 0, per_holder_cap: 0 },
        OfferingParams { issue_price: 1, start_ts: now, end_ts: now + DAY, cap_units: 10, per_holder_cap: 11 },
    ] {
        let o = env.open_offering_ix(&issuer.pubkey(), &instrument, bad);
        env.fails(&[o], &issuer, &[], E::InvalidOfferingParams);
    }
    // ATTACK: a stranger opens an offering on someone else's instrument.
    let stranger = env.wallet();
    let p = params(&env);
    let o = env.open_offering_ix(&stranger.pubkey(), &instrument, p);
    env.fails(&[o], &stranger, &[], E::NotIssuer);
}

#[test]
fn register_lock_and_pending_actions_block_subscriptions() {
    let mut s = open(false);
    let buyer = s.buyer(100 * PRICE);
    s.buy(&buyer, 10);
    let issuer = s.env.issuer.insecure_clone();
    let ip = issuer.pubkey();
    s.env.mint_usd(&ip, 1_000_000 * PRICE);

    // Announce a coupon: the register must not change before the snapshot is funded.
    let p = s.env.announce_params(ActionKind::Coupon, 10 * DAY, 15 * DAY, 45 * DAY);
    let record_ts = p.record_ts;
    let action = s.env.announce(&s.instrument, p);
    // ATTACK: buy while an action is pending.
    s.fails_buy(&buyer, 1, E::PendingActionExists);

    s.env.set_time(record_ts);
    let lock = s.env.lock_record_ix(&ip, &s.instrument, &action);
    s.env.ok(&[lock], &issuer, &[]);
    let tree = Tree::new(action, vec![(buyer.pubkey(), 10)]);
    let sp = s.env.snapshot_params(&tree, ActionKind::Coupon, 0);
    let snap = s.env.snapshot_ix(&ip, &s.instrument, &action, sp);
    s.env.ok(&[snap], &issuer, &[]);
    let total = s.env.action(&action).total_entitlement;
    let f = s.env.fund_ix(&ip, &s.instrument, &action, total);
    s.env.ok(&[f], &issuer, &[]);
    // ATTACK: funded (no pending action) but still inside the ex-date lock.
    s.fails_buy(&buyer, 1, E::RegisterLocked);

    // After the payment date the register opens again.
    s.env.set_time(record_ts + 5 * DAY);
    s.buy(&buyer, 1);
    assert_eq!(s.env.token_balance(&bond_ata(&buyer.pubkey(), &s.mint)), 11);
}

#[test]
fn allowlist_requires_prior_allow() {
    let mut s = open(true);
    let buyer = s.buyer(10 * PRICE);
    // ATTACK: not on the allowlist (no auto-allow).
    s.fails_buy(&buyer, 1, E::AllowlistEntryRequired);
    // ATTACK: pass an allow entry of another wallet.
    let issuer = s.env.issuer.insecure_clone();
    let other = s.env.wallet();
    let a = s.env.allow_ix(&issuer.pubkey(), &s.instrument, &other.pubkey());
    s.env.ok(&[a], &issuer, &[]);
    let bpk = buyer.pubkey();
    let create = s.subscribe_create(&bpk);
    s.env.ok(&[create], &buyer, &[]);
    let mut acc = s.env.subscribe_accounts(&bpk, &s.mint, false);
    acc.allow_entry = Some(allow_pda(&s.instrument, &other.pubkey()));
    let i = s.env.subscribe_with(acc, 1, PRICE);
    s.env.fails_code(&[i], &buyer, &[], CONSTRAINT_SEEDS);

    let a = s.env.allow_ix(&issuer.pubkey(), &s.instrument, &bpk);
    s.env.ok(&[a], &issuer, &[]);
    s.buy(&buyer, 1);
}

#[test]
fn only_the_issuer_withdraws_proceeds() {
    let mut s = open(false);
    let buyer = s.buyer(40 * PRICE);
    s.buy(&buyer, 40);
    let vault = proceeds_pda(&s.instrument);
    let issuer = s.env.issuer.insecure_clone();
    let ip = issuer.pubkey();
    let issuer_usd = s.env.usd_account(&ip);

    // ATTACK: a stranger withdraws to its own account.
    let thief = s.env.wallet();
    let thief_usd = s.env.usd_account(&thief.pubkey());
    let w = s.env.withdraw_proceeds_ix(&thief.pubkey(), &s.instrument, &thief_usd, PRICE);
    s.env.fails(&[w], &thief, &[], E::NotIssuer);
    // ATTACK: the issuer signs but the destination belongs to someone else.
    let w = s.env.withdraw_proceeds_ix(&ip, &s.instrument, &thief_usd, PRICE);
    s.env.fails_code(&[w], &issuer, &[], CONSTRAINT_TOKEN_OWNER);
    // ATTACK: buyer (not issuer) tries to claw back.
    let w = s.env.withdraw_proceeds_ix(&buyer.pubkey(), &s.instrument, &usd_ata(&buyer.pubkey(), &s.env.usd_mint), PRICE);
    s.env.fails(&[w], &buyer, &[], E::NotIssuer);
    // More than the vault holds / zero.
    let w = s.env.withdraw_proceeds_ix(&ip, &s.instrument, &issuer_usd, 40 * PRICE + 1);
    s.env.fails(&[w], &issuer, &[], E::InsufficientProceeds);
    let w = s.env.withdraw_proceeds_ix(&ip, &s.instrument, &issuer_usd, 0);
    s.env.fails(&[w], &issuer, &[], E::ZeroFunding);

    let w = s.env.withdraw_proceeds_ix(&ip, &s.instrument, &issuer_usd, 25 * PRICE);
    s.env.ok(&[w], &issuer, &[]);
    assert_eq!(s.env.token_balance(&issuer_usd), 25 * PRICE);
    assert_eq!(s.env.token_balance(&vault), 15 * PRICE);
    let w = s.env.withdraw_proceeds_ix(&ip, &s.instrument, &issuer_usd, 15 * PRICE);
    s.env.ok(&[w], &issuer, &[]);
    let o = s.env.offering(&offering_pda(&s.instrument));
    assert_eq!((o.proceeds, o.withdrawn), (40 * PRICE, 40 * PRICE));
    assert_eq!(s.env.token_balance(&vault), 0);
    assert_eq!(s.env.token_balance(&thief_usd), 0);
}

impl Sale {
    fn subscribe_create(&self, owner: &Pubkey) -> anchor_lang::solana_program::instruction::Instruction {
        anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            owner,
            owner,
            &self.mint,
            &token_2022_id(),
        )
    }
}

fn create_fake_mint(env: &mut Env, authority: &Keypair) -> Pubkey {
    let mint = Keypair::new();
    let issuer = env.issuer.insecure_clone();
    let rent = env.svm.minimum_balance_for_rent_exemption(82);
    let create = anchor_lang::solana_program::system_instruction::create_account(&issuer.pubkey(), &mint.pubkey(), rent, 82, &token_id());
    let init = spl_token::instruction::initialize_mint2(&token_id(), &mint.pubkey(), &authority.pubkey(), None, SETTLEMENT_DECIMALS).unwrap();
    env.ok(&[create, init], &issuer, &[&mint]);
    mint.pubkey()
}

fn fund_fake(env: &mut Env, mint: &Pubkey, authority: &Keypair, owner: &Pubkey, amount: u64) -> Pubkey {
    let issuer = env.issuer.insecure_clone();
    let ata = usd_ata(owner, mint);
    let create = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &issuer.pubkey(),
        owner,
        mint,
        &token_id(),
    );
    let m = spl_token::instruction::mint_to(&token_id(), mint, &ata, &authority.pubkey(), &[], amount).unwrap();
    env.ok(&[create, m], &issuer, &[authority]);
    ata
}
