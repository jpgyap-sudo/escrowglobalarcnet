/**
 * Deterministic Common Ground math and consent envelope.
 *
 * This module is deliberately not a signer, transaction builder, or custody
 * authority. It mirrors the proposed on-chain protocol: two original parties
 * approve one exact, revision-bound allocation, and only then may an adapter
 * execute it. The unresolved remainder is never silently allocated.
 */
import { agreementHash } from '../agreement.mjs';
import { deriveMilestoneReserve } from '../../packages/custody-contracts/reference-quote.mjs';

export const COMMON_GROUND_DOMAIN = 'ESCROW_GLOBAL_COMMON_GROUND_V1';
export const MAX_COMMON_GROUND_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const MAX_U64 = (1n << 64n) - 1n;
const decimal = (value, label, positive = false) => {
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a non-negative integer string.`);
  const parsed = BigInt(text);
  if (parsed > MAX_U64) throw new Error(`${label} exceeds the supported token-unit limit.`);
  if (positive && parsed === 0n) throw new Error(`${label} must be greater than zero.`);
  return text;
};

function commonInputs({ unresolvedPrincipal, buyerProposal, sellerProposal }) {
  const unresolved = BigInt(decimal(unresolvedPrincipal, 'Unresolved principal', true));
  const buyer = BigInt(decimal(buyerProposal, 'Buyer proposal', false));
  const seller = BigInt(decimal(sellerProposal, 'Seller proposal', false));
  if (buyer > unresolved || seller > unresolved) throw new Error('Each proposed seller allocation must fit within the unresolved principal.');
  return { unresolved, buyer, seller };
}

/**
 * Suggest the intersection of two non-binding seller-allocation positions.
 * The suggestion never becomes executable without an exact bilateral
 * proposal and two approvals.
 */
export function suggestCommonGround({ unresolvedPrincipal, buyerProposal, sellerProposal }) {
  const { unresolved, buyer, seller } = commonInputs({ unresolvedPrincipal, buyerProposal, sellerProposal });
  return Object.freeze({
    sellerAmount: (buyer < seller ? buyer : seller).toString(),
    buyerPrincipalRefund: (unresolved - (buyer > seller ? buyer : seller)).toString(),
    disputedRemainder: (buyer > seller ? buyer - seller : seller - buyer).toString()
  });
}

function allocation({ unresolvedPrincipal, sellerAmount, buyerPrincipalRefund }) {
  const unresolved = BigInt(decimal(unresolvedPrincipal, 'Unresolved principal', true));
  const seller = BigInt(decimal(sellerAmount, 'Seller allocation', false));
  const buyer = BigInt(decimal(buyerPrincipalRefund, 'Buyer principal refund', false));
  if (seller + buyer > unresolved) throw new Error('Common Ground allocation exceeds the unresolved principal.');
  return { unresolved, seller, buyer, remainder: unresolved - seller - buyer };
}

/** Build one immutable, exact proposal payload for the two original parties. */
export function createCommonGroundProposal({
  agreementIdHash, termsHash, milestoneId, decisionRevision, unresolvedPrincipal,
  sellerAmount, buyerPrincipalRefund, buyerWallet, sellerWallet, expiresAt, now,
  originalPrincipal = unresolvedPrincipal, originalReserve = null,
  sellerAllocatedBefore = '0', buyerPrincipalAllocatedBefore = '0',
  buyerReserveRefundedBefore = '0', feePaidBefore = '0'
}) {
  if (typeof agreementIdHash !== 'string' || !/^[a-f0-9]{64}$/.test(agreementIdHash) || /^0+$/.test(agreementIdHash)) throw new Error('Agreement commitment is required.');
  if (typeof termsHash !== 'string' || !/^[a-f0-9]{64}$/.test(termsHash) || /^0+$/.test(termsHash)) throw new Error('Terms commitment is required.');
  if (typeof milestoneId !== 'string' || milestoneId.length < 1 || milestoneId.length > 128) throw new Error('Milestone ID is required.');
  if (!Number.isSafeInteger(decisionRevision) || decisionRevision < 0) throw new Error('Decision revision is invalid.');
  if (typeof buyerWallet !== 'string' || buyerWallet.length < 1 || typeof sellerWallet !== 'string' || sellerWallet.length < 1 || buyerWallet === sellerWallet) throw new Error('Original buyer and seller wallets are required and must differ.');
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt - now > MAX_COMMON_GROUND_LIFETIME_SECONDS) throw new Error('Proposal expiry is invalid.');
  const amounts = allocation({ unresolvedPrincipal, sellerAmount, buyerPrincipalRefund });
  const original = BigInt(decimal(originalPrincipal, 'Original principal', true));
  const originalR = BigInt(decimal(originalReserve === null ? deriveMilestoneReserve(original.toString()) : originalReserve, 'Original reserve'));
  if (originalR !== BigInt(deriveMilestoneReserve(original.toString()))) throw new Error('Original reserve does not match the locked fee policy.');
  const sellerBefore = BigInt(decimal(sellerAllocatedBefore, 'Previously allocated seller principal'));
  const buyerBefore = BigInt(decimal(buyerPrincipalAllocatedBefore, 'Previously allocated buyer principal'));
  const buyerReserveBefore = BigInt(decimal(buyerReserveRefundedBefore, 'Previously refunded buyer reserve'));
  const feeBefore = BigInt(decimal(feePaidBefore, 'Previously paid fee'));
  if (sellerBefore + buyerBefore + amounts.unresolved !== original) throw new Error('Common Ground counters do not match the unresolved principal.');
  if (buyerReserveBefore > originalR || feeBefore > originalR) throw new Error('Previously paid reserve counters exceed the original reserve.');
  const payload = {
    domain: COMMON_GROUND_DOMAIN,
    agreementIdHash, termsHash, milestoneId, decisionRevision,
    unresolvedPrincipal: amounts.unresolved.toString(),
    sellerAmount: amounts.seller.toString(),
    buyerPrincipalRefund: amounts.buyer.toString(),
    disputedRemainder: amounts.remainder.toString(),
    buyerWallet, sellerWallet, expiresAt,
    originalPrincipal: original.toString(),
    originalReserve: originalR.toString(),
    sellerAllocatedBefore: sellerBefore.toString(),
    buyerPrincipalAllocatedBefore: buyerBefore.toString(),
    buyerReserveRefundedBefore: buyerReserveBefore.toString(),
    feePaidBefore: feeBefore.toString()
  };
  return Object.freeze({
    ...payload,
    proposalHash: agreementHash(payload),
    buyerApproved: false,
    sellerApproved: false,
    status: 'pending'
  });
}

export function approveCommonGroundProposal(proposal, signer) {
  if (!verifyCommonGroundProposal(proposal)) throw new Error('Common Ground proposal is invalid.');
  if (proposal.status !== 'pending') throw new Error('Common Ground proposal is no longer pending.');
  if (signer !== proposal.buyerWallet && signer !== proposal.sellerWallet) throw new Error('Only the original parties can approve Common Ground.');
  if ((signer === proposal.buyerWallet && proposal.buyerApproved) || (signer === proposal.sellerWallet && proposal.sellerApproved)) throw new Error('This party already approved the proposal.');
  const next = { ...proposal, buyerApproved: proposal.buyerApproved || signer === proposal.buyerWallet, sellerApproved: proposal.sellerApproved || signer === proposal.sellerWallet };
  return Object.freeze(next);
}

export function executeCommonGroundProposal(proposal, { now } = {}) {
  if (!verifyCommonGroundProposal(proposal)) throw new Error('Common Ground proposal is invalid.');
  if (proposal.status !== 'pending' || !proposal.buyerApproved || !proposal.sellerApproved) throw new Error('Both original parties must approve the same proposal.');
  if (!Number.isSafeInteger(now) || now < 0 || now >= proposal.expiresAt) throw new Error('Common Ground proposal is expired or execution time is invalid.');
  const amounts = allocation(proposal);
  const original = BigInt(proposal.originalPrincipal);
  const originalReserve = BigInt(proposal.originalReserve);
  const sellerBefore = BigInt(proposal.sellerAllocatedBefore);
  const buyerBefore = BigInt(proposal.buyerPrincipalAllocatedBefore);
  const buyerReserveBefore = BigInt(proposal.buyerReserveRefundedBefore);
  const feeBefore = BigInt(proposal.feePaidBefore);
  if (sellerBefore + buyerBefore + amounts.unresolved !== original) throw new Error('Common Ground counters do not match the unresolved principal.');
  const sellerAllocated = sellerBefore + amounts.seller;
  const unresolvedAfter = amounts.remainder;
  const reserveStillNeeded = BigInt(deriveMilestoneReserve((sellerAllocated + unresolvedAfter).toString()));
  const buyerReserveTotal = originalReserve - reserveStillNeeded;
  const buyerReserveRefund = buyerReserveTotal - buyerReserveBefore;
  const feeEntitlement = BigInt(deriveMilestoneReserve(sellerAllocated.toString())) - feeBefore;
  if (buyerReserveRefund < 0n || feeEntitlement < 0n) throw new Error('Common Ground reserve or fee calculation underflowed.');
  return Object.freeze({
    proposalHash: proposal.proposalHash,
    sellerPrincipal: amounts.seller.toString(),
    buyerPrincipalRefund: amounts.buyer.toString(),
    buyerReserveRefund: buyerReserveRefund.toString(),
    disputedRemainder: amounts.remainder.toString(),
    earnedFeeReserve: feeEntitlement.toString(),
    status: 'executed'
  });
}

function validProposalPayload(proposal) {
  try {
    const amounts = allocation(proposal);
    const original = BigInt(decimal(proposal.originalPrincipal, 'Original principal', true));
    const reserve = BigInt(decimal(proposal.originalReserve, 'Original reserve'));
    const sellerBefore = BigInt(decimal(proposal.sellerAllocatedBefore, 'Previously allocated seller principal'));
    const buyerBefore = BigInt(decimal(proposal.buyerPrincipalAllocatedBefore, 'Previously allocated buyer principal'));
    return reserve === BigInt(deriveMilestoneReserve(original.toString())) && sellerBefore + buyerBefore + amounts.unresolved === original;
  } catch {
    return false;
  }
}

export function verifyCommonGroundProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || proposal.domain !== COMMON_GROUND_DOMAIN || typeof proposal.proposalHash !== 'string') return false;
  const { proposalHash, buyerApproved, sellerApproved, status, ...payload } = proposal;
  return proposalHash === agreementHash(payload) && validProposalPayload(proposal) && typeof buyerApproved === 'boolean' && typeof sellerApproved === 'boolean' && status === 'pending';
}
