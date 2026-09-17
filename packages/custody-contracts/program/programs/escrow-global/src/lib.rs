// Anchor macros emit `unexpected_cfgs` for feature flags that are only
// meaningful to `anchor-syn` (for example `anchor-debug` and `no-entrypoint`).
// These macro-originated conditions are expected under modern rustc and are
// not actionable in this crate.
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

// Local development identity only. The matching keypair is generated outside
// source control and must be replaced by an approved, separately controlled
// deployment identity before any devnet or mainnet release.
declare_id!("EZ2xS5M9Ras2eJXpe1cY73q6KvQxVuY12S1eVNcBEB6S");

pub const PLATFORM_FEE_BPS: u64 = 300;
pub const DISPUTE_FEE_BPS: u64 = 500;
pub const BPS_DENOMINATOR: u128 = 10_000;
pub const MIN_REVIEW_WINDOW_SECONDS: i64 = 60;
pub const MAX_FUNDING_HORIZON_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const MAX_DELIVERY_HORIZON_SECONDS: i64 = 365 * 24 * 60 * 60;
pub const MAX_REVIEW_WINDOW_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const MAX_PROPOSAL_LIFETIME_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const MAINNET_USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const MAINNET_USDT_MINT: Pubkey = pubkey!("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
pub const DEVNET_USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const DEPLOYMENT_CONFIG_SEED: &[u8] = b"deployment-config";

/// A deliberately constrained single-principal custody boundary.
///
/// Created -> Accepted -> Funded -> Submitted -> Approved -> SellerPaid -> Closed
///                          \\-> Refunded -> Closed
///                                      \\-> Disputed -> Approved/Refunded
/// Funded -> Refunded after a missed delivery deadline; Submitted -> Approved
/// after an explicitly enabled review timeout.
/// The program is not deployed or approved for real funds by this repository.
#[program]
pub mod escrow_global {
    use super::*;

    /// Create the one-time, immutable deployment policy account. This must be
    /// performed by the controlled deployment ceremony before the program is
    /// exposed to public RPC traffic; a PDA initializer cannot be safely
    /// front-run after public launch.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        accepted_mints: [Pubkey; 2],
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() != ctx.accounts.fee_recipient.key(),
            EscrowError::InvalidRoles
        );
        require!(
            ctx.accounts.fee_recipient.key() != Pubkey::default(),
            EscrowError::InvalidRoles
        );
        validate_config_mints(accepted_mints)?;
        let config = &mut ctx.accounts.deployment_config;
        config.authority = ctx.accounts.authority.key();
        config.fee_recipient = ctx.accounts.fee_recipient.key();
        config.accepted_mints = accepted_mints;
        config.bump = ctx.bumps.deployment_config;
        emit!(DeploymentConfigInitialized {
            deployment_config: config.key(),
            authority: config.authority,
            fee_recipient: config.fee_recipient,
            accepted_mints,
        });
        Ok(())
    }

    // The public instruction arity is part of the Anchor ABI and cannot be
    // reduced without breaking existing clients.
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        ctx: Context<Initialize>,
        agreement_id_hash: [u8; 32],
        terms_hash: [u8; 32],
        principal: u64,
        funding_deadline: i64,
        delivery_deadline: i64,
        review_deadline: i64,
        timed_release: bool,
    ) -> Result<()> {
        require!(principal > 0, EscrowError::InvalidAmount);
        validate_deadlines(funding_deadline, delivery_deadline, review_deadline)?;
        validate_initialize_inputs(
            agreement_id_hash,
            terms_hash,
            ctx.accounts.buyer.key(),
            ctx.accounts.seller.key(),
            ctx.accounts.arbiter.key(),
            ctx.accounts.deployment_config.fee_recipient,
            ctx.accounts.mint.key(),
        )?;
        require!(
            ctx.accounts
                .deployment_config
                .accepts_mint(ctx.accounts.mint.key()),
            EscrowError::MintNotConfigured
        );
        let fee_reserve = checked_fee(principal)?;
        let total = principal
            .checked_add(fee_reserve)
            .ok_or(EscrowError::AmountOverflow)?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.arbiter = ctx.accounts.arbiter.key();
        escrow.fee_recipient = ctx.accounts.deployment_config.fee_recipient;
        escrow.mint = ctx.accounts.mint.key();
        escrow.vault = ctx.accounts.vault.key();
        escrow.agreement_id_hash = agreement_id_hash;
        escrow.terms_hash = terms_hash;
        escrow.principal = principal;
        escrow.fee_reserve = fee_reserve;
        escrow.state = EscrowState::Created;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault_bump = ctx.bumps.vault;
        escrow.expected_total = total;
        escrow.unresolved_principal = principal;
        escrow.dispute_fee_paid = 0;
        escrow.funding_deadline = funding_deadline;
        escrow.delivery_deadline = delivery_deadline;
        escrow.review_deadline = review_deadline;
        escrow.timed_release = timed_release;

        emit!(AgreementInitialized {
            escrow: escrow.key(),
            buyer: escrow.buyer,
            seller: escrow.seller,
            arbiter: escrow.arbiter,
            mint: escrow.mint,
            principal,
            fee_reserve,
            terms_hash,
            funding_deadline,
            delivery_deadline,
            review_deadline,
            timed_release,
        });
        Ok(())
    }

    /// The seller accepts the exact terms commitment before any funds may
    /// enter custody.
    pub fn seller_accept(ctx: Context<SellerAccept>, terms_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Created,
            EscrowError::InvalidState
        );
        require!(terms_hash == escrow.terms_hash, EscrowError::TermsMismatch);
        escrow.state = EscrowState::Accepted;
        escrow.accepted_at = Clock::get()?.unix_timestamp;
        emit!(SellerAccepted {
            escrow: escrow.key(),
            terms_hash
        });
        Ok(())
    }

    /// Both original parties must sign a pre-funding terms amendment. The
    /// seller's prior acceptance is invalidated by returning the agreement to
    /// Created; no funded agreement can mutate its terms commitment.
    pub fn amend_terms(ctx: Context<AmendTerms>, new_terms_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            matches!(escrow.state, EscrowState::Created | EscrowState::Accepted),
            EscrowError::TermsAmendmentAfterFunding
        );
        require!(new_terms_hash != [0u8; 32], EscrowError::InvalidHash);
        require!(
            new_terms_hash != escrow.terms_hash,
            EscrowError::TermsHashUnchanged
        );
        let old_terms_hash = escrow.terms_hash;
        escrow.terms_hash = new_terms_hash;
        escrow.state = EscrowState::Created;
        escrow.accepted_at = 0;
        escrow.decision_revision = escrow
            .decision_revision
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;
        emit!(TermsAmended {
            escrow: escrow.key(),
            old_terms_hash,
            new_terms_hash,
        });
        Ok(())
    }

    /// The buyer may cancel before funding. Because the vault must be empty,
    /// this cannot redirect or destroy customer funds and prevents abandoned
    /// accepted offers from remaining permanently open.
    pub fn cancel_unfunded(ctx: Context<CancelUnfunded>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            matches!(escrow.state, EscrowState::Created | EscrowState::Accepted),
            EscrowError::InvalidState
        );
        require!(ctx.accounts.vault.amount == 0, EscrowError::FundsPresent);
        escrow.state = EscrowState::Closed;
        escrow.settled_at = Clock::get()?.unix_timestamp;
        escrow.unresolved_principal = 0;
        emit!(AgreementCancelled {
            escrow: escrow.key()
        });
        Ok(())
    }

    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Accepted,
            EscrowError::InvalidState
        );
        require_keys_eq!(
            ctx.accounts.buyer.key(),
            escrow.buyer,
            EscrowError::Unauthorized
        );
        require!(
            Clock::get()?.unix_timestamp <= escrow.funding_deadline,
            EscrowError::FundingDeadlinePassed
        );
        require!(ctx.accounts.vault.amount == 0, EscrowError::FundsPresent);

        let amount = escrow.expected_total;
        let before = ctx.accounts.vault.amount;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        require!(
            ctx.accounts.vault.amount.checked_sub(before) == Some(amount),
            EscrowError::TransferAmountMismatch
        );

        escrow.state = EscrowState::Funded;
        escrow.funded_at = Clock::get()?.unix_timestamp;
        emit!(AgreementFunded {
            escrow: escrow.key(),
            amount
        });
        Ok(())
    }

    pub fn seller_submit(ctx: Context<SellerSubmit>, delivery_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Funded,
            EscrowError::InvalidState
        );
        require!(
            Clock::get()?.unix_timestamp <= escrow.delivery_deadline,
            EscrowError::DeliveryDeadlinePassed
        );
        require!(delivery_hash != [0u8; 32], EscrowError::InvalidHash);
        escrow.delivery_hash = delivery_hash;
        escrow.state = EscrowState::Submitted;
        escrow.submitted_at = Clock::get()?.unix_timestamp;
        emit!(SellerSubmitted {
            escrow: escrow.key(),
            delivery_hash
        });
        Ok(())
    }

    /// Either original party may explicitly open the adjudication path after
    /// delivery has been submitted. A reviewer cannot create a dispute. The
    /// opener pays the separate formal-dispute charge atomically.
    pub fn open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Submitted,
            EscrowError::InvalidState
        );
        let opener = ctx.accounts.opener.key();
        require!(
            opener == escrow.buyer || opener == escrow.seller,
            EscrowError::Unauthorized
        );
        let dispute_fee = checked_dispute_fee(escrow.unresolved_principal)?;
        require!(dispute_fee > 0, EscrowError::DisputeFeeTooSmall);
        escrow.dispute_fee_paid = escrow
            .dispute_fee_paid
            .checked_add(dispute_fee)
            .ok_or(EscrowError::AmountOverflow)?;
        escrow.state = EscrowState::Disputed;
        transfer_dispute_fee(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &mut ctx.accounts.opener_token_account,
            &mut ctx.accounts.fee_token_account,
            &ctx.accounts.opener,
            dispute_fee,
        )?;
        emit!(DisputeOpened {
            escrow: escrow.key(),
            opener,
            fee_amount: dispute_fee
        });
        Ok(())
    }

    /// The fixed arbiter can issue only an all-seller or all-buyer outcome for
    /// an explicitly disputed agreement. Arbitrary splits and destinations
    /// are intentionally not part of this first release.
    pub fn arbiter_release(ctx: Context<ArbiterResolve>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Disputed,
            EscrowError::InvalidState
        );
        let now = Clock::get()?.unix_timestamp;
        escrow.state = EscrowState::Approved;
        escrow.approved_at = now;
        escrow.seller_entitlement = escrow.principal;
        escrow.fee_entitlement = escrow.fee_reserve;
        escrow.unresolved_principal = 0;
        emit!(ArbiterResolved {
            escrow: escrow.key(),
            release_to_seller: true,
            seller_amount: escrow.seller_entitlement,
            buyer_amount: 0,
            fee_amount: escrow.fee_entitlement
        });
        Ok(())
    }

    pub fn arbiter_refund(ctx: Context<ArbiterResolve>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Disputed,
            EscrowError::InvalidState
        );
        let now = Clock::get()?.unix_timestamp;
        escrow.state = EscrowState::Refunded;
        escrow.settled_at = now;
        escrow.buyer_entitlement = escrow.expected_total;
        escrow.unresolved_principal = 0;
        emit!(ArbiterResolved {
            escrow: escrow.key(),
            release_to_seller: false,
            seller_amount: 0,
            buyer_amount: escrow.buyer_entitlement,
            fee_amount: 0
        });
        Ok(())
    }

    pub fn buyer_approve(ctx: Context<BuyerApprove>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Submitted,
            EscrowError::InvalidState
        );
        require!(
            Clock::get()?.unix_timestamp <= escrow.review_deadline,
            EscrowError::ReviewDeadlinePassed
        );
        escrow.state = EscrowState::Approved;
        escrow.approved_at = Clock::get()?.unix_timestamp;
        escrow.seller_entitlement = escrow.principal;
        escrow.fee_entitlement = escrow.fee_reserve;
        escrow.unresolved_principal = 0;
        emit!(BuyerApproved {
            escrow: escrow.key(),
            seller_amount: escrow.seller_entitlement,
            fee_amount: escrow.fee_entitlement
        });
        Ok(())
    }

    /// An explicitly timed agreement may be released by any transaction payer
    /// after the review window. Manual agreements never take this path.
    pub fn execute_review_timeout(ctx: Context<ExecuteReviewTimeout>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Submitted,
            EscrowError::InvalidState
        );
        require!(escrow.timed_release, EscrowError::TimedReleaseDisabled);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now > escrow.review_deadline,
            EscrowError::ReviewWindowNotExpired
        );
        escrow.state = EscrowState::Approved;
        escrow.approved_at = now;
        escrow.seller_entitlement = escrow.principal;
        escrow.fee_entitlement = escrow.fee_reserve;
        escrow.unresolved_principal = 0;
        emit!(ReviewTimeoutExecuted {
            escrow: escrow.key(),
            seller_amount: escrow.seller_entitlement,
            fee_amount: escrow.fee_entitlement
        });
        Ok(())
    }

    /// Create one exact Common Ground proposal for the currently submitted
    /// single-principal agreement. It is a proposal only; neither amount is
    /// allocated until both original parties approve this same account.
    pub fn propose_common_ground(
        ctx: Context<ProposeCommonGround>,
        proposal_nonce: u64,
        seller_amount: u64,
        buyer_principal_refund: u64,
        expires_at: i64,
    ) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Submitted,
            EscrowError::InvalidState
        );
        require!(
            ctx.accounts.proposer.key() == escrow.buyer
                || ctx.accounts.proposer.key() == escrow.seller,
            EscrowError::Unauthorized
        );
        require!(
            escrow.unresolved_principal == escrow.principal,
            EscrowError::InvalidState
        );
        require!(
            escrow.seller_entitlement == 0
                && escrow.fee_entitlement == 0
                && escrow.buyer_entitlement == 0,
            EscrowError::OutstandingEntitlement
        );
        require!(
            seller_amount
                .checked_add(buyer_principal_refund)
                .ok_or(EscrowError::AmountOverflow)?
                <= escrow.unresolved_principal,
            EscrowError::InvalidAmount
        );
        require!(
            seller_amount > 0 || buyer_principal_refund > 0,
            EscrowError::InvalidAmount
        );
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, EscrowError::InvalidProposalExpiry);
        require!(
            expires_at
                .checked_sub(now)
                .ok_or(EscrowError::AmountOverflow)?
                <= MAX_PROPOSAL_LIFETIME_SECONDS,
            EscrowError::InvalidProposalExpiry
        );

        let proposal = &mut ctx.accounts.proposal;
        proposal.escrow = escrow.key();
        proposal.proposer = ctx.accounts.proposer.key();
        proposal.nonce = proposal_nonce;
        proposal.buyer = escrow.buyer;
        proposal.seller = escrow.seller;
        proposal.terms_hash = escrow.terms_hash;
        proposal.decision_revision = escrow.decision_revision;
        proposal.unresolved_principal = escrow.unresolved_principal;
        proposal.seller_amount = seller_amount;
        proposal.buyer_principal_refund = buyer_principal_refund;
        proposal.disputed_remainder =
            escrow.unresolved_principal - seller_amount - buyer_principal_refund;
        proposal.expires_at = expires_at;
        proposal.buyer_approved = ctx.accounts.proposer.key() == escrow.buyer;
        proposal.seller_approved = ctx.accounts.proposer.key() == escrow.seller;
        proposal.executed = false;
        proposal.bump = ctx.bumps.proposal;
        emit!(CommonGroundProposed {
            escrow: escrow.key(),
            proposal: proposal.key(),
            seller_amount,
            buyer_principal_refund,
            disputed_remainder: proposal.disputed_remainder,
            expires_at
        });
        Ok(())
    }

    pub fn approve_common_ground(ctx: Context<ApproveCommonGround>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let proposal = &mut ctx.accounts.proposal;
        require!(!proposal.executed, EscrowError::ProposalConsumed);
        require!(
            escrow.state == EscrowState::Submitted,
            EscrowError::InvalidState
        );
        require!(
            escrow.decision_revision == proposal.decision_revision,
            EscrowError::StaleProposal
        );
        require!(
            escrow.unresolved_principal == proposal.unresolved_principal,
            EscrowError::StaleProposal
        );
        require!(
            escrow.terms_hash == proposal.terms_hash,
            EscrowError::TermsMismatch
        );
        require!(
            proposal.buyer == escrow.buyer && proposal.seller == escrow.seller,
            EscrowError::ProposalPartyMismatch
        );
        require!(
            Clock::get()?.unix_timestamp < proposal.expires_at,
            EscrowError::ProposalExpired
        );
        let signer = ctx.accounts.approver.key();
        require!(
            signer == proposal.buyer || signer == proposal.seller,
            EscrowError::Unauthorized
        );
        if signer == proposal.buyer {
            require!(!proposal.buyer_approved, EscrowError::DuplicateApproval);
            proposal.buyer_approved = true;
        } else {
            require!(!proposal.seller_approved, EscrowError::DuplicateApproval);
            proposal.seller_approved = true;
        }
        emit!(CommonGroundApproved {
            escrow: escrow.key(),
            proposal: proposal.key(),
            approver: signer
        });
        Ok(())
    }

    pub fn execute_common_ground(ctx: Context<ExecuteCommonGround>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let proposal = &mut ctx.accounts.proposal;
        require!(!proposal.executed, EscrowError::ProposalConsumed);
        require!(
            proposal.buyer_approved && proposal.seller_approved,
            EscrowError::MissingApproval
        );
        require!(
            escrow.state == EscrowState::Submitted,
            EscrowError::InvalidState
        );
        require!(
            escrow.decision_revision == proposal.decision_revision,
            EscrowError::StaleProposal
        );
        require!(
            escrow.unresolved_principal == proposal.unresolved_principal,
            EscrowError::StaleProposal
        );
        require!(
            escrow.terms_hash == proposal.terms_hash,
            EscrowError::TermsMismatch
        );
        require!(
            proposal.buyer == escrow.buyer && proposal.seller == escrow.seller,
            EscrowError::ProposalPartyMismatch
        );
        let allocated = proposal
            .seller_amount
            .checked_add(proposal.buyer_principal_refund)
            .ok_or(EscrowError::AmountOverflow)?;
        require!(
            allocated <= escrow.unresolved_principal,
            EscrowError::InvalidAmount
        );
        require!(
            proposal.disputed_remainder == escrow.unresolved_principal - allocated,
            EscrowError::StaleProposal
        );
        require!(
            Clock::get()?.unix_timestamp < proposal.expires_at,
            EscrowError::ProposalExpired
        );
        let reserve_needed_for_possible_seller = checked_fee(
            escrow
                .principal
                .checked_sub(proposal.buyer_principal_refund)
                .ok_or(EscrowError::AmountOverflow)?,
        )?;
        let buyer_reserve_refund = escrow
            .fee_reserve
            .checked_sub(reserve_needed_for_possible_seller)
            .ok_or(EscrowError::AmountOverflow)?;
        let fee_entitlement = checked_fee(proposal.seller_amount)?;
        let remainder_fee_reserve = reserve_needed_for_possible_seller
            .checked_sub(fee_entitlement)
            .ok_or(EscrowError::AmountOverflow)?;
        escrow.seller_entitlement = proposal.seller_amount;
        escrow.buyer_entitlement = proposal
            .buyer_principal_refund
            .checked_add(buyer_reserve_refund)
            .ok_or(EscrowError::AmountOverflow)?;
        escrow.fee_entitlement = fee_entitlement;
        escrow.unresolved_principal = proposal.disputed_remainder;
        escrow.common_ground_seller_amount = proposal.seller_amount;
        escrow.common_ground_remainder = proposal.disputed_remainder;
        escrow.common_ground_remainder_fee_reserve = remainder_fee_reserve;
        escrow.common_ground_executed = true;
        escrow.decision_revision = escrow
            .decision_revision
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;
        escrow.state = EscrowState::CommonGround;
        proposal.executed = true;
        emit!(CommonGroundExecuted {
            escrow: escrow.key(),
            proposal: proposal.key(),
            seller_amount: proposal.seller_amount,
            buyer_amount: escrow.buyer_entitlement,
            disputed_remainder: proposal.disputed_remainder,
            fee_amount: fee_entitlement
        });
        Ok(())
    }

    /// Both original parties can resolve the remaining disputed remainder in
    /// one exact, bilateral decision. This does not grant the reserved arbiter
    /// unilateral power and preserves the Common Ground consent boundary.
    pub fn resolve_common_ground_remainder(
        ctx: Context<ResolveCommonGroundRemainder>,
        to_seller: bool,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::CommonGround,
            EscrowError::InvalidState
        );
        require!(escrow.common_ground_executed, EscrowError::InvalidState);
        let remainder = escrow.common_ground_remainder;
        require!(remainder > 0, EscrowError::NoDisputedRemainder);
        let reserve = escrow.common_ground_remainder_fee_reserve;
        if to_seller {
            escrow.seller_entitlement = escrow
                .seller_entitlement
                .checked_add(remainder)
                .ok_or(EscrowError::AmountOverflow)?;
            escrow.fee_entitlement = escrow
                .fee_entitlement
                .checked_add(reserve)
                .ok_or(EscrowError::AmountOverflow)?;
        } else {
            escrow.buyer_entitlement = escrow
                .buyer_entitlement
                .checked_add(remainder)
                .and_then(|amount| amount.checked_add(reserve))
                .ok_or(EscrowError::AmountOverflow)?;
        }
        escrow.unresolved_principal = 0;
        escrow.common_ground_remainder = 0;
        escrow.common_ground_remainder_fee_reserve = 0;
        escrow.decision_revision = escrow
            .decision_revision
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;
        emit!(CommonGroundRemainderResolved {
            escrow: escrow.key(),
            to_seller,
            seller_amount: escrow.seller_entitlement,
            buyer_amount: escrow.buyer_entitlement,
            fee_amount: escrow.fee_entitlement
        });
        Ok(())
    }

    pub fn close_common_ground_proposal(ctx: Context<CloseCommonGroundProposal>) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        require!(
            proposal.executed
                || Clock::get()?.unix_timestamp >= proposal.expires_at
                || ctx.accounts.escrow.state != EscrowState::Submitted
                || ctx.accounts.escrow.decision_revision != proposal.decision_revision,
            EscrowError::ProposalStillOpen
        );
        Ok(())
    }

    /// Both buyer and seller must sign the same transaction. The reserved
    /// arbiter cannot unilaterally redirect an undisputed escrow.
    pub fn bilateral_refund(ctx: Context<BilateralRefund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            matches!(escrow.state, EscrowState::Funded | EscrowState::Submitted),
            EscrowError::InvalidState
        );
        escrow.state = EscrowState::Refunded;
        escrow.buyer_entitlement = escrow.expected_total;
        escrow.settled_at = Clock::get()?.unix_timestamp;
        escrow.unresolved_principal = 0;
        emit!(AgreementRefunded {
            escrow: escrow.key(),
            buyer_amount: escrow.buyer_entitlement
        });
        Ok(())
    }

    /// Refund a funded agreement when the seller never submitted delivery by
    /// the agreed deadline. A submission that landed before the deadline
    /// moves the agreement onto the review/dispute path instead.
    pub fn claim_late_refund(ctx: Context<ClaimLateRefund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Funded,
            EscrowError::InvalidState
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now > escrow.delivery_deadline,
            EscrowError::DeliveryDeadlineNotPassed
        );
        escrow.state = EscrowState::Refunded;
        escrow.buyer_entitlement = escrow.expected_total;
        escrow.settled_at = now;
        escrow.unresolved_principal = 0;
        emit!(AgreementRefunded {
            escrow: escrow.key(),
            buyer_amount: escrow.buyer_entitlement
        });
        Ok(())
    }

    pub fn claim_seller(ctx: Context<ClaimSeller>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let common_ground = escrow.state == EscrowState::CommonGround;
        require!(
            escrow.state == EscrowState::Approved || common_ground,
            EscrowError::InvalidState
        );
        require!(escrow.seller_entitlement > 0, EscrowError::AlreadyClaimed);
        let amount = escrow.seller_entitlement;
        escrow.seller_entitlement = 0;
        escrow.seller_claimed = true;
        if common_ground {
            maybe_close_common_ground(escrow);
        } else {
            escrow.state = if escrow.fee_entitlement == 0 {
                EscrowState::Closed
            } else {
                EscrowState::SellerPaid
            };
        }
        transfer_from_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.seller_token_account,
            escrow,
            amount,
        )?;
        emit!(Claimed {
            escrow: escrow.key(),
            recipient: escrow.seller,
            amount,
            kind: ClaimKind::Seller
        });
        Ok(())
    }

    pub fn claim_fee(ctx: Context<ClaimFee>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let common_ground = escrow.state == EscrowState::CommonGround;
        require!(
            escrow.state == EscrowState::SellerPaid || common_ground,
            EscrowError::InvalidState
        );
        if common_ground {
            require!(escrow.seller_claimed, EscrowError::SellerClaimRequired);
        }
        require!(escrow.fee_entitlement > 0, EscrowError::AlreadyClaimed);
        let amount = escrow.fee_entitlement;
        escrow.fee_entitlement = 0;
        escrow.fee_claimed = true;
        if common_ground {
            maybe_close_common_ground(escrow);
        } else {
            escrow.state = EscrowState::Closed;
        }
        transfer_from_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.fee_token_account,
            escrow,
            amount,
        )?;
        emit!(Claimed {
            escrow: escrow.key(),
            recipient: escrow.fee_recipient,
            amount,
            kind: ClaimKind::Fee
        });
        Ok(())
    }

    pub fn claim_buyer_refund(ctx: Context<ClaimBuyerRefund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let common_ground = escrow.state == EscrowState::CommonGround;
        require!(
            escrow.state == EscrowState::Refunded || common_ground,
            EscrowError::InvalidState
        );
        require!(escrow.buyer_entitlement > 0, EscrowError::AlreadyClaimed);
        let amount = escrow.buyer_entitlement;
        escrow.buyer_entitlement = 0;
        escrow.buyer_claimed = true;
        if common_ground {
            maybe_close_common_ground(escrow);
        } else {
            escrow.state = EscrowState::Closed;
        }
        transfer_from_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.buyer_token_account,
            escrow,
            amount,
        )?;
        emit!(Claimed {
            escrow: escrow.key(),
            recipient: escrow.buyer,
            amount,
            kind: ClaimKind::BuyerRefund
        });
        Ok(())
    }

    /// Reclaim the escrow and vault rent only after every token entitlement is
    /// paid and the vault is empty. This is intentionally separate from the
    /// payout instructions so a claim can never be made non-retryable by an
    /// account close.
    pub fn close_escrow(ctx: Context<CloseEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Closed,
            EscrowError::InvalidState
        );
        require!(
            escrow.seller_entitlement == 0
                && escrow.fee_entitlement == 0
                && escrow.buyer_entitlement == 0,
            EscrowError::OutstandingEntitlement
        );
        require!(
            escrow.unresolved_principal == 0,
            EscrowError::OutstandingEntitlement
        );
        require!(ctx.accounts.vault.amount == 0, EscrowError::FundsPresent);
        emit!(AgreementClosed {
            escrow: escrow.key()
        });
        let bump = [escrow.bump];
        let seeds: &[&[u8]] = &[
            b"escrow",
            escrow.buyer.as_ref(),
            escrow.agreement_id_hash.as_ref(),
            &bump,
        ];
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: escrow.to_account_info(),
            },
            &[seeds],
        ))?;
        Ok(())
    }

    /// Return only unsolicited, non-entitled tokens after the agreement is
    /// fully settled. The recipient is fixed to the original buyer; callers
    /// cannot redirect or claim any ledger entitlement through this path.
    pub fn sweep_unentitled_dust(ctx: Context<SweepUnentitledDust>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            escrow.state == EscrowState::Closed
                && escrow.unresolved_principal == 0
                && escrow.seller_entitlement == 0
                && escrow.fee_entitlement == 0
                && escrow.buyer_entitlement == 0,
            EscrowError::OutstandingEntitlement
        );
        let amount = ctx.accounts.vault.amount;
        require!(amount > 0, EscrowError::NoDustToSweep);
        transfer_from_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.buyer_token_account,
            escrow,
            amount,
        )?;
        emit!(UnentitledDustSwept {
            escrow: escrow.key(),
            vault: ctx.accounts.vault.key(),
            recipient: ctx.accounts.buyer.key(),
            amount,
        });
        Ok(())
    }

    /// Recover an unsolicited transfer made before funding. No custody
    /// entitlement exists in Created/Accepted, and the only destination is
    /// the original buyer, allowing the canonical funding guard to proceed.
    pub fn recover_prefunding_dust(ctx: Context<RecoverPrefundingDust>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(
            matches!(escrow.state, EscrowState::Created | EscrowState::Accepted)
                && escrow.unresolved_principal == escrow.principal
                && escrow.seller_entitlement == 0
                && escrow.fee_entitlement == 0
                && escrow.buyer_entitlement == 0,
            EscrowError::InvalidState
        );
        let amount = ctx.accounts.vault.amount;
        require!(amount > 0, EscrowError::NoDustToSweep);
        transfer_from_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.buyer_token_account,
            escrow,
            amount,
        )?;
        emit!(PrefundingDustRecovered {
            escrow: escrow.key(),
            vault: ctx.accounts.vault.key(),
            recipient: ctx.accounts.buyer.key(),
            amount,
        });
        Ok(())
    }

    // ---------------------------------------------------------------------
    // V2 multi-milestone boundary. Each milestone owns its own vault and
    // lifecycle, so one disputed delivery cannot freeze unrelated work.
    // ---------------------------------------------------------------------

    pub fn initialize_v2(
        ctx: Context<InitializeV2>,
        agreement_id_hash: [u8; 32],
        terms_hash: [u8; 32],
        milestone_count: u16,
    ) -> Result<()> {
        require!(
            milestone_count > 0 && milestone_count <= MAX_MILESTONES,
            EscrowError::InvalidMilestoneCount
        );
        validate_initialize_inputs(
            agreement_id_hash,
            terms_hash,
            ctx.accounts.buyer.key(),
            ctx.accounts.seller.key(),
            ctx.accounts.arbiter.key(),
            ctx.accounts.deployment_config.fee_recipient,
            ctx.accounts.mint.key(),
        )?;
        require!(
            ctx.accounts
                .deployment_config
                .accepts_mint(ctx.accounts.mint.key()),
            EscrowError::MintNotConfigured
        );
        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.arbiter = ctx.accounts.arbiter.key();
        escrow.fee_recipient = ctx.accounts.deployment_config.fee_recipient;
        escrow.mint = ctx.accounts.mint.key();
        escrow.agreement_id_hash = agreement_id_hash;
        escrow.terms_hash = terms_hash;
        escrow.milestone_count = milestone_count;
        escrow.created_milestones = 0;
        escrow.funded_milestones = 0;
        escrow.closed_milestones = 0;
        escrow.state = MultiEscrowState::Created;
        escrow.bump = ctx.bumps.escrow;
        emit!(V2EscrowInitialized {
            escrow: escrow.key(),
            buyer: escrow.buyer,
            seller: escrow.seller,
            arbiter: escrow.arbiter,
            mint: escrow.mint,
            milestone_count
        });
        Ok(())
    }

    pub fn create_milestone_v2(
        ctx: Context<CreateMilestoneV2>,
        index: u16,
        principal: u64,
        funding_deadline: i64,
        delivery_deadline: i64,
        review_deadline: i64,
        timed_release: bool,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_deadlines_at(now, funding_deadline, delivery_deadline, review_deadline)?;
        require!(principal > 0, EscrowError::InvalidAmount);
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == MultiEscrowState::Created,
            EscrowError::InvalidState
        );
        require!(
            index == escrow.created_milestones && index < escrow.milestone_count,
            EscrowError::InvalidMilestoneIndex
        );
        let fee_reserve = checked_fee(principal)?;
        let expected_total = principal
            .checked_add(fee_reserve)
            .ok_or(EscrowError::AmountOverflow)?;
        let milestone = &mut ctx.accounts.milestone;
        milestone.escrow = escrow.key();
        milestone.index = index;
        milestone.principal = principal;
        milestone.fee_reserve = fee_reserve;
        milestone.expected_total = expected_total;
        milestone.dispute_fee_paid = 0;
        milestone.funding_deadline = funding_deadline;
        milestone.delivery_deadline = delivery_deadline;
        milestone.review_deadline = review_deadline;
        milestone.timed_release = timed_release;
        milestone.state = MultiMilestoneState::Unfunded;
        milestone.bump = ctx.bumps.milestone;
        milestone.vault_bump = ctx.bumps.vault;
        emit!(V2MilestoneCreated {
            milestone: milestone.key(),
            escrow: milestone.escrow,
            index,
            principal,
            fee_reserve,
            expected_total,
            funding_deadline,
            delivery_deadline,
            review_deadline,
            timed_release
        });
        emit_v2_milestone_state(milestone.key(), milestone);
        escrow.created_milestones = escrow
            .created_milestones
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;
        Ok(())
    }

    /// Cancel one never-funded milestone and recover its account/vault rent.
    /// This is deliberately per-milestone so funded siblings remain intact.
    pub fn cancel_milestone_v2(ctx: Context<CancelMilestoneV2>) -> Result<()> {
        let milestone = &ctx.accounts.milestone;
        require!(
            matches!(
                ctx.accounts.escrow.state,
                MultiEscrowState::Created | MultiEscrowState::Accepted
            ),
            EscrowError::InvalidState
        );
        require!(
            milestone.state == MultiMilestoneState::Unfunded,
            EscrowError::InvalidMilestoneState
        );
        require!(ctx.accounts.vault.amount == 0, EscrowError::FundsPresent);
        emit!(V2MilestoneCancelled {
            milestone: milestone.key(),
            escrow: milestone.escrow,
            index: milestone.index
        });
        let index = milestone.index.to_le_bytes();
        let bump = [milestone.bump];
        let seeds: &[&[u8]] = &[b"milestone-v2", milestone.escrow.as_ref(), &index, &bump];
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: milestone.to_account_info(),
            },
            &[seeds],
        ))?;
        let escrow = &mut ctx.accounts.escrow;
        escrow.closed_milestones = escrow
            .closed_milestones
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;
        if escrow.closed_milestones == escrow.milestone_count {
            escrow.state = MultiEscrowState::Closed;
        }
        Ok(())
    }

    pub fn seller_accept_v2(ctx: Context<SellerAcceptV2>, terms_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == MultiEscrowState::Created,
            EscrowError::InvalidState
        );
        require!(
            escrow.created_milestones == escrow.milestone_count,
            EscrowError::MilestonesIncomplete
        );
        require!(terms_hash == escrow.terms_hash, EscrowError::TermsMismatch);
        escrow.state = MultiEscrowState::Accepted;
        emit!(V2SellerAccepted {
            escrow: escrow.key(),
            terms_hash,
        });
        Ok(())
    }

    /// Both original parties must sign a pre-funding V2 terms amendment. The
    /// seller must accept the new commitment again before any milestone funds.
    pub fn amend_terms_v2(ctx: Context<AmendTermsV2>, new_terms_hash: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            matches!(
                escrow.state,
                MultiEscrowState::Created | MultiEscrowState::Accepted
            ),
            EscrowError::TermsAmendmentAfterFunding
        );
        require!(
            escrow.funded_milestones == 0,
            EscrowError::TermsAmendmentAfterFunding
        );
        require!(new_terms_hash != [0u8; 32], EscrowError::InvalidHash);
        require!(
            new_terms_hash != escrow.terms_hash,
            EscrowError::TermsHashUnchanged
        );
        let old_terms_hash = escrow.terms_hash;
        escrow.terms_hash = new_terms_hash;
        escrow.state = MultiEscrowState::Created;
        emit!(TermsAmended {
            escrow: escrow.key(),
            old_terms_hash,
            new_terms_hash,
        });
        Ok(())
    }

    pub fn fund_milestone_v2(ctx: Context<FundMilestoneV2>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.state == MultiEscrowState::Accepted,
            EscrowError::InvalidState
        );
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Unfunded,
            EscrowError::InvalidMilestoneState
        );
        require!(
            Clock::get()?.unix_timestamp <= milestone.funding_deadline,
            EscrowError::FundingDeadlinePassed
        );
        require!(ctx.accounts.vault.amount == 0, EscrowError::FundsPresent);
        let before = ctx.accounts.vault.amount;
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            milestone.expected_total,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        require!(
            ctx.accounts.vault.amount.checked_sub(before) == Some(milestone.expected_total),
            EscrowError::TransferAmountMismatch
        );
        milestone.state = MultiMilestoneState::Funded;
        escrow.funded_milestones = escrow
            .funded_milestones
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn seller_submit_milestone_v2(
        ctx: Context<SellerSubmitMilestoneV2>,
        delivery_hash: [u8; 32],
    ) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Funded,
            EscrowError::InvalidMilestoneState
        );
        require!(delivery_hash != [0u8; 32], EscrowError::InvalidHash);
        require!(
            Clock::get()?.unix_timestamp <= milestone.delivery_deadline,
            EscrowError::DeliveryDeadlinePassed
        );
        milestone.delivery_hash = delivery_hash;
        milestone.state = MultiMilestoneState::Submitted;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn buyer_approve_milestone_v2(ctx: Context<BuyerApproveMilestoneV2>) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Submitted,
            EscrowError::InvalidMilestoneState
        );
        require!(
            Clock::get()?.unix_timestamp <= milestone.review_deadline,
            EscrowError::ReviewDeadlinePassed
        );
        milestone.state = MultiMilestoneState::Approved;
        milestone.seller_entitlement = milestone.principal;
        milestone.fee_entitlement = milestone.fee_reserve;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn execute_milestone_review_timeout(
        ctx: Context<ExecuteMilestoneReviewTimeout>,
    ) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Submitted,
            EscrowError::InvalidMilestoneState
        );
        require!(milestone.timed_release, EscrowError::TimedReleaseDisabled);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now > milestone.review_deadline,
            EscrowError::ReviewWindowNotExpired
        );
        milestone.state = MultiMilestoneState::Approved;
        milestone.seller_entitlement = milestone.principal;
        milestone.fee_entitlement = milestone.fee_reserve;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn open_milestone_dispute_v2(ctx: Context<OpenMilestoneDisputeV2>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let opener = ctx.accounts.opener.key();
        require!(
            opener == escrow.buyer || opener == escrow.seller,
            EscrowError::Unauthorized
        );
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Submitted,
            EscrowError::InvalidMilestoneState
        );
        let dispute_fee = checked_dispute_fee(milestone.principal)?;
        require!(dispute_fee > 0, EscrowError::DisputeFeeTooSmall);
        milestone.dispute_fee_paid = milestone
            .dispute_fee_paid
            .checked_add(dispute_fee)
            .ok_or(EscrowError::AmountOverflow)?;
        milestone.state = MultiMilestoneState::Disputed;
        transfer_dispute_fee(
            &ctx.accounts.token_program,
            &ctx.accounts.mint,
            &mut ctx.accounts.opener_token_account,
            &mut ctx.accounts.fee_token_account,
            &ctx.accounts.opener,
            dispute_fee,
        )?;
        emit!(V2MilestoneDisputeOpened {
            milestone: milestone.key(),
            escrow: milestone.escrow,
            index: milestone.index,
            opener,
            fee_amount: dispute_fee,
        });
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn arbiter_release_milestone_v2(ctx: Context<ArbiterResolveMilestoneV2>) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Disputed,
            EscrowError::InvalidMilestoneState
        );
        milestone.state = MultiMilestoneState::Approved;
        milestone.seller_entitlement = milestone.principal;
        milestone.fee_entitlement = milestone.fee_reserve;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn arbiter_refund_milestone_v2(ctx: Context<ArbiterResolveMilestoneV2>) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Disputed,
            EscrowError::InvalidMilestoneState
        );
        milestone.state = MultiMilestoneState::Refunded;
        milestone.buyer_entitlement = milestone.expected_total;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn bilateral_refund_milestone_v2(ctx: Context<BilateralRefundMilestoneV2>) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            matches!(
                milestone.state,
                MultiMilestoneState::Funded | MultiMilestoneState::Submitted
            ),
            EscrowError::InvalidMilestoneState
        );
        milestone.state = MultiMilestoneState::Refunded;
        milestone.buyer_entitlement = milestone.expected_total;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    /// Refund a funded milestone when the seller never submitted delivery by
    /// the committed deadline. A submitted milestone must use the review or
    /// dispute path instead, so a late browser or operator cannot claw back
    /// work that was already submitted on chain.
    pub fn claim_milestone_late_refund_v2(ctx: Context<ClaimMilestoneLateRefundV2>) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Funded,
            EscrowError::InvalidMilestoneState
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now > milestone.delivery_deadline,
            EscrowError::DeliveryDeadlineNotPassed
        );
        milestone.state = MultiMilestoneState::Refunded;
        milestone.buyer_entitlement = milestone.expected_total;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn claim_milestone_seller_v2(ctx: Context<ClaimMilestoneSellerV2>) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Approved,
            EscrowError::InvalidMilestoneState
        );
        require!(
            milestone.seller_entitlement > 0,
            EscrowError::AlreadyClaimed
        );
        let amount = milestone.seller_entitlement;
        let milestone_escrow = milestone.escrow;
        let milestone_index = milestone.index;
        let milestone_bump = milestone.bump;
        milestone.seller_entitlement = 0;
        milestone.seller_claimed = true;
        milestone.state = if milestone.fee_entitlement == 0 {
            MultiMilestoneState::Closed
        } else {
            MultiMilestoneState::SellerPaid
        };
        transfer_from_milestone_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.seller_token_account,
            milestone,
            milestone_escrow,
            milestone_index,
            milestone_bump,
            amount,
        )?;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn claim_milestone_fee_v2(ctx: Context<ClaimMilestoneFeeV2>) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::SellerPaid,
            EscrowError::InvalidMilestoneState
        );
        require!(milestone.seller_claimed, EscrowError::SellerClaimRequired);
        require!(milestone.fee_entitlement > 0, EscrowError::AlreadyClaimed);
        let amount = milestone.fee_entitlement;
        let milestone_escrow = milestone.escrow;
        let milestone_index = milestone.index;
        let milestone_bump = milestone.bump;
        milestone.fee_entitlement = 0;
        milestone.fee_claimed = true;
        milestone.state = MultiMilestoneState::Closed;
        transfer_from_milestone_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.fee_token_account,
            milestone,
            milestone_escrow,
            milestone_index,
            milestone_bump,
            amount,
        )?;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn claim_milestone_buyer_refund_v2(
        ctx: Context<ClaimMilestoneBuyerRefundV2>,
    ) -> Result<()> {
        let milestone = &mut ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Refunded,
            EscrowError::InvalidMilestoneState
        );
        require!(milestone.buyer_entitlement > 0, EscrowError::AlreadyClaimed);
        let amount = milestone.buyer_entitlement;
        let milestone_escrow = milestone.escrow;
        let milestone_index = milestone.index;
        let milestone_bump = milestone.bump;
        milestone.buyer_entitlement = 0;
        milestone.buyer_claimed = true;
        milestone.state = MultiMilestoneState::Closed;
        transfer_from_milestone_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.buyer_token_account,
            milestone,
            milestone_escrow,
            milestone_index,
            milestone_bump,
            amount,
        )?;
        emit_v2_milestone_state(milestone.key(), milestone);
        Ok(())
    }

    pub fn close_milestone_v2(ctx: Context<CloseMilestoneV2>) -> Result<()> {
        let milestone = &ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Closed,
            EscrowError::InvalidMilestoneState
        );
        require!(
            milestone.seller_entitlement == 0
                && milestone.fee_entitlement == 0
                && milestone.buyer_entitlement == 0,
            EscrowError::OutstandingEntitlement
        );
        require!(ctx.accounts.vault.amount == 0, EscrowError::FundsPresent);
        emit_v2_milestone_state(milestone.key(), milestone);
        let index = milestone.index.to_le_bytes();
        let bump = [milestone.bump];
        let seeds: &[&[u8]] = &[b"milestone-v2", milestone.escrow.as_ref(), &index, &bump];
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: milestone.to_account_info(),
            },
            &[seeds],
        ))?;
        let escrow = &mut ctx.accounts.escrow;
        escrow.closed_milestones = escrow
            .closed_milestones
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;
        if escrow.closed_milestones == escrow.milestone_count {
            escrow.state = MultiEscrowState::Closed;
        }
        Ok(())
    }

    /// Return only unsolicited, non-entitled tokens from a closed milestone
    /// to the original buyer so the canonical vault can be closed. This never
    /// changes milestone entitlements and has no arbitrary destination.
    pub fn sweep_milestone_unentitled_dust(
        ctx: Context<SweepMilestoneUnentitledDust>,
    ) -> Result<()> {
        let milestone = &ctx.accounts.milestone;
        require!(
            milestone.state == MultiMilestoneState::Closed
                && milestone.seller_entitlement == 0
                && milestone.fee_entitlement == 0
                && milestone.buyer_entitlement == 0,
            EscrowError::OutstandingEntitlement
        );
        let amount = ctx.accounts.vault.amount;
        require!(amount > 0, EscrowError::NoDustToSweep);
        transfer_from_milestone_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.buyer_token_account,
            milestone,
            milestone.escrow,
            milestone.index,
            milestone.bump,
            amount,
        )?;
        emit!(V2UnentitledDustSwept {
            escrow: milestone.escrow,
            milestone: milestone.key(),
            vault: ctx.accounts.vault.key(),
            recipient: ctx.accounts.buyer.key(),
            amount,
        });
        Ok(())
    }

    /// Recover an unsolicited transfer made before a V2 milestone was funded.
    /// The milestone remains Unfunded and the fixed buyer destination is the
    /// only account that can receive the recovered tokens.
    pub fn recover_milestone_prefunding_dust(
        ctx: Context<RecoverMilestonePrefundingDust>,
    ) -> Result<()> {
        let milestone = &ctx.accounts.milestone;
        require!(
            matches!(
                ctx.accounts.escrow.state,
                MultiEscrowState::Created | MultiEscrowState::Accepted
            ) && milestone.state == MultiMilestoneState::Unfunded
                && milestone.seller_entitlement == 0
                && milestone.fee_entitlement == 0
                && milestone.buyer_entitlement == 0,
            EscrowError::InvalidMilestoneState
        );
        let amount = ctx.accounts.vault.amount;
        require!(amount > 0, EscrowError::NoDustToSweep);
        transfer_from_milestone_vault(
            &ctx.accounts.token_program,
            &mut ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.buyer_token_account,
            milestone,
            milestone.escrow,
            milestone.index,
            milestone.bump,
            amount,
        )?;
        emit!(V2PrefundingDustRecovered {
            escrow: milestone.escrow,
            milestone: milestone.key(),
            vault: ctx.accounts.vault.key(),
            recipient: ctx.accounts.buyer.key(),
            amount,
        });
        Ok(())
    }

    pub fn close_escrow_v2(ctx: Context<CloseEscrowV2>) -> Result<()> {
        require!(
            ctx.accounts.escrow.state == MultiEscrowState::Closed,
            EscrowError::InvalidState
        );
        require!(
            ctx.accounts.escrow.closed_milestones == ctx.accounts.escrow.milestone_count,
            EscrowError::MilestonesIncomplete
        );
        emit!(V2EscrowClosed {
            escrow: ctx.accounts.escrow.key()
        });
        Ok(())
    }
}

