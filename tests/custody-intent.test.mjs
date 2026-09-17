import test from 'node:test';
import assert from 'node:assert/strict';
import { base58Encode } from '../src/payments.mjs';
import { createFundingIntent, createInitializeIntent, createInitializeV2Intent, createMilestoneActionIntent, createSettlementIntent, createEscrowActionIntent, serializeIntent, verifyIntent, TOKEN_PROGRAM_IDS, DISPUTE_FEE_BPS } from '../src/custody/intent.mjs';

const addr = n => base58Encode(Uint8Array.from({ length: 32 }, (_, index) => (n + index) % 255));
const buyer = addr(1), seller = addr(33), arbiter = addr(66), fee = addr(99), programId = addr(132), mint = addr(165);
const baseOrder = (overrides = {}) => ({
  id: 'deal-intent-1',
  currentTermsHash: 'a'.repeat(64),
  termsVersion: 2,
  buyerWallet: buyer,
  sellerWallet: seller,
  arbiterWallet: arbiter,
  feeWallet: fee,
  acceptedAt: 1700000000000,
  fundedAt: null,
  cancelled: false,
  milestones: [{ id: 'milestone-1', originalAmount: '450000000', reserve: '0', held: '0', status: 'unfunded' }],
  ...overrides
});
const options = { network: 'devnet', programId, expectedProgramIds: { devnet: programId }, genesisHash: addr(198), fixedFeeRecipient: fee, mint, allowedMints: { devnet: [mint] }, tokenProgram: 'spl-token', createdAt: 1700000000000 };

test('funding intent derives the reserve from principal, not stale milestone reserve', () => {
  const intent = createFundingIntent(baseOrder(), options);
  assert.equal(intent.asset.tokenProgramId, TOKEN_PROGRAM_IDS['spl-token']);
  assert.equal(intent.milestones[0].reserve, '13500000');
  assert.equal(intent.total, '463500000');
  assert.equal(intent.authorization.signer, buyer);
  assert.equal(intent.broadcastable, false);
  assert.equal(verifyIntent(intent), true);
  assert.equal(typeof serializeIntent(intent), 'string');
});

test('initialize intent carries explicit bounded chain-time deadlines', () => {
  const intent = createInitializeIntent(baseOrder(), { ...options, now: 1_700_000_000, fundingDeadline: 1_700_086_400, deliveryDeadline: 1_700_172_800, reviewDeadline: 1_700_259_200, timedRelease: true });
  assert.equal(intent.programInstruction, 'initialize');
  assert.deepEqual(intent.deadlines, { funding: 1_700_086_400, delivery: 1_700_172_800, review: 1_700_259_200 });
  assert.equal(intent.expectedTotal, '463500000');
  assert.deepEqual(intent.authorization.requiredSigners, [buyer, arbiter]);
  assert.equal(intent.timedRelease, true);
  assert.deepEqual(intent.authorization.requiredSigners, [buyer, arbiter]);
  assert.equal(verifyIntent(intent), true);
  assert.throws(() => createInitializeIntent(baseOrder(), { ...options, now: 1_700_000_000, fundingDeadline: 1_700_000_001, deliveryDeadline: 1_700_000_002, reviewDeadline: 1_700_000_010 }), /60-second/);
  assert.throws(() => createInitializeIntent(baseOrder(), { ...options, now: 1_700_000_000, fundingDeadline: 1_700_086_400, deliveryDeadline: 1_700_172_800, reviewDeadline: 1_700_172_800 + 30 * 24 * 60 * 60 + 1 }), /30-day/);
});

