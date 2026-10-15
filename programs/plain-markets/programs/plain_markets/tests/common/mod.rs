//! LiteSVM harness for plain_markets: program loading, clock control, SPL helpers, Merkle builder
//! (same algorithm as lib/markets/merkle.ts) and typed instruction builders.
#![allow(dead_code)]

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::{
    associated_token::{get_associated_token_address_with_program_id, spl_associated_token_account, ID as ATA_ID},
    token::spl_token,
    token_2022::spl_token_2022,
};
use litesvm::{types::TransactionResult, LiteSVM};
use plain_markets::{
    accounts as acc, constants::*, error::MarketsError, instruction as ix, math, ActionKind, AnnounceParams,
    ClaimReceipt, CorporateAction, Instrument, InstrumentParams, Offering, OfferingParams, SnapshotParams,
};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub const FACE: u64 = 1_000_000_000; // 1,000.000000 USD
pub const COUPON_BPS: u16 = 1250; // 12.5% p.a.
pub const FREQ: u8 = 2; // semi-annual
pub const T0: i64 = 1_800_000_000;
pub const DAY: i64 = 86_400;
pub const SETTLEMENT_DECIMALS: u8 = 6;

pub fn token_2022_id() -> Pubkey {
    spl_token_2022::ID
}
pub fn token_id() -> Pubkey {
    spl_token::ID
}

pub fn instrument_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[INSTRUMENT_SEED, mint.as_ref()], &plain_markets::ID).0
}
pub fn metas_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[EXTRA_ACCOUNT_METAS_SEED, mint.as_ref()], &plain_markets::ID).0
}
pub fn action_pda(instrument: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(&[ACTION_SEED, instrument.as_ref(), &id.to_le_bytes()], &plain_markets::ID).0
}
pub fn vault_pda(action: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, action.as_ref()], &plain_markets::ID).0
}
pub fn claim_pda(action: &Pubkey, holder: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[CLAIM_SEED, action.as_ref(), holder.as_ref()], &plain_markets::ID).0
}
pub fn vote_pda(action: &Pubkey, holder: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VOTE_SEED, action.as_ref(), holder.as_ref()], &plain_markets::ID).0
}
pub fn allow_pda(instrument: &Pubkey, wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[ALLOW_SEED, instrument.as_ref(), wallet.as_ref()], &plain_markets::ID).0
}
pub fn offering_pda(instrument: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[OFFERING_SEED, instrument.as_ref()], &plain_markets::ID).0
}
pub fn proceeds_pda(instrument: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PROCEEDS_SEED, instrument.as_ref()], &plain_markets::ID).0
}
pub fn bond_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, &token_2022_id())
}
pub fn usd_ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, &token_id())
}

pub fn code(e: MarketsError) -> u32 {
    anchor_lang::error::ERROR_CODE_OFFSET + e as u32
}

/// Snapshot Merkle tree, identical to lib/markets/merkle.ts.
pub struct Tree {
    pub action: Pubkey,
    pub holdings: Vec<(Pubkey, u64)>,
    pub levels: Vec<Vec<[u8; 32]>>,
}

impl Tree {
    pub fn new(action: Pubkey, mut holdings: Vec<(Pubkey, u64)>) -> Self {
        holdings.sort_by(|a, b| a.0.to_bytes().cmp(&b.0.to_bytes()));
        let leaves: Vec<[u8; 32]> =
            holdings.iter().map(|(h, u)| math::leaf_hash(&action.to_bytes(), &h.to_bytes(), *u)).collect();
        let mut levels = vec![leaves];
        while levels.last().unwrap().len() > 1 {
            let level = levels.last().unwrap();
            let next = level
                .chunks(2)
                .map(|c| if c.len() == 2 { math::node_hash(&c[0], &c[1]) } else { c[0] })
                .collect();
            levels.push(next);
        }
        Tree { action, holdings, levels }
    }
    pub fn root(&self) -> [u8; 32] {
        self.levels.last().unwrap()[0]
    }
    pub fn total(&self) -> u64 {
        self.holdings.iter().map(|h| h.1).sum()
    }
    pub fn units(&self, holder: &Pubkey) -> u64 {
        self.holdings.iter().find(|h| &h.0 == holder).unwrap().1
    }
    pub fn proof(&self, holder: &Pubkey) -> Vec<[u8; 32]> {
        let mut i = self.holdings.iter().position(|h| &h.0 == holder).expect("holder in tree");
        let mut proof = vec![];
        for level in &self.levels[..self.levels.len() - 1] {
            let sib = i ^ 1;
            if sib < level.len() {
                proof.push(level[sib]);
            }
            i >>= 1;
        }
        proof
    }
}