fn checked_fee(principal: u64) -> Result<u64> {
    let fee = (principal as u128)
        .checked_mul(PLATFORM_FEE_BPS as u128)
        .ok_or(EscrowError::AmountOverflow)?
        / BPS_DENOMINATOR;
    u64::try_from(fee).map_err(|_| error!(EscrowError::AmountOverflow))
}

fn checked_dispute_fee(principal: u64) -> Result<u64> {
    let fee = (principal as u128)
        .checked_mul(DISPUTE_FEE_BPS as u128)
        .ok_or(EscrowError::AmountOverflow)?
        / BPS_DENOMINATOR;
    u64::try_from(fee).map_err(|_| error!(EscrowError::AmountOverflow))
}

fn transfer_dispute_fee<'info>(
    token_program: &Program<'info, Token>,
    mint: &Account<'info, Mint>,
    source: &mut Account<'info, TokenAccount>,
    destination: &mut Account<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    let source_before = source.amount;
    let destination_before = destination.amount;
    token::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: source.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )?;
    source.reload()?;
    destination.reload()?;
    require!(
        source_before.checked_sub(source.amount) == Some(amount),
        EscrowError::TransferAmountMismatch
    );
    require!(
        destination_before.checked_add(amount) == Some(destination.amount),
        EscrowError::TransferAmountMismatch
    );
    Ok(())
}

