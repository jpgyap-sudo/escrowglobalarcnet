import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveCommonGroundProposal,
  createCommonGroundProposal,
  executeCommonGroundProposal,
  suggestCommonGround,
  verifyCommonGroundProposal
} from '../src/custody/common-ground.mjs';

const base = {
  agreementIdHash: 'a'.repeat(64),
  termsHash: 'b'.repeat(64),
  milestoneId: 'm1',
  decisionRevision: 4,
  unresolvedPrincipal: '1000',
  originalPrincipal: '1000',
  originalReserve: '30',
  buyerWallet: 'buyer-wallet',
  sellerWallet: 'seller-wallet',
  expiresAt: 2_000,
  now: 1_000
};

test('Common Ground suggests the shared allocation and leaves only disagreement disputed', () => {
  assert.deepEqual(suggestCommonGround({ unresolvedPrincipal: '1000', buyerProposal: '700', sellerProposal: '900' }), {
    sellerAmount: '700', buyerPrincipalRefund: '100', disputedRemainder: '200'
  });
});

test('Common Ground requires the same exact proposal and both original approvals', () => {
  const proposal = createCommonGroundProposal({ ...base, sellerAmount: '700', buyerPrincipalRefund: '100' });
  assert.equal(verifyCommonGroundProposal(proposal), true);
  assert.throws(() => executeCommonGroundProposal(proposal, { now: 1_001 }), /Both original parties/);
  const buyerApproved = approveCommonGroundProposal(proposal, base.buyerWallet);
  const fullyApproved = approveCommonGroundProposal(buyerApproved, base.sellerWallet);
  const result = executeCommonGroundProposal(fullyApproved, { now: 1_001 });
  assert.deepEqual(result, {
    proposalHash: proposal.proposalHash,
    sellerPrincipal: '700',
    buyerPrincipalRefund: '100',
    buyerReserveRefund: '3',
    disputedRemainder: '200',
    earnedFeeReserve: '21',
    status: 'executed'
  });
});

test('Common Ground preserves cumulative reserve and fee accounting across partial rounds', () => {
  const proposal = createCommonGroundProposal({
    ...base,
    unresolvedPrincipal: '300',
    sellerAmount: '100',
    buyerPrincipalRefund: '50',
    sellerAllocatedBefore: '600',
    buyerPrincipalAllocatedBefore: '100',
    buyerReserveRefundedBefore: '2',
    feePaidBefore: '18'
  });
  const approved = approveCommonGroundProposal(approveCommonGroundProposal(proposal, base.buyerWallet), base.sellerWallet);
  const result = executeCommonGroundProposal(approved, { now: 1_001 });
  assert.equal(result.disputedRemainder, '150');
  assert.equal(result.buyerReserveRefund, '3');
  assert.equal(result.earnedFeeReserve, '3');
});

test('Common Ground rejects forged participants, over-allocation, tampering, and expiry', () => {
  assert.throws(() => createCommonGroundProposal({ ...base, sellerAmount: '1001', buyerPrincipalRefund: '0' }), /exceeds/);
  assert.throws(() => createCommonGroundProposal({ ...base, agreementIdHash: '0'.repeat(64) }), /Agreement commitment/);
  assert.throws(() => createCommonGroundProposal({ ...base, expiresAt: base.now + 7 * 24 * 60 * 60 + 1 }), /expiry/);
  const proposal = createCommonGroundProposal({ ...base, sellerAmount: '1', buyerPrincipalRefund: '0' });
  assert.throws(() => approveCommonGroundProposal(proposal, 'attacker'), /original parties/);
  assert.equal(verifyCommonGroundProposal({ ...proposal, sellerAmount: '2' }), false);
  const approved = approveCommonGroundProposal(approveCommonGroundProposal(proposal, base.buyerWallet), base.sellerWallet);
  assert.throws(() => executeCommonGroundProposal(approved, { now: base.expiresAt }), /expired/);
});
