/**
 * Restricted custody-intent boundary for the future audited chain adapter.
 *
 * These builders create reviewable, unsigned intent envelopes only. They do
 * not derive PDAs, contact an RPC, sign, broadcast, or move funds. A live
 * adapter must independently validate the same fields inside the custody
 * program before accepting any transaction. Every custody intent also requires
 * an explicit network-qualified deployment manifest (program ID, cluster
 * genesis hash and fixed fee recipient) plus a mint admission list; a ticker or
 * intent hash cannot admit an arbitrary SPL mint.
 */
import { agreementHash, canonicalJSON } from '../agreement.mjs';
import { base58Decode, base58Encode } from '../payments.mjs';
import { deriveDisputeCharge, deriveMilestoneReserve, DISPUTE_FEE_BPS as REFERENCE_DISPUTE_FEE_BPS } from '../../packages/custody-contracts/reference-quote.mjs';

export const CUSTODY_PROTOCOL_VERSION = 'escrow-global-custody-v1';
export const CUSTODY_NETWORKS = Object.freeze(['localnet', 'devnet', 'testnet', 'mainnet-beta']);
export const TOKEN_PROGRAM_IDS = Object.freeze({
  'spl-token': 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'token-2022': 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
});
export const SUPPORTED_TOKEN_PROGRAM = 'spl-token';
export const MAX_V2_MILESTONES = 16;
export const DISPUTE_FEE_BPS = REFERENCE_DISPUTE_FEE_BPS;
const MAX_U64 = (1n << 64n) - 1n;
const terminal = status => ['released', 'refunded', 'settled'].includes(status);
const required = (value, label) => { if (typeof value !== 'string' || value.trim().length < 1) throw new Error(`${label} is required.`); return value.trim(); };
const solanaAddress = (value, label) => {
  const normalized = required(value, label);
  try {
    const decoded = base58Decode(normalized);
    if (decoded.length !== 32 || decoded.every(byte => byte === 0) || base58Encode(decoded) !== normalized) throw new Error();
  } catch { throw new Error(`${label} must be a valid Solana address.`); }
  return normalized;
};
const amount = (value, label, allowZero = true) => {
  const normalized = required(String(value), label);
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a non-negative integer string.`);
  if (BigInt(normalized) > MAX_U64) throw new Error(`${label} exceeds the supported token-unit limit.`);
  if (!allowZero && BigInt(normalized) <= 0n) throw new Error(`${label} must be greater than zero.`);
  return normalized;
};
const deriveDisputeFee = principal => deriveDisputeCharge(principal);
const hash32 = (value, label) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || /^0+$/.test(value)) throw new Error(`${label} must be a non-zero 32-byte lowercase hexadecimal hash.`);
  return value;
};
const unixSeconds = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative Unix timestamp in seconds.`);
  return value;
};

function fixedParties(order) {
  const parties = {
    buyer: solanaAddress(order.buyerWallet, 'Buyer wallet'),
    seller: solanaAddress(order.sellerWallet, 'Seller wallet'),
    arbiter: solanaAddress(order.arbiterWallet, 'Arbiter wallet'),
    refund: solanaAddress(order.buyerWallet, 'Buyer refund wallet'),
    payout: solanaAddress(order.sellerWallet, 'Seller payout wallet'),
    fee: solanaAddress(order.feeWallet, 'Fee recipient')
  };
  const roles = [parties.buyer, parties.seller, parties.arbiter, parties.fee];
  if (new Set(roles).size !== roles.length) throw new Error('Buyer, seller, arbiter and fee recipient must be distinct wallets.');
  return parties;
}