fn maybe_close_common_ground(escrow: &mut Escrow) {
    if escrow.state == EscrowState::CommonGround
        && escrow.unresolved_principal == 0
        && escrow.seller_entitlement == 0
        && escrow.fee_entitlement == 0
        && escrow.buyer_entitlement == 0
    {
        escrow.state = EscrowState::Closed;
    }
}

fn validate_deadlines(
    funding_deadline: i64,
    delivery_deadline: i64,
    review_deadline: i64,
) -> Result<()> {
    validate_deadlines_at(
        Clock::get()?.unix_timestamp,
        funding_deadline,
        delivery_deadline,
        review_deadline,
    )
}

fn validate_deadlines_at(
    now: i64,
    funding_deadline: i64,
    delivery_deadline: i64,
    review_deadline: i64,
) -> Result<()> {
    require!(funding_deadline > now, EscrowError::InvalidDeadlines);
    require!(
        delivery_deadline > funding_deadline,
        EscrowError::InvalidDeadlines
    );
    let review_window = review_deadline
        .checked_sub(delivery_deadline)
        .ok_or(EscrowError::AmountOverflow)?;
    require!(
        review_window >= MIN_REVIEW_WINDOW_SECONDS,
        EscrowError::InvalidDeadlines
    );
    require!(
        review_window <= MAX_REVIEW_WINDOW_SECONDS,
        EscrowError::InvalidDeadlines
    );
    require!(
        funding_deadline
            .checked_sub(now)
            .ok_or(EscrowError::AmountOverflow)?
            <= MAX_FUNDING_HORIZON_SECONDS,
        EscrowError::InvalidDeadlines
    );
    require!(
        delivery_deadline
            .checked_sub(now)
            .ok_or(EscrowError::AmountOverflow)?
            <= MAX_DELIVERY_HORIZON_SECONDS,
        EscrowError::InvalidDeadlines
    );
    require!(
        review_deadline > delivery_deadline,
        EscrowError::InvalidDeadlines
    );
    Ok(())
}

