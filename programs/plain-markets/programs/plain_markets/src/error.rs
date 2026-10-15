use anchor_lang::prelude::*;

#[error_code]
pub enum MarketsError {
    // --- authority ---
    #[msg("Only the instrument issuer may do this")]
    NotIssuer,
    #[msg("Only the paying agent or the issuer may push payments")]
    NotPayingAgent,

    // --- instrument parameters ---
    #[msg("Coupon frequency must be 1, 2, 4 or 12 payments per year")]
    InvalidFrequency,
    #[msg("Face value must be greater than zero")]
    InvalidFaceValue,
    #[msg("Coupon rate is out of range")]
    InvalidRate,
    #[msg("Maturity must be after issue")]
    InvalidMaturity,
    #[msg("Name, symbol or URI is too long or empty")]
    InvalidMetadata,
    #[msg("Settlement mint is the bond mint or has fee / hook / non-transferable extensions")]
    InvalidSettlementMint,

    // --- instrument state ---
    #[msg("Instrument is not active")]
    InstrumentNotActive,
    #[msg("Another corporate action is still before its payment phase")]
    PendingActionExists,
    #[msg("A redemption is in progress; no other action may run")]
    RedemptionInProgress,
    #[msg("A redemption needs every other action to be settled first")]
    ActionsStillOpen,
    #[msg("The register is locked for a corporate action; issuance is paused")]
    RegisterLocked,
    #[msg("Units must be greater than zero")]
    ZeroUnits,

    // --- action announcement ---
    #[msg("Schedule must satisfy now <= record < payment <= claim deadline")]
    InvalidSchedule,
    #[msg("Title is too long or empty")]
    InvalidTitle,
    #[msg("Redemption share must be between 1 and 9999 bps")]
    InvalidRedeemShare,
    #[msg("Redemption price must be between 1 and 20000 bps of face")]
    InvalidPrice,
    #[msg("Votes need 2 to 4 options of 1 to 32 bytes")]
    InvalidVoteOptions,
    #[msg("Parameter does not apply to this action kind")]
    UnexpectedParameter,
    #[msg("Current ex-date lock ends before this record date; announce after it ends")]
    LockStillRunning,

    // --- lifecycle ---
    #[msg("Action is not in the status this instruction requires")]
    InvalidActionStatus,
    #[msg("Action kind does not support this instruction")]
    WrongActionKind,
    #[msg("Record date has not been reached")]
    RecordDateNotReached,
    #[msg("Record window passed without locking the register; cancel and re-announce")]
    RecordWindowMissed,
    #[msg("Snapshot total units do not equal the bond supply")]
    SupplyMismatch,
    #[msg("Holder count must be between 1 and total units")]
    InvalidHolderCount,
    #[msg("Merkle root must not be zero")]
    InvalidSnapshotRoot,
    #[msg("Posted redeemed-unit total is inconsistent with per-holder rounding")]
    RedeemTotalOutOfBounds,
    #[msg("Total entitlement is zero; nothing to pay")]
    ZeroEntitlement,
    #[msg("Funding would exceed the total entitlement")]
    OverFunding,
    #[msg("Funding amount must be greater than zero")]
    ZeroFunding,
    #[msg("Action is not fully funded")]
    ActionNotFunded,

    // --- payment ---
    #[msg("Payment date has not been reached")]
    PaymentNotDue,
    #[msg("Entitlement already paid for this holder")]
    AlreadyClaimed,
    #[msg("Merkle proof does not match the snapshot root")]
    InvalidProof,
    #[msg("Merkle proof is too long")]
    ProofTooLong,
    #[msg("Claim would exceed the snapshot totals")]
    SnapshotTotalsExceeded,
    #[msg("Paying vault does not hold enough funds")]
    InsufficientVaultFunds,
    #[msg("Redemption requires the holder's bond token account")]
    MissingHolderBondAccount,
    #[msg("Bond token account does not belong to the holder or the instrument")]
    InvalidHolderBondAccount,
    #[msg("Holder no longer holds the units being redeemed")]
    InsufficientUnitsToRedeem,

    // --- votes ---
    #[msg("Vote already cast for this holder")]
    AlreadyVoted,
    #[msg("Vote choice is out of range")]
    InvalidVoteChoice,
    #[msg("Voting is closed")]
    VotingClosed,
    #[msg("Voting is still open")]
    VotingNotClosed,
    #[msg("Votes were already cast; the vote cannot be cancelled")]
    VotesAlreadyCast,

    // --- settlement ---
    #[msg("Claim window is still open and entitlements are outstanding")]
    ClaimWindowOpen,
    #[msg("Paying vault and issuer settlement account are required")]
    MissingSettlementAccounts,
    #[msg("Settlement token account is not the expected one")]
    InvalidSettlementAccount,

    // --- transfer hook ---
    #[msg("Bond transfers are locked between record date and payment")]
    TransferLocked,
    #[msg("Destination wallet is not on the instrument allowlist")]
    DestinationNotAllowlisted,
    #[msg("Hook may only run inside a Token-2022 transfer")]
    NotTransferring,
    #[msg("Allowlist entry required for this holder")]
    AllowlistEntryRequired,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    // --- primary offering (appended: earlier codes stay stable) ---
    #[msg("Offering parameters are invalid")]
    InvalidOfferingParams,
    #[msg("Offering is not open at this time")]
    OfferingNotOpen,
    #[msg("Offering is closed")]
    OfferingClosed,
    #[msg("Purchase exceeds the units left in the offering")]
    OfferingSoldOut,
    #[msg("Purchase would exceed the per-holder cap")]
    HolderCapExceeded,
    #[msg("Price exceeds the buyer's maximum payment")]
    PaymentExceedsMax,
    #[msg("Proceeds vault does not hold enough funds")]
    InsufficientProceeds,
    #[msg("Instrument has reached maturity")]
    InstrumentMatured,
}