function baseEnvelope(order, options) {
  if (!order || typeof order !== 'object') throw new Error('Agreement is required.');
  if (typeof order.currentTermsHash !== 'string' || !/^[a-f0-9]{64}$/.test(order.currentTermsHash) || /^0+$/.test(order.currentTermsHash)) throw new Error('A verified current agreement terms hash is required.');
  const parties = fixedParties(order);
  const network = required(options.network, 'Settlement network');
  if (!CUSTODY_NETWORKS.includes(network)) throw new Error('Settlement network is not supported by the custody protocol.');
  const programId = solanaAddress(options.programId, 'Custody program ID');
  const expectedProgramId = options.expectedProgramIds && options.expectedProgramIds[network];
  if (expectedProgramId === undefined) throw new Error('A network-qualified custody program manifest is required.');
  if (programId !== solanaAddress(expectedProgramId, 'Expected custody program ID')) throw new Error('Custody program ID does not match the configured network manifest.');
  const genesisHash = solanaAddress(options.genesisHash, 'Cluster genesis hash');
  const mint = solanaAddress(options.mint, 'Settlement mint');
  const admittedMints = Array.isArray(options.allowedMints)
    ? options.allowedMints
    : options.allowedMints && Array.isArray(options.allowedMints[network])
      ? options.allowedMints[network]
      : null;
  if (!admittedMints || admittedMints.length === 0 || !admittedMints.every(value => typeof value === 'string')) {
    throw new Error('A network-qualified admitted mint allowlist is required for a custody intent.');
  }
  const normalizedAdmittedMints = admittedMints.map((value, index) => solanaAddress(value, `Admitted mint ${index + 1}`));
  if (!normalizedAdmittedMints.includes(mint)) throw new Error('Settlement mint is not admitted for this network.');
  const requestedTokenProgram = options.tokenProgram || SUPPORTED_TOKEN_PROGRAM;
  const tokenProgramName = requestedTokenProgram === TOKEN_PROGRAM_IDS['spl-token']
    ? SUPPORTED_TOKEN_PROGRAM
    : requestedTokenProgram === TOKEN_PROGRAM_IDS['token-2022']
      ? 'token-2022'
      : requestedTokenProgram;
  if (tokenProgramName !== SUPPORTED_TOKEN_PROGRAM) {
    throw new Error('Token-2022 is not supported by the current Anchor custody program. Use SPL Token until Token-2022 extensions are explicitly scoped and audited.');
  }
  const tokenProgramId = TOKEN_PROGRAM_IDS[tokenProgramName] || solanaAddress(tokenProgramName, 'Token program ID');
  const signer = solanaAddress(options.signer || parties.buyer, 'Authorization signer');
  const fixedFeeRecipient = solanaAddress(options.fixedFeeRecipient, 'Fixed fee recipient');
  if (parties.fee !== fixedFeeRecipient) throw new Error('Fee recipient does not match the configured deployment manifest.');
  const agreementId = required(order.id, 'Agreement ID');
  return {
    protocol: CUSTODY_PROTOCOL_VERSION,
    kind: options.kind,
    agreementId,
    agreementIdHash: agreementHash({ protocol: CUSTODY_PROTOCOL_VERSION, agreementId, buyer: parties.buyer, seller: parties.seller, mint }),
    termsHash: order.currentTermsHash,
    termsVersion: order.termsVersion || 1,
    chain: { network, programId, genesisHash },
    asset: { mint, tokenProgram: tokenProgramName, tokenProgramId },
    parties,
    createdAt: Number.isSafeInteger(options.createdAt) ? options.createdAt : Date.now(),
    authorization: { signer, destinationPolicy: 'fixed-original-parties-only' }
  };
}

export function createFundingIntent(order, options = {}) {
  if (!order.acceptedAt || order.cancelled || order.fundedAt) throw new Error('Agreement is not eligible for initial funding.');
  if (!Array.isArray(order.milestones) || order.milestones.length < 1) throw new Error('Agreement must contain at least one milestone.');
  if (order.milestones.length !== 1) throw new Error('The current Anchor custody program supports one principal per escrow. Multi-milestone custody requires the audited v2 protocol slice.');
  if (order.milestones.some(m => m.status !== 'unfunded')) throw new Error('Every milestone must be unfunded before initial funding.');
  const envelope = baseEnvelope(order, { ...options, kind: 'fund' });
  if (envelope.authorization.signer !== envelope.parties.buyer) throw new Error('Only the original buyer can authorize a funding intent.');
  envelope.feeBps = 300;
  envelope.programInstruction = 'fund';
  envelope.milestones = order.milestones.map(m => {
    const principal = amount(m.originalAmount, 'Milestone principal', false);
    return { id: required(m.id, 'Milestone ID'), principal, reserve: deriveMilestoneReserve(principal), status: 'unfunded' };
  });
  envelope.totalPrincipal = envelope.milestones.reduce((sum, m) => (BigInt(sum) + BigInt(m.principal)).toString(), '0');
  envelope.totalReserve = envelope.milestones.reduce((sum, m) => (BigInt(sum) + BigInt(m.reserve)).toString(), '0');
  if (BigInt(envelope.totalPrincipal) > MAX_U64 || BigInt(envelope.totalReserve) > MAX_U64 || BigInt(envelope.totalPrincipal) + BigInt(envelope.totalReserve) > MAX_U64) throw new Error('Funding totals exceed the supported token-unit limit.');
  envelope.total = (BigInt(envelope.totalPrincipal) + BigInt(envelope.totalReserve)).toString();
  return finalizeIntent(envelope);
}