fn validate_initialize_inputs(
    agreement_id_hash: [u8; 32],
    terms_hash: [u8; 32],
    buyer: Pubkey,
    seller: Pubkey,
    arbiter: Pubkey,
    fee_recipient: Pubkey,
    mint: Pubkey,
) -> Result<()> {
    require!(agreement_id_hash != [0u8; 32], EscrowError::InvalidHash);
    require!(terms_hash != [0u8; 32], EscrowError::InvalidHash);
    require!(buyer != Pubkey::default(), EscrowError::InvalidRoles);
    require!(seller != Pubkey::default(), EscrowError::InvalidRoles);
    require!(arbiter != Pubkey::default(), EscrowError::InvalidRoles);
    require!(seller != buyer, EscrowError::InvalidRoles);
    require!(
        arbiter != buyer && arbiter != seller,
        EscrowError::InvalidRoles
    );
    require!(
        fee_recipient != Pubkey::default(),
        EscrowError::InvalidRoles
    );
    require!(
        fee_recipient != buyer && fee_recipient != seller && fee_recipient != arbiter,
        EscrowError::InvalidRoles
    );
    // Test mints are permitted only by the debug-only lifecycle harness. A
    // release/SBF build must never be able to opt out of the production mint
    // allowlist merely by passing the test feature.
    if !(cfg!(feature = "test-mints") && cfg!(debug_assertions)) {
        require!(
            mint == MAINNET_USDC_MINT || mint == MAINNET_USDT_MINT || mint == DEVNET_USDC_MINT,
            EscrowError::UnsupportedMint
        );
    }
    Ok(())
}