test('V2 intent surface binds each bounded milestone to exact deadlines, amounts and actors', () => {
  const order = baseOrder({ milestones: [
    { id: 'm1', originalAmount: '450000000', status: 'unfunded', fundingDeadline: 1_700_086_400, deliveryDeadline: 1_700_172_800, reviewDeadline: 1_700_259_200, timedRelease: true },
    { id: 'm2', originalAmount: '100000000', status: 'unfunded', fundingDeadline: 1_700_086_400, deliveryDeadline: 1_700_172_800, reviewDeadline: 1_700_259_200, timedRelease: false }
  ] });
  const init = createInitializeV2Intent(order, { ...options, now: 1_700_000_000 });
  assert.equal(init.programInstruction, 'initialize_v2');
  assert.equal(init.milestoneCount, 2);
  assert.equal(init.milestones[0].feeReserve, '13500000');
  assert.equal(init.milestones[1].expectedTotal, '103000000');
  const create = createMilestoneActionIntent(order, 0, 'create_milestone_v2', { ...options, now: 1_700_000_000 });
  assert.equal(create.programInstruction, 'create_milestone_v2');
  const cancel = createMilestoneActionIntent(order, 1, 'cancel_milestone_v2', options);
  assert.equal(cancel.programInstruction, 'cancel_milestone_v2');
  const funded = { ...order, milestones: [{ ...order.milestones[0], status: 'funded' }, order.milestones[1]] };
  const submit = createMilestoneActionIntent(funded, 0, 'seller_submit_milestone_v2', { ...options, signer: seller, deliveryHash: 'd'.repeat(64) });
  assert.equal(submit.programInstruction, 'seller_submit_milestone_v2');
  const dispute = createMilestoneActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'submitted' }, funded.milestones[1]] }, 0, 'open_milestone_dispute_v2', { ...options, signer: buyer });
  assert.equal(dispute.programInstruction, 'open_milestone_dispute_v2');
  assert.equal(dispute.milestone.disputeFee, '22500000');
  const resolution = createMilestoneActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'disputed' }, funded.milestones[1]] }, 0, 'arbiter_refund_milestone_v2', { ...options, signer: arbiter });
  assert.equal(resolution.programInstruction, 'arbiter_refund_milestone_v2');
  const lateRefund = createMilestoneActionIntent({ ...order, fundedAt: 1700000001000, milestones: [{ ...order.milestones[0], status: 'funded' }, order.milestones[1]] }, 0, 'claim_milestone_late_refund_v2', { ...options, signer: buyer });
  assert.equal(lateRefund.programInstruction, 'claim_milestone_late_refund_v2');
  assert.equal(lateRefund.amount, '463500000');
  const aggregateClose = createEscrowActionIntent({ ...order, milestones: [{ ...order.milestones[0], status: 'closed' }, { ...order.milestones[1], status: 'cancelled' }] }, 'close_escrow_v2', options);
  assert.equal(aggregateClose.programInstruction, 'close_escrow_v2');
  assert.equal(verifyIntent(init), true);
});

test('settlement intent binds to fixed parties and a supported chain configuration', () => {
  const order = baseOrder({ fundedAt: 1700000001000, milestones: [{ id: 'milestone-1', originalAmount: '450000000', reserve: '13500000', held: '450000000', status: 'funded' }] });
  const intent = createSettlementIntent(order, 'milestone-1', 'release', { ...options, signer: buyer, tokenProgram: 'spl-token' });
  assert.equal(intent.destination, seller);
  assert.equal(intent.feeDestination, fee);
  assert.equal(intent.asset.tokenProgramId, TOKEN_PROGRAM_IDS['spl-token']);
  assert.equal(intent.authorization.destinationPolicy, 'fixed-original-parties-only');
});

test('accepts the canonical SPL Token program address as well as its name', () => {
  const intent = createFundingIntent(baseOrder(), { ...options, tokenProgram: TOKEN_PROGRAM_IDS['spl-token'] });
  assert.equal(intent.asset.tokenProgram, 'spl-token');
  assert.equal(intent.asset.tokenProgramId, TOKEN_PROGRAM_IDS['spl-token']);
});