/** Build the unsigned initialize instruction payload for the current Anchor slice. */
export function createInitializeIntent(order, options = {}) {
  if (!order || typeof order !== 'object') throw new Error('Agreement is required.');
  if (order.fundedAt || order.cancelled) throw new Error('Agreement is not eligible for initialization.');
  if (!Array.isArray(order.milestones) || order.milestones.length !== 1) throw new Error('The current Anchor custody program supports exactly one milestone.');
  const envelope = baseEnvelope(order, { ...options, kind: 'initialize', signer: options.signer || order.buyerWallet });
  if (envelope.authorization.signer !== envelope.parties.buyer) throw new Error('Only the original buyer can initialize an escrow.');
  envelope.authorization = { signer: envelope.parties.buyer, requiredSigners: [envelope.parties.buyer, envelope.parties.arbiter], destinationPolicy: 'deployment-config-fixed-recipient' };
  const now = unixSeconds(options.now === undefined ? Math.floor(Date.now() / 1000) : options.now, 'Current time');
  const fundingDeadline = unixSeconds(options.fundingDeadline, 'Funding deadline');
  const deliveryDeadline = unixSeconds(options.deliveryDeadline, 'Delivery deadline');
  const reviewDeadline = unixSeconds(options.reviewDeadline, 'Review deadline');
  if (fundingDeadline <= now || deliveryDeadline <= fundingDeadline || reviewDeadline - deliveryDeadline < 60 || reviewDeadline - deliveryDeadline > 30 * 24 * 60 * 60) throw new Error('Escrow deadlines must be strictly ordered with a 60-second to 30-day review window.');
  if (fundingDeadline - now > 30 * 24 * 60 * 60 || deliveryDeadline - now > 365 * 24 * 60 * 60) throw new Error('Escrow deadlines exceed the supported horizon.');
  const principal = amount(order.milestones[0].originalAmount, 'Milestone principal', false);
  const feeReserve = deriveMilestoneReserve(principal);
  if (BigInt(principal) + BigInt(feeReserve) > MAX_U64) throw new Error('Funding totals exceed the supported token-unit limit.');
  envelope.programInstruction = 'initialize';
  envelope.principal = principal;
  envelope.feeBps = 300;
  envelope.feeReserve = feeReserve;
  envelope.expectedTotal = (BigInt(principal) + BigInt(feeReserve)).toString();
  envelope.deadlines = { funding: fundingDeadline, delivery: deliveryDeadline, review: reviewDeadline };
  envelope.timedRelease = options.timedRelease === true;
  return finalizeIntent(envelope);
}

/** Build the unsigned initialize payload for the bounded V2 multi-milestone surface. */
export function createInitializeV2Intent(order, options = {}) {
  if (!order || typeof order !== 'object') throw new Error('Agreement is required.');
  if (order.fundedAt || order.cancelled) throw new Error('Agreement is not eligible for initialization.');
  if (!Array.isArray(order.milestones) || order.milestones.length < 1 || order.milestones.length > MAX_V2_MILESTONES) throw new Error(`V2 escrow must contain between 1 and ${MAX_V2_MILESTONES} milestones.`);
  const envelope = baseEnvelope(order, { ...options, kind: 'initialize_v2', signer: options.signer || order.buyerWallet });
  if (envelope.authorization.signer !== envelope.parties.buyer) throw new Error('Only the original buyer can initialize an escrow.');
  envelope.authorization = { signer: envelope.parties.buyer, requiredSigners: [envelope.parties.buyer, envelope.parties.arbiter], destinationPolicy: 'deployment-config-fixed-recipient' };
  const now = unixSeconds(options.now === undefined ? Math.floor(Date.now() / 1000) : options.now, 'Current time');
  envelope.milestoneCount = order.milestones.length;
  envelope.milestones = order.milestones.map((m, index) => {
    if (!m || typeof m !== 'object') throw new Error('Each V2 milestone must be an object.');
    const principal = amount(m.originalAmount, `Milestone ${index + 1} principal`, false);
    const feeReserve = deriveMilestoneReserve(principal);
    if (BigInt(principal) + BigInt(feeReserve) > MAX_U64) throw new Error(`Milestone ${index + 1} exceeds the supported token-unit limit.`);
    const fundingDeadline = unixSeconds(m.fundingDeadline ?? options.fundingDeadline, `Milestone ${index + 1} funding deadline`);
    const deliveryDeadline = unixSeconds(m.deliveryDeadline ?? options.deliveryDeadline, `Milestone ${index + 1} delivery deadline`);
    const reviewDeadline = unixSeconds(m.reviewDeadline ?? options.reviewDeadline, `Milestone ${index + 1} review deadline`);
    if (fundingDeadline <= now || deliveryDeadline <= fundingDeadline || reviewDeadline - deliveryDeadline < 60 || reviewDeadline - deliveryDeadline > 30 * 24 * 60 * 60) throw new Error(`Milestone ${index + 1} deadlines are invalid.`);
    if (fundingDeadline - now > 30 * 24 * 60 * 60 || deliveryDeadline - now > 365 * 24 * 60 * 60) throw new Error(`Milestone ${index + 1} deadlines exceed the supported horizon.`);
    return { index, id: required(m.id, `Milestone ${index + 1} ID`), principal, feeReserve, expectedTotal: (BigInt(principal) + BigInt(feeReserve)).toString(), deadlines: { funding: fundingDeadline, delivery: deliveryDeadline, review: reviewDeadline }, timedRelease: (m.timedRelease ?? options.timedRelease) === true, status: 'unfunded' };
  });
  envelope.programInstruction = 'initialize_v2';
  return finalizeIntent(envelope);
}