fn validate_config_mints(accepted_mints: [Pubkey; 2]) -> Result<()> {
    require!(
        accepted_mints[0] != Pubkey::default(),
        EscrowError::UnsupportedMint
    );
    require!(
        accepted_mints[1] == Pubkey::default() || accepted_mints[1] != accepted_mints[0],
        EscrowError::UnsupportedMint
    );
    for mint in accepted_mints {
        if mint == Pubkey::default() {
            continue;
        }
        if !(cfg!(feature = "test-mints") && cfg!(debug_assertions)) {
            require!(
                mint == MAINNET_USDC_MINT || mint == MAINNET_USDT_MINT || mint == DEVNET_USDC_MINT,
                EscrowError::UnsupportedMint
            );
        }
    }
    Ok(())
}

fn transfer_from_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &mut Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    destination: &Account<'info, TokenAccount>,
    escrow: &Account<'info, Escrow>,
    amount: u64,
) -> Result<()> {
    let before = vault.amount;
    let bump = [escrow.bump];
    let seeds: &[&[u8]] = &[
        b"escrow",
        escrow.buyer.as_ref(),
        escrow.agreement_id_hash.as_ref(),
        &bump,
    ];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: escrow.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )?;
    vault.reload()?;
    require!(
        before.checked_sub(vault.amount) == Some(amount),
        EscrowError::TransferAmountMismatch
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn transfer_from_milestone_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &mut Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    destination: &Account<'info, TokenAccount>,
    milestone: &Account<'info, MilestoneV2>,
    escrow: Pubkey,
    index: u16,
    milestone_bump: u8,
    amount: u64,
) -> Result<()> {
    let before = vault.amount;
    let index_bytes = index.to_le_bytes();
    let bump = [milestone_bump];
    let seeds: &[&[u8]] = &[b"milestone-v2", escrow.as_ref(), &index_bytes, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: milestone.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )?;
    vault.reload()?;
    require!(
        before.checked_sub(vault.amount) == Some(amount),
        EscrowError::TransferAmountMismatch
    );
    Ok(())
}