pub struct Env {
    pub svm: LiteSVM,
    pub issuer: Keypair,
    pub usd_mint: Pubkey,
    pub usd_authority: Keypair,
}

impl Env {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/plain_markets.so"));
        svm.add_program(plain_markets::ID, bytes).unwrap();
        let issuer = Keypair::new();
        svm.airdrop(&issuer.pubkey(), 100_000_000_000).unwrap();
        let mut env = Env { svm, issuer, usd_mint: Pubkey::default(), usd_authority: Keypair::new() };
        env.set_time(T0);
        env.usd_mint = env.create_usd_mint();
        env
    }

    // ---- clock --------------------------------------------------------------------------------
    pub fn set_time(&mut self, ts: i64) {
        let mut clock: anchor_lang::prelude::Clock = self.svm.get_sysvar();
        clock.unix_timestamp = ts;
        clock.slot += 1;
        self.svm.set_sysvar(&clock);
        self.svm.expire_blockhash();
    }
    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<anchor_lang::prelude::Clock>().unix_timestamp
    }

    // ---- tx -----------------------------------------------------------------------------------
    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let blockhash = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
        let mut all: Vec<&Keypair> = vec![payer];
        for s in signers {
            if s.pubkey() != payer.pubkey() {
                all.push(s);
            }
        }
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
        self.svm.send_transaction(tx)
    }

    pub fn ok(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
        if let Err(e) = self.send(ixs, payer, signers) {
            panic!("tx failed: {:?}\n{}", e.err, e.meta.logs.join("\n"));
        }
    }

    /// Asserts the tx fails with the given custom error code.
    pub fn fails(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair], expected: MarketsError) {
        self.fails_code(ixs, payer, signers, code(expected))
    }

    pub fn fails_code(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair], expected: u32) {
        match self.send(ixs, payer, signers) {
            Ok(meta) => panic!("expected error {expected}, tx succeeded:\n{}", meta.logs.join("\n")),
            Err(e) => {
                let s = format!("{:?}", e.err);
                assert!(
                    s.contains(&format!("Custom({expected})")),
                    "expected Custom({expected}), got {s}\n{}",
                    e.meta.logs.join("\n")
                );
            }
        }
    }

    pub fn wallet(&mut self) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        k
    }

    // ---- reads --------------------------------------------------------------------------------
    pub fn read<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let a = self.svm.get_account(key).expect("account exists");
        T::try_deserialize(&mut a.data.as_slice()).unwrap()
    }
    pub fn instrument(&self, key: &Pubkey) -> Instrument {
        self.read(key)
    }
    pub fn action(&self, key: &Pubkey) -> CorporateAction {
        self.read(key)
    }
    pub fn receipt(&self, key: &Pubkey) -> ClaimReceipt {
        self.read(key)
    }
    pub fn offering(&self, key: &Pubkey) -> Offering {
        self.read(key)
    }
    pub fn exists(&self, key: &Pubkey) -> bool {
        self.svm.get_account(key).map(|a| a.lamports > 0).unwrap_or(false)
    }
    pub fn token_balance(&self, account: &Pubkey) -> u64 {
        match self.svm.get_account(account) {
            Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
            _ => 0,
        }
    }
    pub fn mint_supply(&self, mint: &Pubkey) -> u64 {
        let a = self.svm.get_account(mint).unwrap();
        u64::from_le_bytes(a.data[36..44].try_into().unwrap())
    }

    // ---- settlement token (classic SPL Token, 6 decimals) ----------------------------------------
    fn create_usd_mint(&mut self) -> Pubkey {
        let mint = Keypair::new();
        let rent = self.svm.minimum_balance_for_rent_exemption(82);
        let create = anchor_lang::solana_program::system_instruction::create_account(
            &self.issuer.pubkey(),
            &mint.pubkey(),
            rent,
            82,
            &token_id(),
        );
        let init = spl_token::instruction::initialize_mint2(
            &token_id(),
            &mint.pubkey(),
            &self.usd_authority.pubkey(),
            None,
            SETTLEMENT_DECIMALS,
        )
        .unwrap();
        let issuer = self.issuer.insecure_clone();
        self.ok(&[create, init], &issuer, &[&mint]);
        mint.pubkey()
    }

    pub fn usd_account(&mut self, owner: &Pubkey) -> Pubkey {
        let ata = usd_ata(owner, &self.usd_mint);
        if !self.exists(&ata) {
            let ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(
                &self.issuer.pubkey(),
                owner,
                &self.usd_mint,
                &token_id(),
            );
            let issuer = self.issuer.insecure_clone();
            self.ok(&[ix], &issuer, &[]);
        }
        ata
    }

    pub fn mint_usd(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let ata = self.usd_account(owner);
        let ix = spl_token::instruction::mint_to(&token_id(), &self.usd_mint, &ata, &self.usd_authority.pubkey(), &[], amount)
            .unwrap();
        let (issuer, auth) = (self.issuer.insecure_clone(), self.usd_authority.insecure_clone());
        self.ok(&[ix], &issuer, &[&auth]);
        ata
    }

    // ---- program instruction builders ------------------------------------------------------------
    pub fn init_instrument_ix(&self, issuer: &Pubkey, mint: &Pubkey, allowlist: bool) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::InitializeInstrument {
                params: InstrumentParams {
                    name: "Plain KZ Bond 2027".into(),
                    symbol: "PKZ27".into(),
                    uri: "https://plain.lengway.me/bonds/pkz27.json".into(),
                    isin: *b"KZ2C00012345",
                    face_value: FACE,
                    coupon_bps: COUPON_BPS,
                    coupon_frequency: FREQ,
                    issue_ts: T0,
                    maturity_ts: T0 + 365 * DAY,
                    allowlist_enabled: allowlist,
                    paying_agent: None,
                },
            }
            .data(),
            acc::InitializeInstrument {
                issuer: *issuer,
                mint: *mint,
                instrument: instrument_pda(mint),
                extra_account_meta_list: metas_pda(mint),
                settlement_mint: self.usd_mint,
                settlement_token_program: token_id(),
                token_program: token_2022_id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    /// Creates an instrument; returns (mint, instrument).
    pub fn create_instrument(&mut self, allowlist: bool) -> (Pubkey, Pubkey) {
        let mint = Keypair::new();
        let issuer = self.issuer.insecure_clone();
        let ixn = self.init_instrument_ix(&issuer.pubkey(), &mint.pubkey(), allowlist);
        self.ok(&[ixn], &issuer, &[&mint]);
        (mint.pubkey(), instrument_pda(&mint.pubkey()))
    }

    pub fn issue_ix(&self, signer: &Pubkey, mint: &Pubkey, holder: &Pubkey, units: u64, allow: bool) -> Instruction {
        let instrument = instrument_pda(mint);
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::Issue { units }.data(),
            acc::Issue {
                issuer: *signer,
                instrument,
                mint: *mint,
                holder: *holder,
                holder_token: bond_ata(holder, mint),
                allow_entry: allow.then(|| allow_pda(&instrument, holder)),
                token_program: token_2022_id(),
                associated_token_program: ATA_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn issue(&mut self, mint: &Pubkey, holder: &Pubkey, units: u64) {
        let issuer = self.issuer.insecure_clone();
        let allow = self.instrument(&instrument_pda(mint)).allowlist_enabled;
        let ixn = self.issue_ix(&issuer.pubkey(), mint, holder, units, allow);
        self.ok(&[ixn], &issuer, &[]);
    }

    pub fn allow_ix(&self, signer: &Pubkey, instrument: &Pubkey, wallet: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::AllowHolder { wallet: *wallet }.data(),
            acc::AllowHolder {
                issuer: *signer,
                instrument: *instrument,
                allow_entry: allow_pda(instrument, wallet),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn issuer_only_ix(&self, signer: &Pubkey, instrument: &Pubkey, data: Vec<u8>) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &data,
            acc::IssuerOnly { issuer: *signer, instrument: *instrument }.to_account_metas(None),
        )
    }

    pub fn announce_ix(&self, signer: &Pubkey, instrument: &Pubkey, params: AnnounceParams) -> Instruction {
        let id = self.instrument(instrument).action_count;
        let action = action_pda(instrument, id);
        let pays = params.kind != ActionKind::Vote;
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::Announce { params }.data(),
            acc::Announce {
                issuer: *signer,
                instrument: *instrument,
                action,
                vault: pays.then(|| vault_pda(&action)),
                settlement_mint: pays.then_some(self.usd_mint),
                settlement_token_program: pays.then(token_id),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    /// Announces and returns the action address.
    pub fn announce(&mut self, instrument: &Pubkey, params: AnnounceParams) -> Pubkey {
        let id = self.instrument(instrument).action_count;
        let issuer = self.issuer.insecure_clone();
        let ixn = self.announce_ix(&issuer.pubkey(), instrument, params);
        self.ok(&[ixn], &issuer, &[]);
        action_pda(instrument, id)
    }

    pub fn lock_record_ix(&self, cranker: &Pubkey, instrument: &Pubkey, action: &Pubkey) -> Instruction {
        let mint = self.instrument(instrument).mint;
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::LockRecord {}.data(),
            acc::LockRecord { cranker: *cranker, instrument: *instrument, action: *action, mint }.to_account_metas(None),
        )
    }

    pub fn snapshot_ix(&self, signer: &Pubkey, instrument: &Pubkey, action: &Pubkey, params: SnapshotParams) -> Instruction {
        let mint = self.instrument(instrument).mint;
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::PostSnapshot { params }.data(),
            acc::PostSnapshot { issuer: *signer, instrument: *instrument, action: *action, mint }.to_account_metas(None),
        )
    }

    pub fn snapshot_params(&self, tree: &Tree, kind: ActionKind, redeem_bps: u16) -> SnapshotParams {
        let total_redeem_units = if kind == ActionKind::PartialRedemption {
            tree.holdings.iter().map(|h| math::partial_redeem_units(h.1, redeem_bps).unwrap()).sum()
        } else {
            0
        };
        SnapshotParams {
            merkle_root: tree.root(),
            snapshot_hash: [7; 32],
            total_units: tree.total(),
            holder_count: tree.holdings.len() as u32,
            total_redeem_units,
        }
    }

    pub fn fund_ix(&self, signer: &Pubkey, instrument: &Pubkey, action: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::Fund { amount }.data(),
            acc::Fund {
                issuer: *signer,
                instrument: *instrument,
                action: *action,
                vault: vault_pda(action),
                issuer_settlement: usd_ata(signer, &self.usd_mint),
                settlement_mint: self.usd_mint,
                settlement_token_program: token_id(),
            }
            .to_account_metas(None),
        )
    }

    pub fn claim_ix(&self, holder: &Pubkey, instrument: &Pubkey, action: &Pubkey, units: u64, proof: Vec<[u8; 32]>, with_bond: bool) -> Instruction {
        let mint = self.instrument(instrument).mint;
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::Claim { units, proof }.data(),
            acc::Claim {
                holder: *holder,
                instrument: *instrument,
                action: *action,
                vault: vault_pda(action),
                holder_settlement: usd_ata(holder, &self.usd_mint),
                mint,
                holder_bond: with_bond.then(|| bond_ata(holder, &mint)),
                receipt: claim_pda(action, holder),
                settlement_mint: self.usd_mint,
                token_program: token_2022_id(),
                settlement_token_program: token_id(),
                associated_token_program: ATA_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn pay_ix(&self, agent: &Pubkey, holder: &Pubkey, instrument: &Pubkey, action: &Pubkey, units: u64, proof: Vec<[u8; 32]>, with_bond: bool) -> Instruction {
        let mint = self.instrument(instrument).mint;
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::Pay { units, proof }.data(),
            acc::Pay {
                paying_agent: *agent,
                holder: *holder,
                instrument: *instrument,
                action: *action,
                vault: vault_pda(action),
                holder_settlement: usd_ata(holder, &self.usd_mint),
                mint,
                holder_bond: with_bond.then(|| bond_ata(holder, &mint)),
                receipt: claim_pda(action, holder),
                settlement_mint: self.usd_mint,
                token_program: token_2022_id(),
                settlement_token_program: token_id(),
                associated_token_program: ATA_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn vote_ix(&self, holder: &Pubkey, instrument: &Pubkey, action: &Pubkey, units: u64, proof: Vec<[u8; 32]>, choice: u8) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::CastVote { units, proof, choice }.data(),
            acc::CastVote {
                holder: *holder,
                instrument: *instrument,
                action: *action,
                vote_record: vote_pda(action, holder),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn settle_ix(&self, authority: &Pubkey, instrument: &Pubkey, action: &Pubkey, with_vault: bool) -> Instruction {
        let issuer = self.instrument(instrument).issuer;
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::Settle {}.data(),
            acc::Settle {
                authority: *authority,
                instrument: *instrument,
                action: *action,
                issuer,
                vault: with_vault.then(|| vault_pda(action)),
                issuer_settlement: with_vault.then(|| usd_ata(&issuer, &self.usd_mint)),
                settlement_mint: with_vault.then_some(self.usd_mint),
                settlement_token_program: with_vault.then(token_id),
            }
            .to_account_metas(None),
        )
    }

    pub fn cancel_ix(&self, signer: &Pubkey, instrument: &Pubkey, action: &Pubkey, with_vault: bool) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::CancelAction {}.data(),
            acc::CancelAction {
                issuer: *signer,
                instrument: *instrument,
                action: *action,
                vault: with_vault.then(|| vault_pda(action)),
                issuer_settlement: with_vault.then(|| usd_ata(signer, &self.usd_mint)),
                settlement_mint: with_vault.then_some(self.usd_mint),
                settlement_token_program: with_vault.then(token_id),
            }
            .to_account_metas(None),
        )
    }

    /// Token-2022 transfer_checked of bond units with the transfer-hook extra accounts appended.
    pub fn bond_transfer_ix(&self, mint: &Pubkey, from_owner: &Pubkey, to_owner: &Pubkey, units: u64) -> Vec<Instruction> {
        let instrument = instrument_pda(mint);
        let create = spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            from_owner,
            to_owner,
            mint,
            &token_2022_id(),
        );
        let mut t = spl_token_2022::instruction::transfer_checked(
            &token_2022_id(),
            &bond_ata(from_owner, mint),
            mint,
            &bond_ata(to_owner, mint),
            from_owner,
            &[],
            units,
            0,
        )
        .unwrap();
        t.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(instrument, false));
        t.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
            allow_pda(&instrument, to_owner),
            false,
        ));
        t.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(plain_markets::ID, false));
        t.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(metas_pda(mint), false));
        vec![create, t]
    }

    pub fn open_offering_ix(&self, signer: &Pubkey, instrument: &Pubkey, params: OfferingParams) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::OpenOffering { params }.data(),
            acc::OpenOffering {
                issuer: *signer,
                instrument: *instrument,
                offering: offering_pda(instrument),
                proceeds_vault: proceeds_pda(instrument),
                settlement_mint: self.usd_mint,
                settlement_token_program: token_id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    /// Accounts for `subscribe` with the canonical choices; tests mutate fields for attacks.
    pub fn subscribe_accounts(&self, buyer: &Pubkey, mint: &Pubkey, allow: bool) -> acc::Subscribe {
        let instrument = instrument_pda(mint);
        acc::Subscribe {
            buyer: *buyer,
            instrument,
            offering: offering_pda(&instrument),
            mint: *mint,
            buyer_bond: bond_ata(buyer, mint),
            buyer_settlement: usd_ata(buyer, &self.usd_mint),
            proceeds_vault: proceeds_pda(&instrument),
            settlement_mint: self.usd_mint,
            allow_entry: allow.then(|| allow_pda(&instrument, buyer)),
            token_program: token_2022_id(),
            settlement_token_program: token_id(),
        }
    }

    pub fn subscribe_with(&self, accounts: acc::Subscribe, units: u64, max_payment: u64) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::Subscribe { units, max_payment }.data(),
            accounts.to_account_metas(None),
        )
    }

    /// Idempotent bond ATA creation (paid by the buyer) followed by `subscribe`.
    pub fn subscribe_ixs(&self, buyer: &Pubkey, mint: &Pubkey, units: u64, max_payment: u64, allow: bool) -> Vec<Instruction> {
        let create =
            spl_associated_token_account::instruction::create_associated_token_account_idempotent(buyer, buyer, mint, &token_2022_id());
        vec![create, self.subscribe_with(self.subscribe_accounts(buyer, mint, allow), units, max_payment)]
    }

    pub fn withdraw_proceeds_ix(&self, signer: &Pubkey, instrument: &Pubkey, to: &Pubkey, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::WithdrawProceeds { amount }.data(),
            acc::WithdrawProceeds {
                issuer: *signer,
                instrument: *instrument,
                offering: offering_pda(instrument),
                proceeds_vault: proceeds_pda(instrument),
                issuer_settlement: *to,
                settlement_mint: self.usd_mint,
                settlement_token_program: token_id(),
            }
            .to_account_metas(None),
        )
    }

    pub fn close_offering_ix(&self, signer: &Pubkey, instrument: &Pubkey) -> Instruction {
        Instruction::new_with_bytes(
            plain_markets::ID,
            &ix::CloseOffering {}.data(),
            acc::CloseOffering { issuer: *signer, instrument: *instrument, offering: offering_pda(instrument) }
                .to_account_metas(None),
        )
    }

    pub fn announce_params(&self, kind: ActionKind, record_in: i64, pay_in: i64, deadline_in: i64) -> AnnounceParams {
        let now = self.now();
        AnnounceParams {
            kind,
            title: format!("{kind:?}"),
            terms_hash: [9; 32],
            record_ts: now + record_in,
            payment_ts: now + pay_in,
            claim_deadline: now + deadline_in,
            rate_bps: 0,
            redeem_bps: 0,
            price_bps: 0,
            options: vec![],
        }
    }
}