/** Build an unsigned, index-bound action for one V2 milestone PDA. */
export function createMilestoneActionIntent(order, milestoneIndex, action, options = {}) {
  if (!order || typeof order !== 'object') throw new Error('Agreement is required.');
  const allowed = ['create_milestone_v2', 'cancel_milestone_v2', 'seller_accept_v2', 'fund_milestone_v2', 'seller_submit_milestone_v2', 'buyer_approve_milestone_v2', 'execute_milestone_review_timeout', 'open_milestone_dispute_v2', 'arbiter_release_milestone_v2', 'arbiter_refund_milestone_v2', 'bilateral_refund_milestone_v2', 'claim_milestone_late_refund_v2', 'claim_milestone_seller_v2', 'claim_milestone_fee_v2', 'claim_milestone_buyer_refund_v2', 'close_milestone_v2'];
  if (!allowed.includes(action)) throw new Error('Unsupported V2 milestone action.');
  if (!Number.isSafeInteger(milestoneIndex) || milestoneIndex < 0 || milestoneIndex >= MAX_V2_MILESTONES) throw new Error('Milestone index is invalid.');
  const milestone = Array.isArray(order.milestones) ? order.milestones[milestoneIndex] : null;
  if (!milestone || typeof milestone !== 'object') throw new Error('Milestone not found.');
  const envelope = baseEnvelope(order, { ...options, kind: action, signer: options.signer || order.buyerWallet });
  const signer = envelope.authorization.signer;
  const requireSigner = (expected, label) => { if (signer !== expected) throw new Error(`${label} must authorize this milestone action.`); };
  const status = milestone.status || 'unfunded';
  const principal = amount(milestone.originalAmount, 'Milestone principal', false);
  const feeReserve = deriveMilestoneReserve(principal);
  envelope.milestoneIndex = milestoneIndex;
  envelope.milestone = { id: required(milestone.id, 'Milestone ID'), principal, feeReserve, expectedTotal: (BigInt(principal) + BigInt(feeReserve)).toString(), status };
  if (action === 'create_milestone_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (!['unfunded', 'created'].includes(status)) throw new Error('Milestone is not eligible for creation.');
    const now = unixSeconds(options.now === undefined ? Math.floor(Date.now() / 1000) : options.now, 'Current time');
    const fundingDeadline = unixSeconds(milestone.fundingDeadline ?? options.fundingDeadline, 'Funding deadline');
    const deliveryDeadline = unixSeconds(milestone.deliveryDeadline ?? options.deliveryDeadline, 'Delivery deadline');
    const reviewDeadline = unixSeconds(milestone.reviewDeadline ?? options.reviewDeadline, 'Review deadline');
    if (fundingDeadline <= now || deliveryDeadline <= fundingDeadline || reviewDeadline - deliveryDeadline < 60 || reviewDeadline - deliveryDeadline > 30 * 24 * 60 * 60) throw new Error('Milestone deadlines are invalid.');
    if (fundingDeadline - now > 30 * 24 * 60 * 60 || deliveryDeadline - now > 365 * 24 * 60 * 60) throw new Error('Milestone deadlines exceed the supported horizon.');
    envelope.deadlines = { funding: fundingDeadline, delivery: deliveryDeadline, review: reviewDeadline };
    envelope.timedRelease = (milestone.timedRelease ?? options.timedRelease) === true;
  } else if (action === 'cancel_milestone_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (status !== 'unfunded') throw new Error('Only an unfunded milestone can be cancelled.');
  } else if (action === 'seller_accept_v2') {
    requireSigner(envelope.parties.seller, 'Seller');
    envelope.termsHash = hash32(order.currentTermsHash, 'Terms hash');
  } else if (action === 'fund_milestone_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (status !== 'unfunded') throw new Error('Milestone is not unfunded.');
    envelope.total = envelope.milestone.expectedTotal;
  } else if (action === 'seller_submit_milestone_v2') {
    requireSigner(envelope.parties.seller, 'Seller');
    if (status !== 'funded') throw new Error('Milestone is not funded.');
    envelope.deliveryHash = hash32(options.deliveryHash, 'Delivery hash');
  } else if (action === 'buyer_approve_milestone_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (status !== 'submitted') throw new Error('Milestone is not submitted.');
  } else if (action === 'execute_milestone_review_timeout') {
    if (status !== 'submitted') throw new Error('Milestone is not submitted.');
    if ((milestone.timedRelease ?? order.timedRelease) !== true) throw new Error('Timed release is not enabled for this milestone.');
  } else if (action === 'open_milestone_dispute_v2') {
    if (status !== 'submitted') throw new Error('A dispute can only open after milestone submission.');
    if (signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can open a milestone dispute.');
    envelope.milestone.disputeFee = deriveDisputeFee(principal);
  } else if (action === 'arbiter_release_milestone_v2' || action === 'arbiter_refund_milestone_v2') {
    requireSigner(envelope.parties.arbiter, 'Arbiter');
    if (status !== 'disputed') throw new Error('Arbiter resolution requires a disputed milestone.');
  } else if (action === 'bilateral_refund_milestone_v2') {
    if (!['funded', 'submitted'].includes(status)) throw new Error('Milestone is not eligible for bilateral refund.');
    if (signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can authorize a bilateral milestone refund.');
    envelope.authorization = { requiredSigners: [envelope.parties.buyer, envelope.parties.seller], destinationPolicy: 'fixed-original-parties-only' };
  } else if (action === 'claim_milestone_late_refund_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (status !== 'funded') throw new Error('Late refund requires a funded milestone with no submission.');
    envelope.amount = envelope.milestone.expectedTotal;
  } else if (action === 'claim_milestone_seller_v2') {
    requireSigner(envelope.parties.seller, 'Seller');
    if (status !== 'approved') throw new Error('Seller claim requires milestone approval.');
    envelope.amount = principal;
  } else if (action === 'claim_milestone_fee_v2') {
    requireSigner(envelope.parties.fee, 'Fee recipient');
    if (status !== 'seller_paid') throw new Error('Fee claim requires seller payment first.');
    envelope.amount = feeReserve;
  } else if (action === 'claim_milestone_buyer_refund_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (status !== 'refunded') throw new Error('Buyer claim requires milestone refund.');
    envelope.amount = envelope.milestone.expectedTotal;
  } else if (action === 'close_milestone_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (status !== 'closed') throw new Error('Milestone must be closed after its claim.');
  }
  envelope.protocolAction = action;
  envelope.programInstruction = action;
  return finalizeIntent(envelope);
}

export function createSettlementIntent(order, milestoneId, action, options = {}) {
  if (!order.fundedAt) throw new Error('Agreement has not been funded.');
  if (!['release', 'refund'].includes(action)) throw new Error('Choose release or refund.');
  const milestone = order.milestones.find(m => m.id === milestoneId);
  if (!milestone) throw new Error('Milestone not found.');
  if (terminal(milestone.status) || BigInt(milestone.held || '0') <= 0n) throw new Error('Milestone has no unresolved held principal.');
  const envelope = baseEnvelope(order, { ...options, kind: 'settle', signer: options.signer || order.buyerWallet });
  if (![envelope.parties.buyer, envelope.parties.seller].includes(envelope.authorization.signer) && envelope.authorization.signer !== solanaAddress(order.arbiterWallet, 'Arbiter wallet')) throw new Error('Settlement signer is not an original agreement authority.');
  envelope.milestone = { id: milestone.id, action, heldPrincipal: amount(milestone.held, 'Held principal', false), heldReserve: amount(milestone.reserve || '0', 'Held reserve') };
  envelope.destination = action === 'release' ? envelope.parties.payout : envelope.parties.refund;
  envelope.feeDestination = envelope.parties.fee;
  envelope.compatibility = 'legacy-reference-only';
  return finalizeIntent(envelope);
}

/**
 * Build an unsigned intent for the current Anchor instruction names. This is
 * deliberately an intent, not a transaction builder: PDA derivation, account
 * loading, wallet signing, RPC submission and finalized-state reconciliation
 * remain separate adapter responsibilities.
 */
export function createEscrowActionIntent(order, action, options = {}) {
  if (!order || typeof order !== 'object') throw new Error('Agreement is required.');
  const allowed = ['accept', 'amend_terms', 'amend_terms_v2', 'cancel_unfunded', 'submit', 'approve', 'open_dispute', 'execute_review_timeout', 'arbiter_release', 'arbiter_refund', 'propose_common_ground', 'approve_common_ground', 'execute_common_ground', 'resolve_common_ground_remainder', 'close_common_ground_proposal', 'bilateral_refund', 'claim_late_refund', 'claim_seller', 'claim_fee', 'claim_buyer_refund', 'close_escrow', 'sweep_unentitled_dust', 'recover_prefunding_dust', 'sweep_milestone_unentitled_dust', 'recover_milestone_prefunding_dust', 'close_escrow_v2'];
  if (!allowed.includes(action)) throw new Error('Unsupported Anchor escrow action.');
  const envelope = baseEnvelope(order, { ...options, kind: action, signer: options.signer || order.buyerWallet });
  const milestone = Array.isArray(order.milestones) && order.milestones.length === 1 ? order.milestones[0] : null;
  const status = milestone?.status || null;
  const targetMilestone = ['sweep_milestone_unentitled_dust', 'recover_milestone_prefunding_dust'].includes(action)
    ? (Number.isSafeInteger(options.milestoneIndex) && options.milestoneIndex >= 0 ? order.milestones?.[options.milestoneIndex] : null)
    : milestone;
  const signer = envelope.authorization.signer;
  const requireSigner = (expected, label) => { if (signer !== expected) throw new Error(`${label} must authorize this escrow action.`); };
  const funded = Boolean(order.fundedAt);
  if (order.cancelled && !['close_escrow', 'close_escrow_v2', 'sweep_unentitled_dust', 'sweep_milestone_unentitled_dust'].includes(action)) throw new Error('Agreement is cancelled.');
  const needsSingleMilestone = ['submit', 'approve', 'open_dispute', 'execute_review_timeout', 'arbiter_release', 'arbiter_refund', 'propose_common_ground', 'approve_common_ground', 'execute_common_ground', 'resolve_common_ground_remainder', 'bilateral_refund', 'claim_late_refund', 'claim_seller', 'claim_fee', 'claim_buyer_refund', 'sweep_unentitled_dust', 'recover_prefunding_dust'].includes(action);
  if (needsSingleMilestone && !milestone) throw new Error('This Anchor action requires exactly one milestone.');
  if (action === 'close_escrow_v2') {
    requireSigner(envelope.parties.buyer, 'Buyer');
    if (!Array.isArray(order.milestones) || order.milestones.length < 1 || order.milestones.length > MAX_V2_MILESTONES) throw new Error('V2 close requires a bounded milestone list.');
    if (order.milestones.some(item => !item || !['closed', 'cancelled'].includes(item.status))) throw new Error('Every V2 milestone must be closed or cancelled before the escrow can close.');
    envelope.milestoneCount = order.milestones.length;
  } else if (action === 'amend_terms' || action === 'amend_terms_v2') {
    if (funded) throw new Error('Terms can only be amended before funding.');
    if (signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can authorize a terms amendment.');
    const newTermsHash = hash32(options.newTermsHash, 'New terms hash');
    if (newTermsHash === order.currentTermsHash) throw new Error('New terms hash must differ from the current commitment.');
    envelope.oldTermsHash = order.currentTermsHash;
    envelope.termsHash = newTermsHash;
    envelope.termsVersion = Number.isSafeInteger(options.newTermsVersion) && options.newTermsVersion > 0
      ? options.newTermsVersion
      : envelope.termsVersion + 1;
    envelope.authorization = { signer, requiredSigners: [envelope.parties.buyer, envelope.parties.seller], destinationPolicy: 'fixed-original-parties-only' };
  } else if (action === 'accept') {
    requireSigner(envelope.parties.seller, 'Seller');
    envelope.termsHash = hash32(order.currentTermsHash, 'Terms hash');
  } else if (action === 'cancel_unfunded') {
    if (funded) throw new Error('Only an unfunded agreement can be cancelled.');
    requireSigner(envelope.parties.buyer, 'Buyer');
  } else if (action === 'submit') {
    if (!funded || (status && status !== 'funded')) throw new Error('Agreement is not in the funded state.');
    requireSigner(envelope.parties.seller, 'Seller');
    envelope.deliveryHash = hash32(options.deliveryHash, 'Delivery hash');
  } else if (action === 'approve') {
    if (!funded || (status && status !== 'submitted')) throw new Error('Agreement is not in the submitted state.');
    requireSigner(envelope.parties.buyer, 'Buyer');
  } else if (action === 'open_dispute') {
    if (!funded || (status && status !== 'submitted')) throw new Error('A dispute can only open after seller submission.');
    if (signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can open a dispute.');
    envelope.disputeFee = deriveDisputeFee(amount(milestone.originalAmount, 'Milestone principal', false));
  } else if (action === 'execute_review_timeout') {
    if (!funded || (status && status !== 'submitted')) throw new Error('Agreement is not in the submitted state.');
    if (order.timedRelease !== true) throw new Error('Timed release is not enabled for this agreement.');
    envelope.authorization = { signer, destinationPolicy: 'fixed-original-parties-only' };
  } else if (action === 'arbiter_release' || action === 'arbiter_refund') {
    if (!funded || status !== 'disputed') throw new Error('Arbiter resolution requires an explicitly disputed agreement.');
    requireSigner(envelope.parties.arbiter, 'Arbiter');
    envelope.authorization = { signer, destinationPolicy: 'fixed-original-parties-only' };
  } else if (action === 'propose_common_ground') {
    if (!funded || (status && status !== 'submitted')) throw new Error('Common Ground requires a submitted agreement.');
    if (signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can propose Common Ground.');
    const sellerAmount = amount(options.sellerAmount, 'Common Ground seller amount');
    const buyerPrincipalRefund = amount(options.buyerPrincipalRefund, 'Common Ground buyer refund');
    if (BigInt(sellerAmount) === 0n && BigInt(buyerPrincipalRefund) === 0n) throw new Error('Common Ground must allocate a positive amount.');
    const unresolved = amount(milestone.held || milestone.originalAmount, 'Unresolved principal', false);
    if (BigInt(sellerAmount) + BigInt(buyerPrincipalRefund) > BigInt(unresolved)) throw new Error('Common Ground allocation exceeds the unresolved principal.');
    const proposalNonce = unixSeconds(options.proposalNonce, 'Common Ground proposal nonce');
    const now = unixSeconds(options.now === undefined ? Math.floor(Date.now() / 1000) : options.now, 'Current time');
    const expiresAt = unixSeconds(options.expiresAt, 'Common Ground expiry');
    if (expiresAt <= now || expiresAt - now > 7 * 24 * 60 * 60) throw new Error('Common Ground expiry must be within seven days.');
    envelope.proposal = { proposalNonce, sellerAmount, buyerPrincipalRefund, unresolvedPrincipal: unresolved, expiresAt };
  } else if (action === 'approve_common_ground' || action === 'execute_common_ground') {
    if (!funded || (status && status !== 'submitted')) throw new Error('Common Ground requires a submitted agreement.');
    if (action === 'approve_common_ground' && signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can approve Common Ground.');
    envelope.proposalAddress = solanaAddress(options.proposalAddress, 'Common Ground proposal address');
    envelope.proposalHash = hash32(options.proposalHash, 'Common Ground proposal hash');
    envelope.authorization = { signer, destinationPolicy: 'fixed-original-parties-only' };
  } else if (action === 'resolve_common_ground_remainder') {
    if (!funded || status !== 'common_ground') throw new Error('Agreement has no Common Ground remainder.');
    if (signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can authorize the Common Ground remainder.');
    envelope.authorization = { requiredSigners: [envelope.parties.buyer, envelope.parties.seller], destinationPolicy: 'fixed-original-parties-only' };
    envelope.toSeller = options.toSeller === true;
  } else if (action === 'close_common_ground_proposal') {
    envelope.proposalAddress = solanaAddress(options.proposalAddress, 'Common Ground proposal address');
    envelope.authorization = { signer, destinationPolicy: 'proposal-rent-to-original-proposer' };
  } else if (action === 'bilateral_refund') {
    if (!funded || (status && !['funded', 'submitted'].includes(status))) throw new Error('Agreement is not refundable in its current state.');
    if (signer !== envelope.parties.buyer && signer !== envelope.parties.seller) throw new Error('Only an original party can authorize a bilateral refund.');
    envelope.authorization = { requiredSigners: [envelope.parties.buyer, envelope.parties.seller], destinationPolicy: 'fixed-original-parties-only' };
  } else if (action === 'claim_late_refund') {
    if (!funded || (status && status !== 'funded')) throw new Error('Late refund requires an unfunded delivery state.');
    requireSigner(envelope.parties.buyer, 'Buyer');
    const expectedTotal = (BigInt(amount(milestone.originalAmount, 'Milestone principal', false)) + BigInt(deriveMilestoneReserve(milestone.originalAmount))).toString();
    if (options.amount !== undefined && amount(options.amount, 'Buyer late-refund amount', false) !== expectedTotal) throw new Error('The late-refund amount is fixed to the on-chain expected total.');
    envelope.amount = expectedTotal;
  } else if (action === 'close_escrow') {
    const preFundingCancellation = order.cancelled === true && !funded;
    if (!preFundingCancellation && (!funded || (status && !['released', 'refunded', 'settled', 'closed'].includes(status)))) throw new Error('Only a settled or pre-funding-cancelled escrow can be closed.');
    requireSigner(envelope.parties.buyer, 'Buyer');
  } else if (['sweep_unentitled_dust', 'sweep_milestone_unentitled_dust', 'recover_prefunding_dust', 'recover_milestone_prefunding_dust'].includes(action)) {
    requireSigner(envelope.parties.buyer, 'Buyer');
    const prefunding = action.includes('prefunding');
    const expectedStatus = prefunding ? ['unfunded', 'created'] : ['closed'];
    if (!targetMilestone || !expectedStatus.includes(targetMilestone.status)) throw new Error(prefunding ? 'Pre-funding dust can only be recovered from an unfunded milestone.' : 'Dust can only be swept from a closed milestone.');
    if (prefunding && funded) throw new Error('Pre-funding dust cannot be recovered after funding.');
    if (action.includes('milestone')) envelope.milestoneIndex = options.milestoneIndex;
    envelope.destination = envelope.parties.refund;
    envelope.authorization = { signer: envelope.parties.buyer, destinationPolicy: 'fixed-original-buyer-only-after-zero-entitlements' };
  } else {
    if (!funded || !milestone) throw new Error('Agreement has not been funded.');
    if (action === 'claim_seller') { if (status && !['approved', 'common_ground'].includes(status)) throw new Error('Seller claim requires an approved or Common Ground allocation.'); requireSigner(envelope.parties.seller, 'Seller'); }
    if (action === 'claim_fee') { if (status && !['seller_paid', 'common_ground'].includes(status)) throw new Error('Fee claim requires the seller claim to settle first.'); requireSigner(envelope.parties.fee, 'Fee recipient'); }
    if (action === 'claim_buyer_refund') { if (status && !['refunded', 'common_ground'].includes(status)) throw new Error('Buyer refund claim requires a refund or Common Ground allocation.'); requireSigner(envelope.parties.buyer, 'Buyer'); }
    if (action === 'claim_seller') envelope.amount = amount(options.amount || milestone.originalAmount, 'Seller claim amount', false);
    if (action === 'claim_fee') envelope.amount = amount(options.amount || milestone.reserve || deriveMilestoneReserve(milestone.originalAmount), 'Fee claim amount', false);
    if (action === 'claim_buyer_refund') envelope.amount = amount(options.amount || milestone.held || milestone.originalAmount, 'Buyer refund amount', false);
  }
  envelope.protocolAction = action;
  envelope.programInstruction = {
    accept: 'seller_accept', amend_terms: 'amend_terms', amend_terms_v2: 'amend_terms_v2', cancel_unfunded: 'cancel_unfunded', submit: 'seller_submit',
    open_dispute: 'open_dispute', arbiter_release: 'arbiter_release', arbiter_refund: 'arbiter_refund',
    approve: 'buyer_approve', bilateral_refund: 'bilateral_refund', claim_seller: 'claim_seller',
    claim_fee: 'claim_fee', claim_buyer_refund: 'claim_buyer_refund', close_escrow: 'close_escrow',
    execute_review_timeout: 'execute_review_timeout', propose_common_ground: 'propose_common_ground',
    approve_common_ground: 'approve_common_ground', execute_common_ground: 'execute_common_ground',
    resolve_common_ground_remainder: 'resolve_common_ground_remainder',
    close_common_ground_proposal: 'close_common_ground_proposal', claim_late_refund: 'claim_late_refund', close_escrow: 'close_escrow', sweep_unentitled_dust: 'sweep_unentitled_dust', recover_prefunding_dust: 'recover_prefunding_dust', sweep_milestone_unentitled_dust: 'sweep_milestone_unentitled_dust', recover_milestone_prefunding_dust: 'recover_milestone_prefunding_dust', close_escrow_v2: 'close_escrow_v2'
  }[action];
  return finalizeIntent(envelope);
}

export function finalizeIntent(envelope) {
  const intent = structuredClone(envelope);
  intent.status = 'unsigned';
  intent.broadcastable = false;
  // Hash the complete immutable envelope, including the explicit unsigned
  // boundary. This makes verification deterministic and prevents a caller
  // from toggling status/broadcastability after signing review.
  intent.intentHash = agreementHash(intent);
  return Object.freeze(intent);
}

export function serializeIntent(intent) {
  if (!intent || typeof intent !== 'object' || intent.broadcastable !== false || intent.status !== 'unsigned') throw new Error('Only unsigned custody intents can be serialized.');
  return canonicalJSON(intent);
}

export function verifyIntent(intent) {
  if (!intent || typeof intent !== 'object' || typeof intent.intentHash !== 'string') return false;
  const copy = structuredClone(intent);
  delete copy.intentHash;
  return intent.intentHash === agreementHash(copy) && intent.broadcastable === false && intent.status === 'unsigned';
}