pub const MAX_MILESTONES: u16 = 16;

/// Immutable deployment policy. There is deliberately no update instruction:
/// changing the treasury or authority requires deploying a new program ID and
/// publishing a new manifest rather than silently changing existing escrow.
#[account]
#[derive(InitSpace)]
pub struct DeploymentConfig {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub accepted_mints: [Pubkey; 2],
    pub bump: u8,
}

impl DeploymentConfig {
    fn accepts_mint(&self, mint: Pubkey) -> bool {
        self.accepted_mints.contains(&mint)
    }
}

#[account]
#[derive(InitSpace)]
pub struct MultiEscrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub fee_recipient: Pubkey,
    pub mint: Pubkey,
    pub agreement_id_hash: [u8; 32],
    pub terms_hash: [u8; 32],
    pub milestone_count: u16,
    pub created_milestones: u16,
    pub funded_milestones: u16,
    pub closed_milestones: u16,
    pub state: MultiEscrowState,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MilestoneV2 {
    pub escrow: Pubkey,
    pub index: u16,
    pub principal: u64,
    pub fee_reserve: u64,
    pub expected_total: u64,
    pub delivery_hash: [u8; 32],
    pub funding_deadline: i64,
    pub delivery_deadline: i64,
    pub review_deadline: i64,
    pub timed_release: bool,
    pub seller_entitlement: u64,
    pub fee_entitlement: u64,
    pub buyer_entitlement: u64,
    pub dispute_fee_paid: u64,
    pub state: MultiMilestoneState,
    pub bump: u8,
    pub vault_bump: u8,
    pub seller_claimed: bool,
    pub fee_claimed: bool,
    pub buyer_claimed: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MultiEscrowState {
    Created,
    Accepted,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MultiMilestoneState {
    Unfunded,
    Funded,
    Submitted,
    Disputed,
    Approved,
    SellerPaid,
    Refunded,
    Closed,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub fee_recipient: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub agreement_id_hash: [u8; 32],
    pub terms_hash: [u8; 32],
    pub delivery_hash: [u8; 32],
    pub principal: u64,
    pub fee_reserve: u64,
    pub expected_total: u64,
    pub seller_entitlement: u64,
    pub fee_entitlement: u64,
    pub buyer_entitlement: u64,
    pub dispute_fee_paid: u64,
    pub funding_deadline: i64,
    pub delivery_deadline: i64,
    pub review_deadline: i64,
    pub timed_release: bool,
    pub unresolved_principal: u64,
    pub common_ground_seller_amount: u64,
    pub common_ground_remainder: u64,
    pub common_ground_remainder_fee_reserve: u64,
    pub common_ground_executed: bool,
    pub decision_revision: u64,
    pub state: EscrowState,
    pub bump: u8,
    pub vault_bump: u8,
    pub accepted_at: i64,
    pub funded_at: i64,
    pub submitted_at: i64,
    pub approved_at: i64,
    pub settled_at: i64,
    pub seller_claimed: bool,
    pub fee_claimed: bool,
    pub buyer_claimed: bool,
}

#[account]
#[derive(InitSpace)]
pub struct CommonGroundProposal {
    pub escrow: Pubkey,
    pub proposer: Pubkey,
    pub nonce: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub terms_hash: [u8; 32],
    pub decision_revision: u64,
    pub unresolved_principal: u64,
    pub seller_amount: u64,
    pub buyer_principal_refund: u64,
    pub disputed_remainder: u64,
    pub expires_at: i64,
    pub buyer_approved: bool,
    pub seller_approved: bool,
    pub executed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowState {
    Created,
    Accepted,
    Funded,
    Submitted,
    Disputed,
    Approved,
    CommonGround,
    SellerPaid,
    Refunded,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ClaimKind {
    Seller,
    Fee,
    BuyerRefund,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub fee_recipient: Signer<'info>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ EscrowError::Unauthorized
    )]
    pub program: Program<'info, crate::program::EscrowGlobal>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key()) @ EscrowError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,
    #[account(
        init,
        payer = authority,
        space = 8 + DeploymentConfig::INIT_SPACE,
        seeds = [DEPLOYMENT_CONFIG_SEED],
        bump
    )]
    pub deployment_config: Account<'info, DeploymentConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(agreement_id_hash: [u8; 32])]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: stored as the immutable seller recipient; its token account is checked at claim time.
    pub seller: UncheckedAccount<'info>,
    /// The fixed settlement authority must consent to the appointment.
    pub arbiter: Signer<'info>,
    #[account(seeds = [DEPLOYMENT_CONFIG_SEED], bump = deployment_config.bump)]
    pub deployment_config: Account<'info, DeploymentConfig>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), agreement_id_hash.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = buyer,
        token::mint = mint,
        token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow,

    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SellerAccept<'info> {
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()], bump = escrow.bump, has_one = seller @ EscrowError::Unauthorized)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct AmendTerms<'info> {
    pub buyer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = seller @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct CancelUnfunded<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct SellerSubmit<'info> {
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()], bump = escrow.bump, has_one = seller @ EscrowError::Unauthorized)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    pub opener: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = fee_recipient @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    /// CHECK: the escrow account fixes this identity and the destination
    /// token account below fixes the token-account authority to this key.
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = opener)]
    pub opener_token_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = fee_recipient)]
    pub fee_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ArbiterResolve<'info> {
    pub arbiter: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = arbiter @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct BuyerApprove<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()], bump = escrow.bump, has_one = buyer @ EscrowError::Unauthorized)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ExecuteReviewTimeout<'info> {
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
#[instruction(proposal_nonce: u64)]
pub struct ProposeCommonGround<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(
        init,
        payer = proposer,
        space = 8 + CommonGroundProposal::INIT_SPACE,
        seeds = [b"common-ground", escrow.key().as_ref(), &proposal_nonce.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, CommonGroundProposal>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveCommonGround<'info> {
    pub approver: Signer<'info>,
    #[account(
        mut,
        seeds = [b"common-ground", escrow.key().as_ref(), &proposal.nonce.to_le_bytes()],
        bump = proposal.bump,
        has_one = escrow @ EscrowError::ProposalEscrowMismatch
    )]
    pub proposal: Account<'info, CommonGroundProposal>,
    #[account(seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ExecuteCommonGround<'info> {
    pub cranker: Signer<'info>,
    #[account(
        mut,
        seeds = [b"common-ground", escrow.key().as_ref(), &proposal.nonce.to_le_bytes()],
        bump = proposal.bump,
        has_one = escrow @ EscrowError::ProposalEscrowMismatch
    )]
    pub proposal: Account<'info, CommonGroundProposal>,
    #[account(mut, seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ResolveCommonGroundRemainder<'info> {
    pub buyer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = seller @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct CloseCommonGroundProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,
    #[account(
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        mut,
        close = proposer,
        seeds = [b"common-ground", proposal.escrow.as_ref(), &proposal.nonce.to_le_bytes()],
        bump = proposal.bump,
        has_one = proposer @ EscrowError::Unauthorized,
        has_one = escrow @ EscrowError::ProposalEscrowMismatch
    )]
    pub proposal: Account<'info, CommonGroundProposal>,
}

#[derive(Accounts)]
pub struct BilateralRefund<'info> {
    pub buyer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()], bump = escrow.bump, has_one = buyer @ EscrowError::Unauthorized, has_one = seller @ EscrowError::Unauthorized)]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ClaimLateRefund<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimSeller<'info> {
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = seller @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub seller_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimFee<'info> {
    pub fee_recipient: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = fee_recipient @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = fee_recipient)]
    pub fee_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimBuyerRefund<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SweepUnentitledDust<'info> {
    pub buyer: Signer<'info>,
    #[account(
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RecoverPrefundingDust<'info> {
    pub buyer: Signer<'info>,
    #[account(
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = vault @ EscrowError::VaultMismatch
    )]
    pub escrow: Account<'info, Escrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault", escrow.key().as_ref()],
        bump = escrow.vault_bump,
        token::mint = mint,
        token::authority = escrow
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(agreement_id_hash: [u8; 32])]
pub struct InitializeV2<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: stored as the immutable seller identity.
    pub seller: UncheckedAccount<'info>,
    /// The fixed adjudicator must consent to the appointment.
    pub arbiter: Signer<'info>,
    #[account(seeds = [DEPLOYMENT_CONFIG_SEED], bump = deployment_config.bump)]
    pub deployment_config: Account<'info, DeploymentConfig>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        space = 8 + MultiEscrow::INIT_SPACE,
        seeds = [b"escrow-v2", buyer.key().as_ref(), agreement_id_hash.as_ref()],
        bump
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(index: u16)]
pub struct CreateMilestoneV2<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        space = 8 + MilestoneV2::INIT_SPACE,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &index.to_le_bytes()],
        bump
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        init,
        payer = buyer,
        token::mint = mint,
        token::authority = milestone,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellerAcceptV2<'info> {
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = seller @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
}

