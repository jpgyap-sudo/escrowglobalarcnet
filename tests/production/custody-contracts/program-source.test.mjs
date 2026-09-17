import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../../../packages/custody-contracts/program/programs/escrow-global/src/lib.rs');
const source = fs.readFileSync(sourcePath, 'utf8');
const manifestPath = path.resolve(here, '../../../packages/custody-contracts/program/programs/escrow-global/Cargo.toml');
const manifest = fs.readFileSync(manifestPath, 'utf8');

test('on-chain safety boundary stays bilateral and original-SPL-only at runtime', () => {
  const initializeBlock = source.slice(source.indexOf('pub struct Initialize<'), source.indexOf('\n#[derive(Accounts)]', source.indexOf('pub struct Initialize<')));
  const initializeV2Block = source.slice(source.indexOf('pub struct InitializeV2<'), source.indexOf('\n#[derive(Accounts)]', source.indexOf('pub struct InitializeV2<')));
  assert.doesNotMatch(source, /token_interface|InterfaceAccount|TokenInterface/);
  assert.match(manifest, /default-features\s*=\s*false/);
  assert.match(manifest, /features\s*=\s*\["token",\s*"token_2022"\]/);
  assert.doesNotMatch(manifest, /init-if-needed/);
  assert.match(manifest, /generated legacy-token account validation compiles/);
  assert.match(source, /pub token_program: Program<'info, Token>/);
  assert.match(source, /pub struct InitializeConfig[\s\S]*?pub fee_recipient: Signer/);
  assert.match(source, /pub struct Initialize[\s\S]*?pub deployment_config: Account<'info, DeploymentConfig>/);
  assert.match(source, /pub struct InitializeV2[\s\S]*?pub deployment_config: Account<'info, DeploymentConfig>/);
  assert.doesNotMatch(initializeBlock, /fee_recipient: Signer/);
  assert.doesNotMatch(initializeV2Block, /fee_recipient: Signer/);
  assert.match(source, /pub fn initialize_config\(/);
  assert.match(source, /accepted_mints: \[Pubkey; 2\]/);
  assert.match(source, /accepts_mint\(/);
  assert.match(source, /pub struct DeploymentConfig[\s\S]*?pub fee_recipient: Pubkey/);
  assert.match(source, /pub struct InitializeConfig[\s\S]*?program\.programdata_address\(\)\? == Some\(program_data\.key\(\)\)/);
  assert.match(source, /pub struct InitializeConfig[\s\S]*?program_data\.upgrade_authority_address == Some\(authority\.key\(\)\)/);
  assert.match(source, /pub struct Initialize[\s\S]*?pub arbiter: Signer/);
  assert.match(source, /pub struct InitializeV2[\s\S]*?pub arbiter: Signer/);
  assert.match(source, /pub fn seller_accept\(/);
  assert.match(source, /pub fn amend_terms\(/);
  assert.match(source, /pub fn cancel_unfunded\(/);
  assert.match(source, /pub fn close_escrow\(/);
  assert.match(source, /pub fn execute_review_timeout\(/);
  assert.match(source, /pub fn claim_late_refund\(/);
  assert.match(source, /pub fn open_dispute\(/);
  assert.match(source, /pub const DISPUTE_FEE_BPS: u64 = 500/);
  assert.match(source, /pub dispute_fee_paid: u64/);
  assert.match(source, /pub fn arbiter_release\(/);
  assert.match(source, /pub fn arbiter_refund\(/);
  assert.match(source, /pub fn initialize_v2\(/);
  assert.match(source, /pub fn seller_accept_v2[\s\S]*?emit!\(V2SellerAccepted/);
  assert.match(source, /pub struct V2SellerAccepted[\s\S]*?pub terms_hash: \[u8; 32\]/);
  assert.match(source, /pub fn close_escrow\([\s\S]*?emit!\(AgreementClosed/);
  assert.match(source, /pub fn close_escrow_v2\([\s\S]*?emit!\(V2EscrowClosed/);
  assert.match(source, /pub fn sweep_unentitled_dust\([\s\S]*?EscrowState::Closed/);
  assert.match(source, /pub fn sweep_milestone_unentitled_dust\([\s\S]*?MultiMilestoneState::Closed/);
  assert.match(source, /pub fn recover_prefunding_dust\([\s\S]*?EscrowState::Created/);
  assert.match(source, /pub fn recover_milestone_prefunding_dust\([\s\S]*?MultiMilestoneState::Unfunded/);
  assert.match(source, /pub struct SweepUnentitledDust[\s\S]*?has_one = buyer[\s\S]*?buyer_token_account/);
  assert.match(source, /pub struct SweepMilestoneUnentitledDust[\s\S]*?has_one = buyer[\s\S]*?buyer_token_account/);
  assert.match(source, /pub struct RecoverPrefundingDust[\s\S]*?has_one = buyer[\s\S]*?buyer_token_account/);
  assert.match(source, /pub struct RecoverMilestonePrefundingDust[\s\S]*?has_one = buyer[\s\S]*?buyer_token_account/);
  assert.match(source, /pub struct UnentitledDustSwept[\s\S]*?pub amount: u64/);
  assert.match(source, /pub struct V2UnentitledDustSwept[\s\S]*?pub amount: u64/);
  assert.match(source, /pub struct PrefundingDustRecovered[\s\S]*?pub amount: u64/);
  assert.match(source, /pub struct V2PrefundingDustRecovered[\s\S]*?pub amount: u64/);
  assert.match(source, /pub struct AgreementClosed[\s\S]*?pub escrow: Pubkey/);
  assert.match(source, /pub struct V2EscrowClosed[\s\S]*?pub escrow: Pubkey/);
  assert.match(source, /pub fn amend_terms_v2\(/);
  assert.match(source, /pub fn create_milestone_v2\(/);
  assert.match(source, /pub fn cancel_milestone_v2\(/);
  assert.match(source, /pub fn fund_milestone_v2\(/);
  assert.match(source, /pub fn claim_milestone_seller_v2\(/);
  assert.match(source, /pub fn claim_milestone_late_refund_v2\(/);
  assert.match(source, /pub fn close_milestone_v2\(/);
  assert.match(source, /pub const MAX_MILESTONES: u16 = 16/);
  assert.match(source, /pub struct CancelMilestoneV2[\s\S]*?#\[account\(mut\)\]\s*pub buyer: Signer/);
  assert.match(source, /pub struct CancelMilestoneV2[\s\S]*?close = buyer[\s\S]*?pub milestone: Account<'info, MilestoneV2>/);
  assert.match(source, /pub struct MilestoneV2[\s\S]*?pub vault_bump: u8/);
  assert.match(source, /pub struct MultiEscrow[\s\S]*?pub funded_milestones: u16/);
  assert.match(source, /pub struct FundMilestoneV2[\s\S]*?\#\[account\([\s\S]*?mut,[\s\S]*?seeds = \[b"escrow-v2"/);
  assert.match(source, /pub struct V2MilestoneStateChanged[\s\S]*?pub buyer_entitlement: u64/);
  assert.match(source, /token::authority = milestone/);
  assert.match(source, /pub struct ArbiterResolve[\s\S]*?has_one = arbiter @ EscrowError::Unauthorized/);
  assert.match(source, /pub fn propose_common_ground\(/);
  assert.match(source, /pub fn approve_common_ground\(/);
  assert.match(source, /pub fn execute_common_ground\(/);
  assert.match(source, /pub fn resolve_common_ground_remainder\(/);
  assert.match(source, /pub fn bilateral_refund\(/);
  assert.doesNotMatch(source, /pub fn release\(/);
  assert.doesNotMatch(source, /pub fn refund\(/);
});

test('funding and payout authorization cannot skip the bilateral lifecycle', () => {
  assert.match(source, /pub fn fund[\s\S]*?EscrowState::Accepted/);
  assert.match(source, /pub fn fund[\s\S]*?ctx\.accounts\.vault\.amount == 0/);
  assert.match(source, /pub struct BilateralRefund[\s\S]*?pub buyer: Signer[\s\S]*?pub seller: Signer/);
  assert.match(source, /pub struct AmendTerms[\s\S]*?pub buyer: Signer[\s\S]*?pub seller: Signer[\s\S]*?has_one = buyer[\s\S]*?has_one = seller/);
  assert.match(source, /pub struct AmendTermsV2[\s\S]*?pub buyer: Signer[\s\S]*?pub seller: Signer[\s\S]*?has_one = buyer[\s\S]*?has_one = seller/);
  assert.match(source, /pub fn amend_terms_v2[\s\S]*?funded_milestones == 0/);
  assert.match(source, /pub fn claim_seller[\s\S]*?EscrowState::Approved/);
  assert.match(source, /pub fn claim_fee[\s\S]*?EscrowState::SellerPaid/);
  assert.match(source, /funding_deadline/);
  assert.match(source, /delivery_deadline/);
  assert.match(source, /review_deadline/);
  assert.match(source, /MAX_REVIEW_WINDOW_SECONDS/);
  assert.match(source, /EscrowError::TimedReleaseDisabled/);
  assert.match(source, /fn transfer_dispute_fee/);
  assert.match(source, /pub struct V2MilestoneDisputeOpened/);
  assert.match(source, /pub buyer_approved: bool/);
  assert.match(source, /pub seller_approved: bool/);
  assert.match(source, /EscrowError::MissingApproval/);
  assert.match(source, /escrow\.state = EscrowState::Closed/);
  assert.match(source, /pub struct CancelUnfunded[\s\S]*?has_one = vault @ EscrowError::VaultMismatch/);
});

test('economic and destination guards remain explicit', () => {
  assert.match(source, /principal as u128/);
  assert.match(source, /\.checked_add\(fee_reserve\)/);
  assert.match(source, /buyer_token_account: Account<'info, TokenAccount>/);
  assert.match(source, /#\[account\(mut, token::mint = mint, token::authority = buyer\)\]/);
  assert.match(source, /has_one = seller @ EscrowError::Unauthorized/);
  assert.match(source, /has_one = fee_recipient @ EscrowError::Unauthorized/);
  assert.match(source, /MAINNET_USDC_MINT/);
  assert.match(source, /UnsupportedMint/);
  assert.match(source, /cfg!\(feature = "test-mints"\)\s*&&\s*cfg!\(debug_assertions\)/);
});

test('every full V1 settlement outcome clears unresolved principal', () => {
  const fullOutcomeHandlers = [
    'cancel_unfunded',
    'arbiter_release',
    'arbiter_refund',
    'buyer_approve',
    'execute_review_timeout',
    'bilateral_refund',
    'claim_late_refund'
  ];
  for (const name of fullOutcomeHandlers) {
    const start = source.indexOf(`pub fn ${name}`);
    assert.notEqual(start, -1, `missing ${name}`);
    const next = source.indexOf('\n    pub fn ', start + 8);
    const body = source.slice(start, next === -1 ? source.length : next);
    assert.match(body, /unresolved_principal\s*=\s*0\s*;/, `${name} must clear the unresolved principal ledger`);
  }
  const closeStart = source.indexOf('pub fn close_escrow');
  const closeEnd = source.indexOf('\n    // ---------------------------------------------------------------------', closeStart);
  assert.match(source.slice(closeStart, closeEnd), /unresolved_principal\s*==\s*0/);
});

test('V2 preserves the no-submission late-refund escape hatch', () => {
  assert.match(source, /pub fn claim_milestone_late_refund_v2[\s\S]*?MultiMilestoneState::Funded/);
  assert.match(source, /pub fn claim_milestone_late_refund_v2[\s\S]*?DeliveryDeadlineNotPassed/);
  assert.match(source, /pub fn claim_milestone_late_refund_v2[\s\S]*?buyer_entitlement\s*=\s*milestone\.expected_total/);
  assert.match(source, /pub struct ClaimMilestoneLateRefundV2[\s\S]*?has_one = buyer[\s\S]*?token::authority = milestone[\s\S]*?token::authority = buyer/);
});

test('ledger transitions are staged before token CPIs', () => {
  const handlerBody = name => {
    const start = source.indexOf(`pub fn ${name}`);
    assert.notEqual(start, -1, `missing ${name}`);
    const next = source.indexOf('\n    pub fn ', start + 8);
    return source.slice(start, next === -1 ? source.length : next);
  };
  for (const name of ['open_dispute', 'claim_seller', 'claim_fee', 'claim_buyer_refund', 'open_milestone_dispute_v2', 'claim_milestone_seller_v2', 'claim_milestone_fee_v2', 'claim_milestone_buyer_refund_v2']) {
    const body = handlerBody(name);
    const cpi = body.indexOf('transfer_');
    assert.notEqual(cpi, -1, `${name} should contain a token CPI`);
    const ledger = Math.max(body.indexOf('state ='), body.indexOf('_entitlement = 0'), body.indexOf('dispute_fee_paid ='));
    assert.ok(ledger >= 0 && ledger < cpi, `${name} must stage its ledger transition before the token CPI`);
  }
});