test('current Anchor action intents bind each signer to the restricted instruction', () => {
  const accepted = createEscrowActionIntent(baseOrder(), 'accept', { ...options, signer: seller });
  assert.equal(accepted.programInstruction, 'seller_accept');
  assert.equal(accepted.authorization.signer, seller);
  const amended = createEscrowActionIntent(baseOrder(), 'amend_terms', { ...options, signer: buyer, newTermsHash: 'b'.repeat(64), newTermsVersion: 3 });
  assert.equal(amended.programInstruction, 'amend_terms');
  assert.equal(amended.termsHash, 'b'.repeat(64));
  assert.deepEqual(amended.authorization.requiredSigners, [buyer, seller]);
  const amendedV2 = createEscrowActionIntent(baseOrder(), 'amend_terms_v2', { ...options, signer: seller, newTermsHash: 'c'.repeat(64) });
  assert.equal(amendedV2.programInstruction, 'amend_terms_v2');

  const funded = baseOrder({ fundedAt: 1700000001000, milestones: [{ id: 'milestone-1', originalAmount: '450000000', reserve: '13500000', held: '450000000', status: 'funded' }] });
  const submitted = createEscrowActionIntent(funded, 'submit', { ...options, signer: seller, deliveryHash: 'b'.repeat(64) });
  assert.equal(submitted.programInstruction, 'seller_submit');
  const disputed = { ...funded, milestones: [{ ...funded.milestones[0], status: 'disputed' }] };
  const opened = createEscrowActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'submitted' }] }, 'open_dispute', { ...options, signer: buyer });
  assert.equal(opened.programInstruction, 'open_dispute');
  assert.equal(opened.disputeFee, '22500000');
  assert.equal(DISPUTE_FEE_BPS, 500);
  const arbiterRelease = createEscrowActionIntent(disputed, 'arbiter_release', { ...options, signer: arbiter });
  assert.equal(arbiterRelease.programInstruction, 'arbiter_release');
  const arbiterRefund = createEscrowActionIntent(disputed, 'arbiter_refund', { ...options, signer: arbiter });
  assert.equal(arbiterRefund.programInstruction, 'arbiter_refund');
  const feeClaim = createEscrowActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'seller_paid' }] }, 'claim_fee', { ...options, signer: fee });
  assert.equal(feeClaim.amount, '13500000');
  const refund = createEscrowActionIntent(funded, 'bilateral_refund', options);
  assert.deepEqual(refund.authorization.requiredSigners, [buyer, seller]);
  assert.equal(verifyIntent(refund), true);
  const timeout = createEscrowActionIntent({ ...funded, timedRelease: true, milestones: [{ ...funded.milestones[0], status: 'submitted' }] }, 'execute_review_timeout', { ...options, signer: arbiter });
  assert.equal(timeout.programInstruction, 'execute_review_timeout');
  const submittedOrder = { ...funded, milestones: [{ ...funded.milestones[0], status: 'submitted' }] };
  const proposal = createEscrowActionIntent(submittedOrder, 'propose_common_ground', { ...options, signer: buyer, proposalNonce: 1, sellerAmount: '300000000', buyerPrincipalRefund: '100000000', now: 1_700_000_000, expiresAt: 1_700_086_400 });
  assert.equal(proposal.programInstruction, 'propose_common_ground');
  const approval = createEscrowActionIntent(submittedOrder, 'approve_common_ground', { ...options, signer: seller, proposalAddress: programId, proposalHash: 'c'.repeat(64) });
  assert.equal(approval.programInstruction, 'approve_common_ground');
  const execute = createEscrowActionIntent(submittedOrder, 'execute_common_ground', { ...options, proposalAddress: programId, proposalHash: 'c'.repeat(64) });
  assert.equal(execute.programInstruction, 'execute_common_ground');
  const resolved = createEscrowActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'common_ground' }] }, 'resolve_common_ground_remainder', { ...options, toSeller: true });
  assert.deepEqual(resolved.authorization.requiredSigners, [buyer, seller]);
  const closed = createEscrowActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'released' }] }, 'close_escrow', options);
  assert.equal(closed.programInstruction, 'close_escrow');
  const cancelledClose = createEscrowActionIntent({ ...baseOrder(), cancelled: true }, 'close_escrow', options);
  assert.equal(cancelledClose.programInstruction, 'close_escrow');
  const dust = createEscrowActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'closed' }] }, 'sweep_unentitled_dust', options);
  assert.equal(dust.programInstruction, 'sweep_unentitled_dust');
  assert.equal(dust.authorization.destinationPolicy, 'fixed-original-buyer-only-after-zero-entitlements');
  const v2Dust = createEscrowActionIntent({ ...funded, milestones: [{ ...funded.milestones[0], status: 'closed' }, { ...funded.milestones[0], id: 'milestone-2', status: 'closed' }] }, 'sweep_milestone_unentitled_dust', { ...options, milestoneIndex: 0 });
  assert.equal(v2Dust.programInstruction, 'sweep_milestone_unentitled_dust');
  const prefundingDust = createEscrowActionIntent(baseOrder(), 'recover_prefunding_dust', options);
  assert.equal(prefundingDust.programInstruction, 'recover_prefunding_dust');
  const prefundingV2Dust = createEscrowActionIntent({ ...baseOrder(), milestones: [{ ...baseOrder().milestones[0], status: 'unfunded' }, { ...baseOrder().milestones[0], id: 'milestone-2', status: 'unfunded' }] }, 'recover_milestone_prefunding_dust', { ...options, milestoneIndex: 0 });
  assert.equal(prefundingV2Dust.programInstruction, 'recover_milestone_prefunding_dust');
});