#[derive(Accounts)]
pub struct AmendTermsV2<'info> {
    pub buyer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = seller @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
}

#[derive(Accounts)]
pub struct FundMilestoneV2<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SellerSubmitMilestoneV2<'info> {
    pub seller: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = seller @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
}

#[derive(Accounts)]
pub struct BuyerApproveMilestoneV2<'info> {
    pub buyer: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
}

#[derive(Accounts)]
pub struct ExecuteMilestoneReviewTimeout<'info> {
    pub cranker: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, MultiEscrow>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
}

#[derive(Accounts)]
pub struct OpenMilestoneDisputeV2<'info> {
    pub opener: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = mint @ EscrowError::MintMismatch,
        has_one = fee_recipient @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    /// CHECK: the escrow account fixes this identity and the destination
    /// token account below fixes the token-account authority to this key.
    pub fee_recipient: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(mut, token::mint = mint, token::authority = opener)]
    pub opener_token_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = fee_recipient)]
    pub fee_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ArbiterResolveMilestoneV2<'info> {
    pub arbiter: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = arbiter @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
}

#[derive(Accounts)]
pub struct BilateralRefundMilestoneV2<'info> {
    pub buyer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = seller @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
}

#[derive(Accounts)]
pub struct ClaimMilestoneLateRefundV2<'info> {
    pub buyer: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimMilestoneSellerV2<'info> {
    pub seller: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = seller @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub seller_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimMilestoneFeeV2<'info> {
    pub fee_recipient: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = fee_recipient @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = fee_recipient)]
    pub fee_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimMilestoneBuyerRefundV2<'info> {
    pub buyer: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelMilestoneV2<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseMilestoneV2<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SweepMilestoneUnentitledDust<'info> {
    pub buyer: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RecoverMilestonePrefundingDust<'info> {
    pub buyer: Signer<'info>,
    #[account(
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized,
        has_one = mint @ EscrowError::MintMismatch
    )]
    pub escrow: Account<'info, MultiEscrow>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [b"milestone-v2", escrow.key().as_ref(), &milestone.index.to_le_bytes()],
        bump = milestone.bump,
        has_one = escrow
    )]
    pub milestone: Account<'info, MilestoneV2>,
    #[account(
        mut,
        seeds = [b"vault-v2", milestone.key().as_ref()],
        bump = milestone.vault_bump,
        token::mint = mint,
        token::authority = milestone
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseEscrowV2<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"escrow-v2", escrow.buyer.as_ref(), escrow.agreement_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = buyer @ EscrowError::Unauthorized
    )]
    pub escrow: Account<'info, MultiEscrow>,
}

#[event]
pub struct DeploymentConfigInitialized {
    pub deployment_config: Pubkey,
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub accepted_mints: [Pubkey; 2],
}

#[event]
pub struct AgreementInitialized {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub mint: Pubkey,
    pub principal: u64,
    pub fee_reserve: u64,
    pub terms_hash: [u8; 32],
    pub funding_deadline: i64,
    pub delivery_deadline: i64,
    pub review_deadline: i64,
    pub timed_release: bool,
}