test('intent builders reject placeholder addresses, unsupported networks, forged signers and invalid lifecycle state', () => {
  assert.throws(() => createFundingIntent(baseOrder({ buyerWallet: 'not-an-address' }), options), /Buyer wallet/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, network: 'ethereum' }), /network/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, signer: seller }), /original buyer/);
  assert.throws(() => createEscrowActionIntent(baseOrder(), 'amend_terms', { ...options, signer: arbiter, newTermsHash: 'b'.repeat(64) }), /original party/);
  assert.throws(() => createFundingIntent(baseOrder({ currentTermsHash: '0'.repeat(64) }), options), /terms hash/);
  assert.throws(() => createFundingIntent(baseOrder({ fundedAt: 1700000000000 }), options), /eligible/);
  assert.throws(() => createFundingIntent(baseOrder({ milestones: [baseOrder().milestones[0], { id: 'milestone-2', originalAmount: '1', reserve: '0', held: '0', status: 'unfunded' }] }), options), /one principal/);
  assert.throws(() => createSettlementIntent(baseOrder(), 'milestone-1', 'release', options), /not been funded/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, programId: '11111111111111111111111111111111' }), /program ID/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, programId: `1${options.programId}` }), /program ID/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, expectedProgramIds: undefined }), /program manifest/);
  assert.throws(() => createFundingIntent(baseOrder({ feeWallet: seller }), options), /must be distinct/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, genesisHash: 'not-a-hash' }), /genesis hash/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, allowedMints: undefined }), /admitted mint allowlist/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, allowedMints: { devnet: [seller] } }), /not admitted/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, expectedProgramIds: { devnet: seller } }), /network manifest/);
  assert.throws(() => createFundingIntent(baseOrder(), { ...options, tokenProgram: 'token-2022' }), /Token-2022/);
  assert.throws(() => createEscrowActionIntent({ ...baseOrder(), fundedAt: 1700000001000, milestones: [{ ...baseOrder().milestones[0], status: 'submitted' }] }, 'arbiter_refund', { ...options, signer: arbiter }), /disputed/);
  assert.throws(() => createEscrowActionIntent({ ...baseOrder(), fundedAt: 1700000001000 }, 'amend_terms', { ...options, newTermsHash: 'b'.repeat(64) }), /before funding/);
  assert.throws(() => createEscrowActionIntent({ ...baseOrder(), milestones: [{ ...baseOrder().milestones[0], status: 'funded' }] }, 'close_escrow_v2', options), /closed or cancelled/);
  assert.throws(() => createEscrowActionIntent({ ...baseOrder(), fundedAt: 1700000001000, milestones: [{ ...baseOrder().milestones[0], status: 'funded' }] }, 'claim_late_refund', { ...options, amount: '450000000' }), /fixed to the on-chain expected total/);
  assert.throws(() => createEscrowActionIntent(baseOrder(), 'amend_terms', { ...options, newTermsHash: baseOrder().currentTermsHash }), /differ/);
  assert.throws(() => createEscrowActionIntent({ ...baseOrder(), fundedAt: 1700000001000, milestones: [{ ...baseOrder().milestones[0], status: 'submitted' }] }, 'propose_common_ground', { ...options, signer: buyer, proposalNonce: 1, sellerAmount: '0', buyerPrincipalRefund: '0', now: 1_700_000_000, expiresAt: 1_700_000_100 }), /positive amount/);
  assert.throws(() => createEscrowActionIntent({ ...baseOrder(), fundedAt: 1700000001000, milestones: [{ ...baseOrder().milestones[0], status: 'funded' }] }, 'sweep_unentitled_dust', options), /closed milestone/);
  assert.throws(() => createEscrowActionIntent({ ...baseOrder(), fundedAt: 1700000001000, milestones: [{ ...baseOrder().milestones[0], status: 'unfunded' }] }, 'recover_prefunding_dust', options), /Pre-funding dust/);
});

test('intent builders reject role collisions before wallet handoff', () => {
  const order = baseOrder();
  assert.throws(() => createInitializeIntent({ ...order, sellerWallet: order.buyerWallet }, options), /must be distinct/);
  assert.throws(() => createInitializeV2Intent({ ...order, feeWallet: order.arbiterWallet }, options), /must be distinct/);
});

test('intent verification detects changes after hashing', () => {
  const intent = createFundingIntent(baseOrder(), options);
  const changed = { ...intent, chain: { ...intent.chain, network: 'mainnet-beta' } };
  assert.equal(verifyIntent(changed), false);
});