#[event]
pub struct AgreementFunded {
    pub escrow: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SellerAccepted {
    pub escrow: Pubkey,
    pub terms_hash: [u8; 32],
}

#[event]
pub struct TermsAmended {
    pub escrow: Pubkey,
    pub old_terms_hash: [u8; 32],
    pub new_terms_hash: [u8; 32],
}

#[event]
pub struct SellerSubmitted {
    pub escrow: Pubkey,
    pub delivery_hash: [u8; 32],
}

#[event]
pub struct DisputeOpened {
    pub escrow: Pubkey,
    pub opener: Pubkey,
    pub fee_amount: u64,
}

#[event]
pub struct ArbiterResolved {
    pub escrow: Pubkey,
    pub release_to_seller: bool,
    pub seller_amount: u64,
    pub buyer_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct BuyerApproved {
    pub escrow: Pubkey,
    pub seller_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct ReviewTimeoutExecuted {
    pub escrow: Pubkey,
    pub seller_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct AgreementRefunded {
    pub escrow: Pubkey,
    pub buyer_amount: u64,
}

#[event]
pub struct AgreementCancelled {
    pub escrow: Pubkey,
}

#[event]
pub struct AgreementClosed {
    pub escrow: Pubkey,
}

#[event]
pub struct UnentitledDustSwept {
    pub escrow: Pubkey,
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PrefundingDustRecovered {
    pub escrow: Pubkey,
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CommonGroundProposed {
    pub escrow: Pubkey,
    pub proposal: Pubkey,
    pub seller_amount: u64,
    pub buyer_principal_refund: u64,
    pub disputed_remainder: u64,
    pub expires_at: i64,
}

#[event]
pub struct CommonGroundApproved {
    pub escrow: Pubkey,
    pub proposal: Pubkey,
    pub approver: Pubkey,
}

#[event]
pub struct CommonGroundExecuted {
    pub escrow: Pubkey,
    pub proposal: Pubkey,
    pub seller_amount: u64,
    pub buyer_amount: u64,
    pub disputed_remainder: u64,
    pub fee_amount: u64,
}

#[event]
pub struct CommonGroundRemainderResolved {
    pub escrow: Pubkey,
    pub to_seller: bool,
    pub seller_amount: u64,
    pub buyer_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct Claimed {
    pub escrow: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub kind: ClaimKind,
}

#[event]
pub struct V2EscrowInitialized {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub mint: Pubkey,
    pub milestone_count: u16,
}

#[event]
pub struct V2SellerAccepted {
    pub escrow: Pubkey,
    pub terms_hash: [u8; 32],
}

#[event]
pub struct V2EscrowClosed {
    pub escrow: Pubkey,
}

#[event]
pub struct V2UnentitledDustSwept {
    pub escrow: Pubkey,
    pub milestone: Pubkey,
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct V2PrefundingDustRecovered {
    pub escrow: Pubkey,
    pub milestone: Pubkey,
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct V2MilestoneCreated {
    pub milestone: Pubkey,
    pub escrow: Pubkey,
    pub index: u16,
    pub principal: u64,
    pub fee_reserve: u64,
    pub expected_total: u64,
    pub funding_deadline: i64,
    pub delivery_deadline: i64,
    pub review_deadline: i64,
    pub timed_release: bool,
}

#[event]
pub struct V2MilestoneStateChanged {
    pub milestone: Pubkey,
    pub escrow: Pubkey,
    pub index: u16,
    pub state: MultiMilestoneState,
    pub seller_entitlement: u64,
    pub fee_entitlement: u64,
    pub buyer_entitlement: u64,
}

#[event]
pub struct V2MilestoneCancelled {
    pub milestone: Pubkey,
    pub escrow: Pubkey,
    pub index: u16,
}

#[event]
pub struct V2MilestoneDisputeOpened {
    pub milestone: Pubkey,
    pub escrow: Pubkey,
    pub index: u16,
    pub opener: Pubkey,
    pub fee_amount: u64,
}

fn emit_v2_milestone_state(milestone_key: Pubkey, milestone: &MilestoneV2) {
    emit!(V2MilestoneStateChanged {
        milestone: milestone_key,
        escrow: milestone.escrow,
        index: milestone.index,
        state: milestone.state,
        seller_entitlement: milestone.seller_entitlement,
        fee_entitlement: milestone.fee_entitlement,
        buyer_entitlement: milestone.buyer_entitlement,
    });
}

#[error_code]
pub enum EscrowError {
    #[msg("Principal must be greater than zero")]
    InvalidAmount,
    #[msg("The agreement is not in the required state")]
    InvalidState,
    #[msg("The signer is not an allowed party for this action")]
    Unauthorized,
    #[msg("The mint does not match the agreement")]
    MintMismatch,
    #[msg("The vault does not match the agreement")]
    VaultMismatch,
    #[msg("The amount exceeds u64 or the configured fee calculation")]
    AmountOverflow,
    #[msg("The token transfer changed the vault by an unexpected amount")]
    TransferAmountMismatch,
    #[msg("This entitlement has already been claimed")]
    AlreadyClaimed,
    #[msg("Agreement and terms commitments must be non-zero")]
    InvalidHash,
    #[msg("The arbiter, buyer, seller, and fee recipient roles are invalid")]
    InvalidRoles,
    #[msg("The seller supplied a terms commitment different from the agreement")]
    TermsMismatch,
    #[msg("The settlement mint is not an admitted Escrow Global stablecoin")]
    UnsupportedMint,
    #[msg("The settlement mint is not configured for this deployment")]
    MintNotConfigured,
    #[msg("The vault contains funds and cannot be cancelled as unfunded")]
    FundsPresent,
    #[msg("The escrow still has an unpaid entitlement")]
    OutstandingEntitlement,
    #[msg("The funding, delivery, or review deadlines are invalid")]
    InvalidDeadlines,
    #[msg("Funding was attempted after the funding deadline")]
    FundingDeadlinePassed,
    #[msg("Delivery was submitted after the delivery deadline")]
    DeliveryDeadlinePassed,
    #[msg("Buyer approval was attempted after the review deadline")]
    ReviewDeadlinePassed,
    #[msg("The review timeout has not expired")]
    ReviewWindowNotExpired,
    #[msg("Timed release is not enabled for this agreement")]
    TimedReleaseDisabled,
    #[msg("The delivery deadline has not passed")]
    DeliveryDeadlineNotPassed,
    #[msg("The Common Ground proposal expiry is invalid")]
    InvalidProposalExpiry,
    #[msg("The Common Ground proposal has already been consumed")]
    ProposalConsumed,
    #[msg("The Common Ground proposal is stale")]
    StaleProposal,
    #[msg("The Common Ground proposal has expired")]
    ProposalExpired,
    #[msg("The same party cannot approve a Common Ground proposal twice")]
    DuplicateApproval,
    #[msg("There are no unsolicited tokens to sweep")]
    NoDustToSweep,
    #[msg("Both original parties must approve the Common Ground proposal")]
    MissingApproval,
    #[msg("The Common Ground proposal is linked to another escrow")]
    ProposalEscrowMismatch,
    #[msg("The Common Ground proposal parties do not match the escrow")]
    ProposalPartyMismatch,
    #[msg("The Common Ground proposal still has an open expiry")]
    ProposalStillOpen,
    #[msg("There is no disputed Common Ground remainder")]
    NoDisputedRemainder,
    #[msg("A seller claim must settle before the fee claim")]
    SellerClaimRequired,
    #[msg("The multi-milestone escrow count is outside the supported bound")]
    InvalidMilestoneCount,
    #[msg("Milestone indexes must be contiguous and within the escrow bound")]
    InvalidMilestoneIndex,
    #[msg("All declared milestones must be created before seller acceptance")]
    MilestonesIncomplete,
    #[msg("The milestone is not in the required state")]
    InvalidMilestoneState,
    #[msg("The formal dispute charge rounds below one token unit")]
    DisputeFeeTooSmall,
    #[msg("Terms can only be amended before funding")]
    TermsAmendmentAfterFunding,
    #[msg("The new terms commitment is unchanged")]
    TermsHashUnchanged,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_account_layout_sizes_match_reconciliation_contract() {
        assert_eq!(Escrow::INIT_SPACE, 456);
        assert_eq!(MultiEscrow::INIT_SPACE, 234);
        assert_eq!(MilestoneV2::INIT_SPACE, 153);
    }

    #[test]
    fn fee_is_floor_three_percent() {
        assert_eq!(checked_fee(450_000_000).unwrap(), 13_500_000);
        assert_eq!(checked_fee(99).unwrap(), 2);
    }

    #[test]
    fn fee_uses_wide_intermediate_without_overflow() {
        assert_eq!(checked_fee(u64::MAX).unwrap(), 553_402_322_211_286_548);
    }

    #[test]
    fn dispute_fee_is_floor_five_percent() {
        assert_eq!(checked_dispute_fee(450_000_000).unwrap(), 22_500_000);
        assert_eq!(checked_dispute_fee(99).unwrap(), 4);
        assert_eq!(
            checked_dispute_fee(u64::MAX).unwrap(),
            922_337_203_685_477_580
        );
    }

    #[test]
    fn deadline_policy_requires_ordered_bounded_windows() {
        assert!(validate_deadlines_at(1_000, 1_001, 1_061, 1_121).is_ok());
        assert!(validate_deadlines_at(1_000, 1_000, 1_061, 1_121).is_err());
        assert!(validate_deadlines_at(1_000, 1_001, 1_000, 1_121).is_err());
        assert!(validate_deadlines_at(1_000, 1_001, 1_061, 1_120).is_err());
        let late_funding = 1_000 + MAX_FUNDING_HORIZON_SECONDS + 1;
        assert!(
            validate_deadlines_at(1_000, late_funding, late_funding + 60, late_funding + 120)
                .is_err()
        );
    }

    #[test]
    fn zero_commitments_are_rejected() {
        let buyer = Pubkey::new_unique();
        let seller = Pubkey::new_unique();
        let arbiter = Pubkey::new_unique();
        let fee_recipient = Pubkey::new_unique();
        assert!(validate_initialize_inputs(
            [0u8; 32],
            [1u8; 32],
            buyer,
            seller,
            arbiter,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [0u8; 32],
            buyer,
            seller,
            arbiter,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            buyer,
            arbiter,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            seller,
            buyer,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            seller,
            arbiter,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_ok());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            seller,
            arbiter,
            buyer,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            seller,
            arbiter,
            fee_recipient,
            Pubkey::new_unique()
        )
        .is_err());
    }
}

#[cfg(test)]
mod property_tests {
    use super::*;

    // A fixed, dependency-free generator gives reproducible boundary coverage
    // in the native test target without pretending to replace fuzzing.
    struct SplitMix64(u64);

    impl SplitMix64 {
        fn new(seed: u64) -> Self {
            Self(seed)
        }

        fn next_u64(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut value = self.0;
            value = (value ^ (value >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            value = (value ^ (value >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            value ^ (value >> 31)
        }

        fn pubkey(&mut self, salt: u64) -> Pubkey {
            let mut bytes = [0u8; 32];
            for chunk in bytes.chunks_exact_mut(8) {
                chunk.copy_from_slice(&self.next_u64().wrapping_add(salt).to_le_bytes());
            }
            bytes[0] |= 1;
            Pubkey::new_from_array(bytes)
        }

        fn hash(&mut self) -> [u8; 32] {
            let mut bytes = [0u8; 32];
            for chunk in bytes.chunks_exact_mut(8) {
                chunk.copy_from_slice(&self.next_u64().to_le_bytes());
            }
            bytes[0] |= 1;
            bytes
        }
    }

    fn reference_fee(principal: u64, bps: u64) -> u64 {
        ((principal as u128 * bps as u128) / BPS_DENOMINATOR) as u64
    }

    #[test]
    fn fee_properties_match_wide_reference_and_are_monotone() {
        let mut rng = SplitMix64::new(0xC0FF_EE01);
        let mut amounts = vec![0, 1, 2, 9_999, 10_000, u32::MAX as u64, u64::MAX];
        amounts.extend((0..512).map(|_| rng.next_u64()));
        amounts.sort_unstable();

        let mut previous = 0;
        for amount in amounts {
            let fee = checked_fee(amount).unwrap();
            assert_eq!(fee, reference_fee(amount, PLATFORM_FEE_BPS));
            assert!(fee >= previous, "fee decreased at principal {amount}");
            previous = fee;
        }
        assert_eq!(checked_fee(0).unwrap(), 0);
        assert_eq!(
            checked_fee(u64::MAX).unwrap(),
            reference_fee(u64::MAX, PLATFORM_FEE_BPS)
        );
    }

    #[test]
    fn dispute_fee_properties_match_wide_reference_and_are_monotone() {
        let mut rng = SplitMix64::new(0xDEAD_BEEF);
        let mut amounts = vec![0, 1, 4, 9_999, 10_000, u32::MAX as u64, u64::MAX];
        amounts.extend((0..512).map(|_| rng.next_u64()));
        amounts.sort_unstable();

        let mut previous = 0;
        for amount in amounts {
            let fee = checked_dispute_fee(amount).unwrap();
            assert_eq!(fee, reference_fee(amount, DISPUTE_FEE_BPS));
            assert!(
                fee >= previous,
                "dispute fee decreased at principal {amount}"
            );
            previous = fee;
        }
        assert_eq!(checked_dispute_fee(0).unwrap(), 0);
        assert_eq!(
            checked_dispute_fee(u64::MAX).unwrap(),
            reference_fee(u64::MAX, DISPUTE_FEE_BPS)
        );
    }

    #[test]
    fn deadline_properties_accept_valid_windows_and_reject_each_boundary() {
        let mut rng = SplitMix64::new(0x1234_5678);
        for _ in 0..512 {
            let now = 1_000_000 + (rng.next_u64() % 1_000_000) as i64;
            let funding_offset = 1 + (rng.next_u64() % MAX_FUNDING_HORIZON_SECONDS as u64) as i64;
            let delivery_offset = funding_offset
                + 1
                + (rng.next_u64() % (MAX_DELIVERY_HORIZON_SECONDS - funding_offset) as u64) as i64;
            let review_window = MIN_REVIEW_WINDOW_SECONDS
                + (rng.next_u64()
                    % (MAX_REVIEW_WINDOW_SECONDS - MIN_REVIEW_WINDOW_SECONDS + 1) as u64)
                    as i64;
            assert!(validate_deadlines_at(
                now,
                now + funding_offset,
                now + delivery_offset,
                now + delivery_offset + review_window,
            )
            .is_ok());
        }

        let now = 1_000_000;
        let funding = now + 1;
        let delivery = funding + 1;
        assert!(validate_deadlines_at(now, now, delivery, delivery + 60).is_err());
        assert!(validate_deadlines_at(
            now,
            now + MAX_FUNDING_HORIZON_SECONDS + 1,
            now + MAX_FUNDING_HORIZON_SECONDS + 2,
            now + MAX_FUNDING_HORIZON_SECONDS + 62,
        )
        .is_err());
        assert!(validate_deadlines_at(now, funding, funding, funding + 60).is_err());
        assert!(validate_deadlines_at(
            now,
            funding,
            now + MAX_DELIVERY_HORIZON_SECONDS + 1,
            now + MAX_DELIVERY_HORIZON_SECONDS + 61,
        )
        .is_err());
        assert!(validate_deadlines_at(
            now,
            funding,
            delivery,
            delivery + MIN_REVIEW_WINDOW_SECONDS - 1
        )
        .is_err());
        assert!(validate_deadlines_at(
            now,
            funding,
            delivery,
            delivery + MAX_REVIEW_WINDOW_SECONDS + 1
        )
        .is_err());
        assert!(validate_deadlines_at(i64::MIN, i64::MIN, i64::MAX, i64::MAX).is_err());
    }

    #[test]
    fn initialization_properties_keep_roles_hashes_and_mints_constrained() {
        let mut rng = SplitMix64::new(0xABCD_EF01);
        for index in 0..512u64 {
            let buyer = rng.pubkey(index);
            let seller = rng.pubkey(index.wrapping_add(1_000));
            let arbiter = rng.pubkey(index.wrapping_add(2_000));
            let fee_recipient = rng.pubkey(index.wrapping_add(3_000));
            assert!(validate_initialize_inputs(
                rng.hash(),
                rng.hash(),
                buyer,
                seller,
                arbiter,
                fee_recipient,
                MAINNET_USDC_MINT,
            )
            .is_ok());
        }

        let buyer = Pubkey::new_unique();
        let seller = Pubkey::new_unique();
        let arbiter = Pubkey::new_unique();
        let fee_recipient = Pubkey::new_unique();
        let valid = || {
            validate_initialize_inputs(
                [1u8; 32],
                [2u8; 32],
                buyer,
                seller,
                arbiter,
                fee_recipient,
                MAINNET_USDC_MINT,
            )
        };
        assert!(valid().is_ok());
        assert!(validate_initialize_inputs(
            [0u8; 32],
            [2u8; 32],
            buyer,
            seller,
            arbiter,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [0u8; 32],
            buyer,
            seller,
            arbiter,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            buyer,
            arbiter,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            seller,
            buyer,
            fee_recipient,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            seller,
            arbiter,
            buyer,
            MAINNET_USDC_MINT
        )
        .is_err());
        assert!(validate_initialize_inputs(
            [1u8; 32],
            [2u8; 32],
            buyer,
            seller,
            arbiter,
            fee_recipient,
            Pubkey::new_unique()
        )
        .is_err());
    }
}
